# W3b — Passive SMS Onboarding (Inbound Twilio + TCPA/STOP Compliance) — Design

| Field | Value |
|---|---|
| Status | **DRAFT — brainstormed with Steve 2026-07-10, all decisions below Steve-approved in session. For Steve spec review → writing-plans. Not authorized to build.** |
| Created | 2026-07-10 |
| Phase | P3-03 (roadmap item 5: W3b) |
| Related code | `apps/api/src/lib/notificationService.ts` (`sendSms`, `sendGuestInvitation`), `apps/api/src/lib/invitationService.ts` (guest SMS body), `apps/api/src/lib/contact.ts` (`normalizePhone`), `apps/api/src/lib/personIdentity.ts` (`findOrCreatePersonByContact`, `mergePersons`), `apps/api/src/routes/webhooks.ts` (Clerk precedent), `apps/api/src/routes/guest.ts` (`POST /guest/invitation/:token/rsvp` — semantic to mirror), `packages/db/prisma/schema.prisma` (`Person`, `EventInvitation`) |

---

## 0. Why

SMS delivery is outbound-only today. A texted guest gets a `/rsvp?token=` link but cannot reply; there is
**no inbound webhook, no opt-out state anywhere in the schema, and nothing checks anything before
`sendSms`**. That is both a product gap (passive onboarding: reply "Y" to RSVP without opening a browser)
and a compliance gap (TCPA/CTIA require honoring STOP/HELP; the current invite SMS carries no opt-out
language). This is FamLink's first inbound SMS surface and its first consent-tracking obligation.

Existing plumbing this design deliberately reuses:

- `normalizePhone` produces E.164 — the same format as Twilio's inbound `From`.
- Guest invitations already route through `findOrCreatePersonByContact`, so every phone-invited guest has
  a `Person` with `phoneNormalized` set and an `EventInvitation.linkedPersonId` pointing at it.
- The web link-RSVP path works by updating `EventInvitation.status` (ACCEPTED/DECLINED) with an
  event-ended deadline check — SMS Y/N mirrors it exactly.
- CIF's `phoneVerifiedAt` column exists but is never set for phones; an inbound reply is proof of
  ownership, which is precisely what it was built for.

## 1. Decisions (Steve, 2026-07-10 brainstorm)

1. **"Y" = RSVP YES + verify phone.** One reply records the RSVP on the invited event AND sets
   `phoneVerifiedAt` (inbound reply proves ownership; feeds CIF's verified-identity graph). Not full
   ongoing-relationship enrollment — consent scope stays per-invitation.
2. **Opt-out truth = DB suppression list** (number-scoped `SmsConsent` table), gating every outbound SMS
   at the `sendSms` choke point. Twilio's built-in STOP handling stays ON as a carrier-level backstop.
3. **First-message posture = compliance footer** on guest invitation SMS ("Reply Y to RSVP, N to decline.
   Txt STOP to opt out, HELP for help"), keeping the single-message organizer-initiated transactional
   flow. No double opt-in gate.
4. **STOP handling is passive for organizers:** the number is suppressed and its PENDING invitations are
   marked DECLINED on the guest list. **No organizer notification.**
5. **Keywords = Y/YES + N/NO** (plus carrier-mandated STOP-family/START/UNSTOP/HELP). N/NO records a
   decline; any actionable reply verifies the phone.
6. **Scope = API-only.** Opt-outs surface as DECLINED through existing web/mobile invitation-status UI.
   No new screens; any "unreachable by SMS" organizer hint goes to backlog.
7. **Approach = number-scoped `SmsConsent` table** (chosen over a `Person.smsOptOutAt` column — STOP is
   legally per-number, and CIF only guarantees phone uniqueness for *verified* contacts, so a duplicate
   unverified Person sharing the number would leak sends past a person-scoped gate — and over a full
   `SmsMessage` log — YAGNI; Twilio retains message history, structured logs cover our side).

## 2. Scope

**In:** one Prisma model + additive migration; one webhook route (`POST /webhooks/twilio/sms`) with
Twilio signature verification; keyword router; Y/N → invitation-status + phone-verification flow;
suppression gate in `sendSms`; compliance footer on guest invitation SMS; structured logging; tests.

**Out (explicitly):** any web/mobile UI; organizer opt-out notifications; auto-merge of duplicate Persons
on verification conflict (`mergePersons` exists but stays unwired here); footer/consent changes to member
notification SMS beyond the gate; per-number "first message only" footer state (footer always included on
guest invites instead); a persisted SMS message log.

## 3. Data model

```prisma
model SmsConsent {
  id              String    @id @default(cuid())
  phoneNormalized String    @unique   // E.164
  optedOutAt      DateTime?
  optedInAt       DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}
```

- Suppressed ⇔ `optedOutAt !== null`. STOP sets `optedOutAt = now()`. START/UNSTOP (or Y/YES received
  while suppressed) clears `optedOutAt` and sets `optedInAt = now()`.
- Absence of a row = never opted out. Additive migration, no backfill.
- Every consent transition emits a structured log line (`sms_consent_change`, with phone, direction,
  MessageSid) — the CIF Plan B logs-only observability pattern. Twilio retains raw message history for
  dispute evidence; the table is the durable consent state, the logs + Twilio are the event trail.

## 4. Inbound webhook

`POST /api/v1/webhooks/twilio/sms` (full path per repo convention — Clerk is `/api/v1/webhooks/clerk`) —
third webhook alongside Clerk (`routes/webhooks.ts`) and Stripe (`routes/billing.ts`). Twilio posts `application/x-www-form-urlencoded` with `From`, `To`, `Body`,
`MessageSid`.

- **Signature verification first.** `X-Twilio-Signature` is HMAC-SHA1 over the exact public URL + sorted
  POST params, keyed by `TWILIO_AUTH_TOKEN` (already in env). Verify via the twilio SDK
  (`validateRequest`). Invalid/missing → 400, nothing processed (Clerk-route pattern). Because the API
  sits behind Railway's proxy, the URL is built from a configured **`API_PUBLIC_URL` env var** (new in
  `env.ts` unless an equivalent already exists), never from `Host` headers.
- **Replies are TwiML** (`text/xml` `MessagingResponse`) — no extra API call. Empty TwiML when no reply
  is warranted.
- **Idempotent by construction** (Twilio retries non-2xx): re-setting `optedOutAt`, re-updating
  invitation status, and re-setting `phoneVerifiedAt` are safe replays.
- **Errors:** internal failure → 500 (Twilio retries; safe). The route needs the urlencoded body parser
  (raw enough for signature params).

## 5. Keyword router

`Body` → trim, uppercase, strip surrounding punctuation, exact match:

| Inbound | State change | Reply (TwiML) |
|---|---|---|
| STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT | `optedOutAt = now()`; all PENDING `EventInvitation`s linked (via `linkedPersonId`) to Persons with this `phoneNormalized` → `status = DECLINED` | **None** — Twilio's built-in opt-out handling auto-confirms; ours would double-text |
| START, UNSTOP | Clear `optedOutAt`, set `optedInAt` | Short re-subscribe confirmation |
| HELP | none | Help text: what FamLink is + "Reply Y to RSVP, N to decline, STOP to opt out" — **always replies, even while suppressed** (CTIA requires HELP to keep working after STOP) |
| Y, YES | RSVP flow (§6); if suppressed, also clears suppression (mirrors Twilio, which treats YES as re-opt-in) | Confirmation incl. event title, or "This event has ended" |
| N, NO | Decline flow (§6) | Confirmation |
| anything else | none | Guidance reply **only if** the number has a PENDING invitation; otherwise silent (no auto-responding to strangers/wrong numbers) |

STOP from an unknown number is still recorded — it must be honored if that number is ever invited later.

## 6. Y/N resolution + phone verification

Resolution chain (existing plumbing only): `From` (E.164) → Person(s) by `phoneNormalized` (several
possible — uniqueness is verified-only) → `EventInvitation`s by `linkedPersonId` → **most recently sent**
(`sentAt` desc, fallback `createdAt`) — the message being replied to. `linkedPersonId` is always set on
guest invitations since CIF Plan A (PR #4); pre-CIF rows without it are out of scope (prod predates none
that matter — 12 persons, checked 2026-06-25).

**Amendment (2026-07-10, council round 1):** resolution is over the most recent invitation **regardless
of status**, not PENDING-only. Two reasons: (1) idempotency — a Twilio retry of the same message must
re-write the same row, never fall through to the next-most-recent PENDING invitation; (2) it lets a guest
change their answer (N then Y), matching the web token page, which allows re-RSVP until the deadline.
"No invitation at all" (not "no pending invitation") is the silent case.

- **Y/YES** → invitation `status = ACCEPTED`; **N/NO** → `DECLINED`. Same field and same event-ended
  deadline check as `POST /guest/invitation/:token/rsvp`, so SMS and web-link RSVPs are semantically
  identical. Past deadline → no status write, "This event has ended" reply.
- **Phone verification:** any actionable Y/N reply sets `phoneVerifiedAt = now()` on the Person linked to
  the resolved invitation. **Conflict guard:** if a *different* Person already holds a verified claim on
  that `phoneNormalized` (CIF partial unique index), skip verification and log
  (`phone_verification_conflict`). No auto-merge in W3b; wiring `mergePersons` here is named future work.
- Y/N with **no pending invitation:** silent — no reply, no writes (except suppression-clearing on Y/YES
  while suppressed, per §5).

## 7. Outbound gate + compliance footer

- **Gate:** `sendSms` (direct callers `sendGuestInvitation` and `NotificationService.send`, fanning out
  to guest invites, reminders, digests; HIGH-risk fanout reviewed and accepted in-session because gating
  *all* SMS is the TCPA requirement) normalizes `to`, looks up `SmsConsent`, and on suppression **skips
  the send**, returns failure with reason `sms_suppressed`, and logs. All live SMS flows inherit the gate
  with zero per-caller changes. **Amendment (2026-07-10, found in planning):** there is a second,
  currently-dormant Twilio send site — `InvitationService.sendEventInvitations` (no route calls it; only
  its own tests). It gets the same `isPhoneSuppressed` check **and the same compliance footer + 320
  budget in its SMS builder** so reviving it can never send non-compliant SMS or bypass consent.
- **Footer (guest invitation SMS only):** `Reply Y to RSVP, N to decline. Txt STOP to opt out, HELP for
  help.` Appended in `invitationService`'s SMS builder such that the footer and RSVP link are never
  truncated (the event-title portion truncates instead). Guest invites become ~2 SMS segments — accepted
  cost. Member notification SMS keeps current 160-char behavior (gated, no footer — scope control).
- Inviting an already-suppressed number: invitation is created normally, SMS skipped + logged, email
  still sends if present.

## 8. Isolation & security invariants

- Webhook replies never contain family name, roster, or ids — only the event title the guest was already
  texted (same isolation-safe copy rule as `buildGuestInvitationMessage`).
- Signature verification precedes all processing; the route is unauthenticated but not unverified.
- No secret values or message bodies in logs; structured logs may carry `MessageSid`, normalized phone,
  and internal record ids (invitationId, personId) — audit value without PII/secrets (wording amended
  2026-07-10, council round 2).
- Rate limiting: the route is Twilio-only by signature; no additional per-IP limiter needed (bad
  signatures 400 cheaply).

## 9. Testing

TDD per task; per-task verification includes `npm run lint`, type-check, API suite, and the web coverage
gate (untouched web code, but the gate runs regardless).

- Keyword router unit tests (all keywords, casing/punctuation variants, unknown text).
- Webhook route tests with **real computed signatures** (SDK `getExpectedTwilioSignature`): valid,
  invalid, missing.
- Resolution tests: multi-Person number, multiple pending invitations (most-recent wins), deadline
  passed, no pending invitation, verified-phone conflict skip.
- STOP flow: suppression written, pending invitations DECLINED, unknown-number STOP recorded, no TwiML
  reply body.
- START and Y-while-suppressed re-opt-in.
- Suppression gate: suppressed number → no Twilio client call from any flow (guest invitation +
  notification path); `sms_suppressed` result surfaced.
- Footer: present on guest invite SMS, link + footer survive long titles.

## 10. Ops (Steve, at deploy)

1. Point the Twilio number's inbound message webhook at the prod URL (`/api/v1/webhooks/twilio/sms`).
2. Keep Twilio's default opt-out handling **ON** (carrier-level backstop under the DB gate).
3. Set the public base URL env var in Railway prod (needed for signature validation) if not present.
4. `docs/FamLink_Secrets_Runbook.md` addendum: rotating `TWILIO_AUTH_TOKEN` now also invalidates inbound
   webhook signatures mid-flight — rotate via secondary-token promotion as done 2026-07-06.

## 11. Deferred / future work

- Organizer-facing "unreachable by SMS" indicator in invite UIs (backlog; API-only scope decision).
- Auto-merge duplicate Persons on phone verification via `mergePersons` (conflict guard just skips today).
- Persisted SMS message log if conversational SMS features (e.g., AI over SMS) ever land.
- Periodic opt-out-reminder footer on recurring member notification SMS (CTIA nicety; guests covered).
