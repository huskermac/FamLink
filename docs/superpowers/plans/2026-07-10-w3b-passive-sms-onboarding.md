# W3b Passive SMS Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inbound Twilio SMS webhook (Y/N RSVP + phone verification) with TCPA/STOP compliance: a number-scoped consent suppression list gating every outbound SMS, plus opt-out-language footer on guest invitation SMS.

**Architecture:** One new Prisma model (`SmsConsent`, keyed by unique E.164 `phoneNormalized`) is the durable consent record. A small consent lib (`smsConsent.ts`) is checked at **both** Twilio send sites (`NotificationService.sendSms` — live; `InvitationService.sendEventInvitations` — dormant but gated for safety). A pure keyword parser + a DB-acting inbound handler (`smsInbound.ts`) sit behind a signature-verified webhook route (`POST /api/v1/webhooks/twilio/sms`) that replies via TwiML. Y/N mirrors the web link-RSVP semantic (`EventInvitation.status` + deadline check) and sets `Person.phoneVerifiedAt`.

**Tech Stack:** Express 4, Prisma/PostgreSQL, twilio SDK v5 (`validateRequest` / `getExpectedTwilioSignature` / `twiml.MessagingResponse`), Vitest + Supertest (real test DB for route/handler tests, mocked `@famlink/db` for `notificationService` unit tests — both are existing patterns).

**Spec:** `docs/superpowers/specs/2026-07-10-w3b-passive-sms-onboarding-design.md` (Steve-approved 2026-07-10).

## Global Constraints

- Commit format: `feat: P3-03 <short description>` (or `fix:`/`chore:`).
- Per-task verification MUST include `npm run lint` (workspace root), not just tsc + tests (CI fails on any eslint error).
- Isolation invariant: webhook replies and SMS copy contain ONLY the event title (+ time/link) — never family name, roster, or ids.
- Never log secret values or message bodies. Structured logs may carry `MessageSid`, normalized phone, and internal record ids (invitationId, personId) — nothing else.
- Footer copy (verbatim, spec §7): `Reply Y to RSVP, N to decline. Txt STOP to opt out, HELP for help.`
- Guest invite SMS max length: **320 chars** (2 segments); footer and RSVP link are never truncated — the event title truncates instead.
- Member notification SMS keeps existing 160-char truncation.
- STOP is passive: suppress + mark PENDING invitations DECLINED; **no organizer notification**.
- All webhook handlers must be idempotent (Twilio retries non-2xx). Y/N resolves the **most recent
  invitation regardless of status** so a replayed message re-writes the same row (never falls through to
  the next invitation).
- Before editing any existing symbol, run `mcp__gitnexus__impact({target, direction: "upstream"})` and
  report the blast radius. Run `mcp__gitnexus__detect_changes()` before **every** commit (each task's
  commit step), not just at the end; re-analyze GitNexus at session end.

**Known spec deviation folded in:** spec §7 calls `sendSms` "the single choke point." Exploration found a second, currently-dormant Twilio send site: `InvitationService.sendEventInvitations` (no route calls it; only its own tests). This plan gates both so reviving the dormant path can't bypass consent. Spec amended accordingly.

---

### Task 1: `SmsConsent` schema + consent lib

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append the model at the end of the file)
- Create: migration via `prisma migrate dev`
- Create: `apps/api/src/lib/smsConsent.ts`
- Test: `apps/api/src/__tests__/lib/smsConsent.test.ts`

**Interfaces:**
- Consumes: `normalizePhone` from `apps/api/src/lib/contact.ts` (returns E.164 `string | null`), `db` from `@famlink/db`.
- Produces (used by Tasks 2, 4):
  - `isPhoneSuppressed(rawPhone: string): Promise<boolean>`
  - `recordSmsOptOut(phoneNormalized: string, messageSid: string): Promise<void>`
  - `recordSmsOptIn(phoneNormalized: string, messageSid: string): Promise<void>`
  - Prisma model `db.smsConsent` with fields `phoneNormalized` (unique), `optedOutAt`, `optedInAt`.

- [ ] **Step 1: Add the Prisma model**

Append to `packages/db/prisma/schema.prisma`:

```prisma
model SmsConsent {
  id              String    @id @default(cuid())
  phoneNormalized String    @unique
  optedOutAt      DateTime?
  optedInAt       DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}
```

- [ ] **Step 2: Generate the migration + client**

Run from `packages/db/`:

```bash
npx prisma migrate dev --name sms_consent
```

Expected: new folder `packages/db/prisma/migrations/<timestamp>_sms_consent/` containing only `CREATE TABLE "SmsConsent" ...` with the unique index; client regenerates. (Additive; no backfill — absence of a row = never opted out.)

- [ ] **Step 3: Register the new table with the test-cleanup harness**

`apps/api/src/__tests__/setup/afterEach.ts` truncates a **hardcoded** table list between tests. Add `"SmsConsent"` to the `tables` array (anywhere — it has no FK dependencies):

```ts
const tables = [
  "AssistantMessage",
  "SmsConsent",
  "RSVP",
  // ... rest unchanged
] as const;
```

Without this, consent rows leak across tests and the Task 4/5 suites poison each other.

- [ ] **Step 4: Write failing tests for the consent lib**

`apps/api/src/__tests__/lib/smsConsent.test.ts` (real test DB — same pattern as route tests; the global test harness truncates tables between tests):

```ts
import { db } from "@famlink/db";
import { isPhoneSuppressed, recordSmsOptOut, recordSmsOptIn } from "../../lib/smsConsent";

describe("smsConsent", () => {
  const phone = "+15550001111";

  it("isPhoneSuppressed is false for a number with no row", async () => {
    expect(await isPhoneSuppressed(phone)).toBe(false);
  });

  it("isPhoneSuppressed is false for an unparseable phone", async () => {
    expect(await isPhoneSuppressed("not-a-phone")).toBe(false);
  });

  it("recordSmsOptOut suppresses; normalization variants of the same number are suppressed", async () => {
    await recordSmsOptOut(phone, "SM1");
    expect(await isPhoneSuppressed(phone)).toBe(true);
    // raw formatting variant normalizes to the same E.164
    expect(await isPhoneSuppressed("(555) 000-1111")).toBe(true);
  });

  it("recordSmsOptIn clears suppression and stamps optedInAt", async () => {
    await recordSmsOptOut(phone, "SM1");
    await recordSmsOptIn(phone, "SM2");
    expect(await isPhoneSuppressed(phone)).toBe(false);
    const row = await db.smsConsent.findUnique({ where: { phoneNormalized: phone } });
    expect(row?.optedOutAt).toBeNull();
    expect(row?.optedInAt).not.toBeNull();
  });

  it("recordSmsOptOut clears optedInAt (row is never both states)", async () => {
    await recordSmsOptIn(phone, "SM1");
    await recordSmsOptOut(phone, "SM2");
    const row = await db.smsConsent.findUnique({ where: { phoneNormalized: phone } });
    expect(row?.optedOutAt).not.toBeNull();
    expect(row?.optedInAt).toBeNull();
  });

  it("opt-out is idempotent (safe Twilio retry)", async () => {
    await recordSmsOptOut(phone, "SM1");
    await recordSmsOptOut(phone, "SM1");
    expect(await isPhoneSuppressed(phone)).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/smsConsent.test.ts` (from `apps/api/`)
Expected: FAIL — module `../../lib/smsConsent` not found.

- [ ] **Step 6: Implement the lib**

`apps/api/src/lib/smsConsent.ts`:

```ts
import { db } from "@famlink/db";
import { normalizePhone } from "./contact";

/** Number-scoped TCPA suppression check. Unparseable numbers are not suppressed. */
export async function isPhoneSuppressed(rawPhone: string): Promise<boolean> {
  const phoneNormalized = normalizePhone(rawPhone);
  if (!phoneNormalized) return false;
  const row = await db.smsConsent.findUnique({ where: { phoneNormalized } });
  return row?.optedOutAt != null;
}

/** PRECONDITION for both record fns: `phoneNormalized` must be E.164 (`normalizePhone` output) — raw numbers create orphan consent rows the gate can never match. */
export async function recordSmsOptOut(phoneNormalized: string, messageSid: string): Promise<void> {
  await db.smsConsent.upsert({
    where: { phoneNormalized },
    create: { phoneNormalized, optedOutAt: new Date() },
    update: { optedOutAt: new Date(), optedInAt: null }
  });
  console.info(JSON.stringify({ event: "sms_consent_change", direction: "opt_out", phoneNormalized, messageSid }));
}

export async function recordSmsOptIn(phoneNormalized: string, messageSid: string): Promise<void> {
  await db.smsConsent.upsert({
    where: { phoneNormalized },
    create: { phoneNormalized, optedInAt: new Date() },
    update: { optedOutAt: null, optedInAt: new Date() }
  });
  console.info(JSON.stringify({ event: "sms_consent_change", direction: "opt_in", phoneNormalized, messageSid }));
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/lib/smsConsent.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 8: Verify + commit**

Run from repo root: `npm run lint && npm run type-check`
Expected: 0 errors (pre-existing warnings only). Run `mcp__gitnexus__detect_changes()` — expected scope: new `smsConsent` symbols only.

```bash
git add packages/db/prisma apps/api/src/lib/smsConsent.ts apps/api/src/__tests__/lib/smsConsent.test.ts apps/api/src/__tests__/setup/afterEach.ts
git commit -m "feat: P3-03 SmsConsent model + number-scoped consent lib"
```

---

### Task 2: Suppression gate at both Twilio send sites

**Files:**
- Modify: `apps/api/src/lib/notificationService.ts:125-133` (`sendSms`)
- Modify: `apps/api/src/lib/invitationService.ts:142-158` (SMS branch of `sendEventInvitations`)
- Test: `apps/api/src/__tests__/lib/notificationService.test.ts`, `apps/api/src/__tests__/lib/invitationService.test.ts`

**Interfaces:**
- Consumes: `isPhoneSuppressed(rawPhone)` from Task 1.
- Produces (relied on by Task 3): `sendSms(to: string, body: string, opts?: { truncate?: boolean }): Promise<boolean>` — returns `false` without calling Twilio when suppressed; `opts.truncate === false` skips the 160-char cap (default behavior unchanged).

**Note:** in BOTH test files, mock the consent lib directly rather than partially mocking `@famlink/db`
(cleaner unit boundary; a partial db mock could break unrelated tests in the same file):

```ts
const mockIsPhoneSuppressed = vi.fn();
vi.mock("../../lib/smsConsent", () => ({
  isPhoneSuppressed: (...args: unknown[]) => mockIsPhoneSuppressed(...args)
}));
```

Reset in `beforeEach` and default: `mockIsPhoneSuppressed.mockResolvedValue(false);`.

- [ ] **Step 1: Write failing tests**

Add to `apps/api/src/__tests__/lib/notificationService.test.ts` (with the lib mock above):

```ts
it("sendGuestInvitation skips SMS (no Twilio call) when the number is suppressed", async () => {
  mockIsPhoneSuppressed.mockResolvedValue(true);
  const svc = new NotificationService();
  await svc.sendGuestInvitation({
    invitationId: "inv1",
    email: null,
    phone: "+15550001111",
    message: { subject: "s", body: "b", smsBody: "b" } // smsBody exists after Task 3; before Task 3 use { subject: "s", body: "b" }
  });
  expect(mockSmsCreate).not.toHaveBeenCalled();
});

it("send() SMS channel reports success:false when suppressed", async () => {
  mockPersonFind.mockResolvedValue({ id: "p1", userId: null, email: null, phone: "+15550001111", fcmToken: null });
  mockPrefFind.mockResolvedValue([]);
  mockIsPhoneSuppressed.mockResolvedValue(true);
  const svc = new NotificationService();
  const results = await svc.send({ type: "EVENT_INVITE", recipientPersonId: "p1", title: "t", body: "b" });
  const sms = results.find((r) => r.channel === "SMS");
  expect(sms?.success).toBe(false);
  expect(mockSmsCreate).not.toHaveBeenCalled();
});
```

Add to `apps/api/src/__tests__/lib/invitationService.test.ts` (same lib mock — this file currently mocks only resend/twilio):

```ts
it("sendEventInvitations skips SMS for a suppressed guest and records an error string", async () => {
  mockIsPhoneSuppressed.mockResolvedValue(true);
  const svc = new InvitationService();
  const result = await svc.sendEventInvitations({
    eventId: "e1",
    event: { title: "T", startAt: new Date().toISOString(), locationName: null },
    familyName: "F",
    inviterName: "I",
    recipients: [{ personId: "p1", firstName: "G", email: null, phone: "+15550001111", guestToken: "tok", isGuest: true }]
  });
  expect(result.smsSent).toBe(0);
  expect(result.errors.some((e) => e.includes("suppressed"))).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/notificationService.test.ts src/__tests__/lib/invitationService.test.ts`
Expected: new tests FAIL (Twilio mock still called / no "suppressed" error).

- [ ] **Step 3: Implement the gates**

`notificationService.ts` — replace `sendSms`:

```ts
import { isPhoneSuppressed } from "./smsConsent";
import { normalizePhone } from "./contact";

  private async sendSms(to: string, body: string, opts: { truncate?: boolean } = {}): Promise<boolean> {
    if (await isPhoneSuppressed(to)) {
      console.info(JSON.stringify({ event: "sms_suppressed", to: normalizePhone(to) }));
      return false;
    }
    const text = opts.truncate === false ? body : truncateNotificationSmsBody(body);
    await this.twilioClient.messages.create({
      from: env.TWILIO_PHONE_NUMBER,
      to,
      body: text
    });
    return true;
  }
```

In `send()`'s SMS branch, surface the reason: `results.push({ channel: "SMS", success: ok, ...(ok ? {} : { error: "sms suppressed or send failed" }) });`

`invitationService.ts` — at the top of the `recipient.phone && recipient.isGuest` branch (before the guestToken check):

```ts
import { isPhoneSuppressed } from "./smsConsent";

      if (await isPhoneSuppressed(recipient.phone)) {
        errors.push(`sms ${recipient.personId}: suppressed (STOP)`);
        continue;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/lib/notificationService.test.ts src/__tests__/lib/invitationService.test.ts`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Verify + commit**

Run from repo root: `npm run lint && npm run type-check`. Run `mcp__gitnexus__detect_changes()` — expected scope: `sendSms`/`send`/`sendGuestInvitation`/`sendEventInvitations` flows only.

```bash
git add apps/api/src/lib/notificationService.ts apps/api/src/lib/invitationService.ts apps/api/src/__tests__/lib
git commit -m "feat: P3-03 gate all outbound SMS on SmsConsent suppression"
```

---

### Task 3: Guest invitation SMS — compliance footer + truncation budget

**Files:**
- Modify: `apps/api/src/lib/notificationService.ts` (`GuestInvitationMessage`, `buildGuestInvitationMessage`, `sendGuestInvitation`)
- Modify: `apps/api/src/lib/invitationService.ts` (`buildEventInviteSmsBody` — dormant path gets the same footer so reviving it can't send non-compliant SMS)
- Test: `apps/api/src/__tests__/lib/notificationService.test.ts`, `apps/api/src/__tests__/lib/invitationService.test.ts`

**Interfaces:**
- Consumes: `sendSms(to, body, { truncate: false })` from Task 2.
- Produces: `GuestInvitationMessage` gains required `smsBody: string`; exported consts `GUEST_SMS_FOOTER` and `MAX_GUEST_INVITE_SMS = 320` (imported by `invitationService.ts`). The caller (`events.ts:763`) already builds via `buildGuestInvitationMessage` and passes `message` through — **no route changes needed**.

- [ ] **Step 1: Write failing tests**

Add to `notificationService.test.ts`:

```ts
import { buildGuestInvitationMessage, GUEST_SMS_FOOTER, MAX_GUEST_INVITE_SMS } from "../../lib/notificationService";

it("guest SMS body ends with the compliance footer and contains the RSVP link", () => {
  const m = buildGuestInvitationMessage({
    eventTitle: "BBQ",
    startAt: new Date("2026-08-01T18:00:00Z"),
    rsvpUrl: "https://app.example.com/rsvp/tok123"
  });
  expect(m.smsBody.endsWith(GUEST_SMS_FOOTER)).toBe(true);
  expect(m.smsBody).toContain("https://app.example.com/rsvp/tok123");
});

it("long titles truncate but the link and footer survive, within the 320-char budget", () => {
  const m = buildGuestInvitationMessage({
    eventTitle: "x".repeat(500),
    startAt: new Date("2026-08-01T18:00:00Z"),
    rsvpUrl: "https://app.example.com/rsvp/tok123"
  });
  expect(m.smsBody.length).toBeLessThanOrEqual(MAX_GUEST_INVITE_SMS);
  expect(m.smsBody).toContain("https://app.example.com/rsvp/tok123");
  expect(m.smsBody.endsWith(GUEST_SMS_FOOTER)).toBe(true);
  expect(m.smsBody).toContain("…");
});

it("sendGuestInvitation sends the un-truncated smsBody to Twilio", async () => {
  const m = buildGuestInvitationMessage({
    eventTitle: "Reunion",
    startAt: new Date("2026-08-01T18:00:00Z"),
    rsvpUrl: "https://app.example.com/rsvp/tok123"
  });
  const svc = new NotificationService();
  await svc.sendGuestInvitation({ invitationId: "i1", email: null, phone: "+15550002222", message: m });
  expect(mockSmsCreate).toHaveBeenCalledWith(expect.objectContaining({ body: m.smsBody }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/notificationService.test.ts`
Expected: FAIL — `smsBody`/`GUEST_SMS_FOOTER` not exported.

- [ ] **Step 3: Implement**

In `notificationService.ts`:

```ts
export const GUEST_SMS_FOOTER = "Reply Y to RSVP, N to decline. Txt STOP to opt out, HELP for help.";
/** 2 SMS segments — accepted cost so the RSVP link + compliance footer never truncate (spec §7). */
export const MAX_GUEST_INVITE_SMS = 320;

export interface GuestInvitationMessage {
  subject: string;
  body: string;
  smsBody: string;
}

export function buildGuestInvitationMessage(opts: {
  eventTitle: string;
  startAt: Date;
  rsvpUrl: string;
}): GuestInvitationMessage {
  const when = opts.startAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const prefix = "You're invited to ";
  const suffix = ` on ${when}. RSVP here: ${opts.rsvpUrl}\n${GUEST_SMS_FOOTER}`;
  const budget = MAX_GUEST_INVITE_SMS - prefix.length - suffix.length;
  let title = opts.eventTitle;
  if (budget < 1) {
    title = "…";
  } else if (title.length > budget) {
    title = title.slice(0, Math.max(0, budget - 1)) + "…";
  }
  return {
    subject: `You're invited: ${opts.eventTitle}`,
    body: `You're invited to ${opts.eventTitle} on ${when}. RSVP here: ${opts.rsvpUrl}`,
    smsBody: `${prefix}${title}${suffix}`
  };
}
```

In `sendGuestInvitation`, the SMS leg switches to the budgeted body with truncation disabled:

```ts
        success = await this.sendSms(opts.phone, opts.message.smsBody, { truncate: false });
```

(Email leg keeps `opts.message.body`. Fix any Task 2 test that built a message literal to include `smsBody`.)

In `invitationService.ts`, give the dormant builder the same footer + budget (replace its `MAX_SMS` use):

```ts
import { GUEST_SMS_FOOTER, MAX_GUEST_INVITE_SMS } from "./notificationService";

export function buildEventInviteSmsBody(
  recipient: InvitationRecipient,
  payload: EventInvitationPayload
): string {
  const token = recipient.guestToken ?? "";
  const dateStr = formatEventDateTimeUtc(payload.event.startAt);
  const web = env.WEB_APP_URL.replace(/\/$/, "");
  const rsvpUrl = `${web}/rsvp?token=${encodeURIComponent(token)}`;
  const prefix = `${payload.inviterName} invited you to `;
  const suffix = ` on ${dateStr}. RSVP: ${rsvpUrl}\n${GUEST_SMS_FOOTER}`;
  const budget = MAX_GUEST_INVITE_SMS - prefix.length - suffix.length;
  let title = payload.event.title;
  if (budget < 1) {
    title = "…";
  } else if (title.length > budget) {
    title = title.slice(0, Math.max(0, budget - 1)) + "…";
  }
  return `${prefix}${title}${suffix}`;
}
```

(Delete the now-unused `MAX_SMS` const and the final `body.length > MAX_SMS` clamp — the budget already
guarantees ≤ 320 with an intact link + footer.) Add a test to `invitationService.test.ts`:

```ts
import { buildEventInviteSmsBody } from "../../lib/invitationService";
import { GUEST_SMS_FOOTER, MAX_GUEST_INVITE_SMS } from "../../lib/notificationService";

it("buildEventInviteSmsBody keeps the link and footer within the 320 budget for long titles", () => {
  const body = buildEventInviteSmsBody(
    { personId: "p1", firstName: "G", email: null, phone: "+15550001111", guestToken: "tok", isGuest: true },
    { eventId: "e1", event: { title: "x".repeat(500), startAt: new Date().toISOString(), locationName: null }, familyName: "F", inviterName: "I", recipients: [] }
  );
  expect(body.length).toBeLessThanOrEqual(MAX_GUEST_INVITE_SMS);
  expect(body).toContain("/rsvp?token=tok");
  expect(body.endsWith(GUEST_SMS_FOOTER)).toBe(true);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/lib/notificationService.test.ts`
Expected: PASS. Also run `npx vitest run src/__tests__/routes/events.test.ts` (its guest-delivery test uses the real builder).

- [ ] **Step 5: Verify + commit**

Run from repo root: `npm run lint && npm run type-check`. Run `mcp__gitnexus__detect_changes()` — expected scope: guest-invitation message builders + `sendGuestInvitation`/`sendEventInvitations` flows.

```bash
git add apps/api/src/lib/notificationService.ts apps/api/src/lib/invitationService.ts apps/api/src/__tests__
git commit -m "feat: P3-03 compliance footer + truncation budget on guest invite SMS"
```

---

### Task 4: Inbound keyword parser + handler lib

**Files:**
- Create: `apps/api/src/lib/smsInbound.ts`
- Create: `apps/api/src/lib/rsvpWindow.ts` (shared deadline helper)
- Modify: `apps/api/src/routes/guest.ts:218-222` (use the shared helper — locks SMS/web-link parity)
- Test: `apps/api/src/__tests__/lib/smsInbound.test.ts`

**Interfaces:**
- Consumes: `normalizePhone` (contact.ts); `isPhoneSuppressed`, `recordSmsOptOut`, `recordSmsOptIn` (Task 1); `db` from `@famlink/db`.
- Produces (used by Task 5):
  - `parseSmsKeyword(body: string): "STOP" | "START" | "HELP" | "YES" | "NO" | "UNKNOWN"`
  - `handleInboundSms(from: string, body: string, messageSid: string): Promise<string | null>` — returns the reply text (TwiML message) or `null` for no reply. All DB effects happen inside.
  - `rsvpClosed(event: { startAt: Date; endAt: Date | null }): boolean` (rsvpWindow.ts) — used by both guest.ts and smsInbound.ts.

**Behavior table (spec §5–§6):**

| Keyword | DB effects | Reply |
|---|---|---|
| STOP-family (`STOP STOPALL UNSUBSCRIBE CANCEL END QUIT`) | opt-out; all PENDING invitations of persons with this `phoneNormalized` → DECLINED | `null` (Twilio auto-confirms) |
| START/UNSTOP | opt-in | re-subscribe confirmation |
| HELP | none | help text — **always**, even while suppressed (CTIA requires HELP to keep working after STOP) |
| Y/YES | if suppressed: opt-in first; resolve most-recent invitation → ACCEPTED (deadline-checked); verify phone | confirmation with event title / "ended" notice / `null` if no invitation |
| N/NO | resolve → DECLINED (deadline-checked); verify phone; (suppressed: effects happen, reply suppressed) | confirmation / `null` |
| UNKNOWN | none | guidance iff a PENDING invitation exists AND not suppressed; else `null` |

**Resolution (idempotency-critical):** persons by `phoneNormalized` → `EventInvitation` by
`linkedPersonId in personIds` **regardless of status**, `orderBy [{ sentAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]`,
take 1. Resolving the most recent invitation *irrespective of status* means a Twilio retry of the same
message re-writes the same row instead of falling through to the next-most-recent PENDING one (council
round-1 BLOCKER), and a guest can change their answer (N then Y), matching web-link semantics where the
token page allows re-RSVP. Verification conflict guard: skip the `phoneVerifiedAt` write if a *different*
person already has this number verified; log `phone_verification_conflict`.

- [ ] **Step 1: Write failing parser tests**

`apps/api/src/__tests__/lib/smsInbound.test.ts` (real test DB, like Task 1):

```ts
import { db } from "@famlink/db";
import { parseSmsKeyword, handleInboundSms } from "../../lib/smsInbound";
import { isPhoneSuppressed, recordSmsOptOut } from "../../lib/smsConsent";

describe("parseSmsKeyword", () => {
  it.each([
    ["STOP", "STOP"], ["stop", "STOP"], [" Stop. ", "STOP"], ["UNSUBSCRIBE", "STOP"],
    ["QUIT", "STOP"], ["CANCEL", "STOP"], ["END", "STOP"], ["STOPALL", "STOP"],
    ["START", "START"], ["unstop", "START"],
    ["HELP", "HELP"], ["help!", "HELP"],
    ["Y", "YES"], ["yes", "YES"], ["Y!", "YES"],
    ["N", "NO"], ["No.", "NO"],
    ["maybe", "UNKNOWN"], ["YES PLEASE", "UNKNOWN"], ["", "UNKNOWN"], ["123", "UNKNOWN"]
  ])("%s -> %s", (input, expected) => {
    expect(parseSmsKeyword(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Write failing handler tests (fixture inline)**

Append to the same file:

```ts
const PHONE = "+14155550133";

async function makeFixture(opts: { sentAt?: Date; startAt?: Date; status?: string } = {}) {
  const creator = await db.person.create({ data: { firstName: "Org", lastName: "Anizer" } });
  const family = await db.familyGroup.create({ data: { name: "Fam", createdById: creator.id } });
  const event = await db.event.create({
    data: {
      familyGroupId: family.id,
      createdByPersonId: creator.id,
      title: "Summer BBQ",
      startAt: opts.startAt ?? new Date(Date.now() + 7 * 86_400_000)
    }
  });
  const guest = await db.person.create({
    data: { firstName: "Gus", lastName: "Guest", phone: PHONE, phoneNormalized: PHONE }
  });
  const invitation = await db.eventInvitation.create({
    data: {
      eventId: event.id,
      guestPhone: PHONE,
      guestToken: `tok_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      linkedPersonId: guest.id,
      status: opts.status ?? "PENDING",
      sentAt: opts.sentAt ?? new Date()
    }
  });
  return { creator, family, event, guest, invitation };
}

describe("handleInboundSms", () => {
  it("YES accepts the invitation, verifies the phone, and replies with the event title", async () => {
    const f = await makeFixture();
    const reply = await handleInboundSms(PHONE, "Y", "SM_yes");
    expect(reply).toContain("Summer BBQ");
    const inv = await db.eventInvitation.findUnique({ where: { id: f.invitation.id } });
    expect(inv?.status).toBe("ACCEPTED");
    const guest = await db.person.findUnique({ where: { id: f.guest.id } });
    expect(guest?.phoneVerifiedAt).not.toBeNull();
  });

  it("NO declines and verifies", async () => {
    const f = await makeFixture();
    await handleInboundSms(PHONE, "no", "SM_no");
    const inv = await db.eventInvitation.findUnique({ where: { id: f.invitation.id } });
    expect(inv?.status).toBe("DECLINED");
  });

  it("YES picks the most recently sent invitation when several exist", async () => {
    const older = await makeFixture({ sentAt: new Date(Date.now() - 86_400_000) });
    const newer = await makeFixture({ sentAt: new Date() });
    await handleInboundSms(PHONE, "Y", "SM_multi");
    expect((await db.eventInvitation.findUnique({ where: { id: newer.invitation.id } }))?.status).toBe("ACCEPTED");
    expect((await db.eventInvitation.findUnique({ where: { id: older.invitation.id } }))?.status).toBe("PENDING");
  });

  it("YES after the event ended does not write and replies 'ended'", async () => {
    const f = await makeFixture({ startAt: new Date(Date.now() - 86_400_000) });
    const reply = await handleInboundSms(PHONE, "Y", "SM_late");
    expect(reply).toContain("ended");
    expect((await db.eventInvitation.findUnique({ where: { id: f.invitation.id } }))?.status).toBe("PENDING");
  });

  it("YES with no invitation at all is silent", async () => {
    expect(await handleInboundSms(PHONE, "Y", "SM_none")).toBeNull();
  });

  it("replayed YES (Twilio retry) re-writes the SAME invitation — never falls through to the next one", async () => {
    const older = await makeFixture({ sentAt: new Date(Date.now() - 86_400_000) });
    const newer = await makeFixture({ sentAt: new Date() });
    await handleInboundSms(PHONE, "Y", "SM_replay");
    await handleInboundSms(PHONE, "Y", "SM_replay"); // retry of the same message
    expect((await db.eventInvitation.findUnique({ where: { id: newer.invitation.id } }))?.status).toBe("ACCEPTED");
    expect((await db.eventInvitation.findUnique({ where: { id: older.invitation.id } }))?.status).toBe("PENDING");
  });

  it("guest can change their answer: N then Y updates the same invitation to ACCEPTED", async () => {
    const f = await makeFixture();
    await handleInboundSms(PHONE, "N", "SM_first");
    await handleInboundSms(PHONE, "Y", "SM_second");
    expect((await db.eventInvitation.findUnique({ where: { id: f.invitation.id } }))?.status).toBe("ACCEPTED");
  });

  it("STOP suppresses, declines all PENDING invitations for the number, and returns null", async () => {
    const f1 = await makeFixture();
    const f2 = await makeFixture();
    const reply = await handleInboundSms(PHONE, "STOP", "SM_stop");
    expect(reply).toBeNull();
    expect(await isPhoneSuppressed(PHONE)).toBe(true);
    for (const f of [f1, f2]) {
      expect((await db.eventInvitation.findUnique({ where: { id: f.invitation.id } }))?.status).toBe("DECLINED");
    }
  });

  it("STOP from an unknown number is still recorded", async () => {
    await handleInboundSms("+14155550199", "STOP", "SM_stranger");
    expect(await isPhoneSuppressed("+14155550199")).toBe(true);
  });

  it("START clears suppression and confirms", async () => {
    await recordSmsOptOut(PHONE, "SM_pre");
    const reply = await handleInboundSms(PHONE, "START", "SM_start");
    expect(await isPhoneSuppressed(PHONE)).toBe(false);
    expect(reply).not.toBeNull();
  });

  it("YES while suppressed re-opts-in and processes the RSVP", async () => {
    const f = await makeFixture();
    await recordSmsOptOut(PHONE, "SM_pre");
    const reply = await handleInboundSms(PHONE, "YES", "SM_yes2");
    expect(await isPhoneSuppressed(PHONE)).toBe(false);
    expect(reply).toContain("Summer BBQ");
    expect((await db.eventInvitation.findUnique({ where: { id: f.invitation.id } }))?.status).toBe("ACCEPTED");
  });

  it("verification conflict: does not verify when a different person already holds a verified claim", async () => {
    const f = await makeFixture();
    await db.person.create({
      data: { firstName: "Rival", lastName: "Claim", phoneNormalized: PHONE, phoneVerifiedAt: new Date() }
    });
    await handleInboundSms(PHONE, "Y", "SM_conflict");
    const guest = await db.person.findUnique({ where: { id: f.guest.id } });
    expect(guest?.phoneVerifiedAt).toBeNull();
    // RSVP still recorded
    expect((await db.eventInvitation.findUnique({ where: { id: f.invitation.id } }))?.status).toBe("ACCEPTED");
  });

  it("HELP replies with guidance", async () => {
    const reply = await handleInboundSms(PHONE, "HELP", "SM_help");
    expect(reply).toContain("STOP");
  });

  it("HELP still replies while suppressed (CTIA)", async () => {
    await recordSmsOptOut(PHONE, "SM_pre");
    const reply = await handleInboundSms(PHONE, "HELP", "SM_help2");
    expect(reply).toContain("STOP");
  });

  it("unknown text replies with guidance only when a PENDING invitation exists", async () => {
    expect(await handleInboundSms(PHONE, "what?", "SM_u1")).toBeNull();
    await makeFixture();
    const reply = await handleInboundSms(PHONE, "what?", "SM_u2");
    expect(reply).toContain("Reply Y");
  });

  it("unparseable From is silent", async () => {
    expect(await handleInboundSms("garbage", "Y", "SM_bad")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/smsInbound.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Extract the shared deadline helper**

Create `apps/api/src/lib/rsvpWindow.ts`:

```ts
/** RSVP cutoff shared by the web link path (guest.ts) and SMS Y/N — keep in sync by construction. */
export function rsvpClosed(event: { startAt: Date; endAt: Date | null }): boolean {
  const deadline = event.endAt ?? event.startAt;
  return new Date() > deadline;
}
```

In `apps/api/src/routes/guest.ts` (`POST /invitation/:token/rsvp`, lines 218-222), replace:

```ts
  const deadline = invitation.event.endAt ?? invitation.event.startAt;
  if (new Date() > deadline) {
```

with:

```ts
  if (rsvpClosed(invitation.event)) {
```

(plus `import { rsvpClosed } from "../lib/rsvpWindow";`). Run `npx vitest run src/__tests__/routes/guest.test.ts src/__tests__/routes/guest-invitation.test.ts` — the existing deadline tests must still pass unchanged.

- [ ] **Step 5: Implement `smsInbound.ts`**

```ts
import { db } from "@famlink/db";
import { normalizePhone } from "./contact";
import { rsvpClosed } from "./rsvpWindow";
import { isPhoneSuppressed, recordSmsOptIn, recordSmsOptOut } from "./smsConsent";

export type SmsKeyword = "STOP" | "START" | "HELP" | "YES" | "NO" | "UNKNOWN";

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_WORDS = new Set(["START", "UNSTOP"]);
const YES_WORDS = new Set(["Y", "YES"]);
const NO_WORDS = new Set(["N", "NO"]);

export function parseSmsKeyword(body: string): SmsKeyword {
  const t = body.trim().toUpperCase().replace(/^[^A-Z]+/, "").replace(/[^A-Z]+$/, "");
  if (STOP_WORDS.has(t)) return "STOP";
  if (START_WORDS.has(t)) return "START";
  if (YES_WORDS.has(t)) return "YES";
  if (NO_WORDS.has(t)) return "NO";
  if (t === "HELP") return "HELP";
  return "UNKNOWN";
}

const HELP_REPLY =
  "FamLink: family event invites. Reply Y to RSVP yes, N to decline, STOP to opt out.";
const GUIDANCE_REPLY =
  "Reply Y to RSVP yes, N to decline, HELP for help, STOP to opt out.";
const RESUBSCRIBED_REPLY = "You're re-subscribed to FamLink event texts.";
const ENDED_REPLY = "This event has ended — RSVP is no longer available.";

async function findPersonIds(phoneNormalized: string): Promise<string[]> {
  const persons = await db.person.findMany({ where: { phoneNormalized }, select: { id: true } });
  return persons.map((p) => p.id);
}

/**
 * Most recent invitation for the number REGARDLESS of status: a Twilio retry of
 * the same message must re-write the same row, never fall through to the
 * next-most-recent PENDING one; also lets a guest change their answer (N→Y),
 * matching the web token page which allows re-RSVP until the deadline.
 */
async function findLatestInvitation(personIds: string[]) {
  if (personIds.length === 0) return null;
  return db.eventInvitation.findFirst({
    where: { linkedPersonId: { in: personIds } },
    orderBy: [{ sentAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    include: { event: { select: { title: true, startAt: true, endAt: true } } }
  });
}

async function hasPendingInvitation(personIds: string[]): Promise<boolean> {
  if (personIds.length === 0) return false;
  const pending = await db.eventInvitation.findFirst({
    where: { linkedPersonId: { in: personIds }, status: "PENDING" },
    select: { id: true }
  });
  return pending !== null;
}

async function verifyPhoneOwnership(phoneNormalized: string, personId: string, messageSid: string): Promise<void> {
  const conflict = await db.person.findFirst({
    where: { phoneNormalized, phoneVerifiedAt: { not: null }, id: { not: personId } },
    select: { id: true }
  });
  if (conflict) {
    console.info(JSON.stringify({ event: "phone_verification_conflict", phoneNormalized, personId, messageSid }));
    return;
  }
  await db.person.update({ where: { id: personId }, data: { phoneVerifiedAt: new Date() } });
}

/**
 * Processes one inbound SMS. Returns the reply text (rendered as TwiML by the
 * route) or null for no reply. Idempotent — Twilio retries on non-2xx.
 * Replies contain ONLY the event title (isolation invariant).
 */
export async function handleInboundSms(from: string, body: string, messageSid: string): Promise<string | null> {
  const phoneNormalized = normalizePhone(from);
  if (!phoneNormalized) {
    console.info(JSON.stringify({ event: "sms_inbound_unparseable_from", messageSid }));
    return null;
  }
  const keyword = parseSmsKeyword(body);
  const suppressed = await isPhoneSuppressed(phoneNormalized);

  if (keyword === "STOP") {
    await recordSmsOptOut(phoneNormalized, messageSid);
    const personIds = await findPersonIds(phoneNormalized);
    if (personIds.length > 0) {
      await db.eventInvitation.updateMany({
        where: { linkedPersonId: { in: personIds }, status: "PENDING" },
        data: { status: "DECLINED" }
      });
    }
    return null; // Twilio's built-in opt-out handling auto-confirms; replying would double-text
  }

  if (keyword === "START") {
    await recordSmsOptIn(phoneNormalized, messageSid);
    return RESUBSCRIBED_REPLY;
  }

  if (keyword === "HELP") {
    return HELP_REPLY; // always — CTIA requires HELP to keep working after STOP
  }

  if (keyword === "YES" || keyword === "NO") {
    if (suppressed && keyword === "YES") {
      await recordSmsOptIn(phoneNormalized, messageSid); // mirrors Twilio: YES re-opts-in
    }
    const invitation = await findLatestInvitation(await findPersonIds(phoneNormalized));
    if (!invitation || !invitation.linkedPersonId) return null;
    const canReply = keyword === "YES" || !suppressed;

    if (rsvpClosed(invitation.event)) {
      return canReply ? ENDED_REPLY : null;
    }

    await db.eventInvitation.update({
      where: { id: invitation.id },
      data: { status: keyword === "YES" ? "ACCEPTED" : "DECLINED" }
    });
    await verifyPhoneOwnership(phoneNormalized, invitation.linkedPersonId, messageSid);
    console.info(JSON.stringify({ event: "sms_inbound_rsvp", status: keyword, invitationId: invitation.id, messageSid }));

    if (!canReply) return null;
    return keyword === "YES"
      ? `RSVP received — see you at ${invitation.event.title}!`
      : `Got it — declined ${invitation.event.title}.`;
  }

  // UNKNOWN
  if (suppressed) return null;
  return (await hasPendingInvitation(await findPersonIds(phoneNormalized))) ? GUIDANCE_REPLY : null;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/lib/smsInbound.test.ts src/__tests__/routes/guest.test.ts src/__tests__/routes/guest-invitation.test.ts`
Expected: PASS (all parser + handler tests; guest deadline behavior unchanged).

- [ ] **Step 7: Verify + commit**

Run from repo root: `npm run lint && npm run type-check`. Run `mcp__gitnexus__detect_changes()` — expected scope: new `smsInbound`/`rsvpWindow` symbols + guest.ts RSVP flow.

```bash
git add apps/api/src/lib/smsInbound.ts apps/api/src/lib/rsvpWindow.ts apps/api/src/routes/guest.ts apps/api/src/__tests__/lib/smsInbound.test.ts
git commit -m "feat: P3-03 inbound SMS keyword parser + handler (Y/N RSVP, STOP/START/HELP)"
```

---

### Task 5: Twilio webhook route + env + mount

**Files:**
- Modify: `apps/api/src/lib/env.ts` (add `API_PUBLIC_URL`)
- Modify: `turbo.json` (`globalPassThroughEnv` — REQUIRED: Turborepo Strict Env Mode strips any env var not listed there; this exact failure mode bit the repo on 2026-07-01, commit `17d6b54`)
- Modify: `apps/api/src/__tests__/setup/loadTestEnv.ts` (add default)
- Modify: `.env.example` (document the var)
- Create: `apps/api/src/routes/twilioSms.ts`
- Modify: `apps/api/src/server.ts:24-33` (mount before `express.json`)
- Test: `apps/api/src/__tests__/routes/twilioSms.test.ts`

**Interfaces:**
- Consumes: `handleInboundSms` (Task 4); `env.TWILIO_AUTH_TOKEN`; twilio SDK `validateRequest` + `twiml.MessagingResponse` (both on the default export of `twilio` v5).
- Produces: `POST /api/v1/webhooks/twilio/sms` (form-encoded), 400 on bad signature, 200 + TwiML otherwise, 500 on internal error (Twilio retries; handler idempotent).

- [ ] **Step 1: Add env var**

`env.ts`, after `WEB_APP_URL`:

```ts
  /** Public https base URL of THIS API (Railway) — used to reconstruct the exact URL Twilio signed. */
  API_PUBLIC_URL: z.string().url().default("http://localhost:3001"),
```

`turbo.json`: add `"API_PUBLIC_URL"` to the `globalPassThroughEnv` array (alphabetical position fine).
Without this, Turborepo Strict Env Mode silently strips the var before it reaches `@famlink/api` and the
default (`http://localhost:3001`) kicks in — in prod that makes every valid Twilio signature fail with
400, because signatures are computed over the real public URL.

`loadTestEnv.ts`, with the other Twilio defaults: `setDefault("API_PUBLIC_URL", "http://localhost:3001");`

`.env.example`: add `API_PUBLIC_URL=` with a comment: `# Public base URL of the API itself (e.g. https://api.example.com) — required in prod for Twilio inbound signature validation`.

- [ ] **Step 2: Write failing route tests**

`apps/api/src/__tests__/routes/twilioSms.test.ts` (Clerk webhook test pattern: `createApp` + supertest + real DB; signatures computed with the SDK helper against the same env values the route reads):

```ts
import request from "supertest";
import twilio from "twilio";
import { db } from "@famlink/db";
import { createApp } from "../../server";
import { env } from "../../lib/env";

const WEBHOOK_URL = `${env.API_PUBLIC_URL.replace(/\/$/, "")}/api/v1/webhooks/twilio/sms`;

function sign(params: Record<string, string>): string {
  return twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, WEBHOOK_URL, params);
}

describe("POST /api/v1/webhooks/twilio/sms", () => {
  const app = createApp();
  const base = { MessageSid: "SM123", From: "+14155550144", To: "+15555551234" };

  it("400 when the signature header is missing", async () => {
    const res = await request(app).post("/api/v1/webhooks/twilio/sms").type("form").send({ ...base, Body: "Y" });
    expect(res.status).toBe(400);
  });

  it("400 when the signature is invalid", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks/twilio/sms")
      .set("X-Twilio-Signature", "obviously-wrong")
      .type("form")
      .send({ ...base, Body: "Y" });
    expect(res.status).toBe(400);
  });

  it("200 + TwiML message reply for HELP with a valid signature", async () => {
    const params = { ...base, Body: "HELP" };
    const res = await request(app)
      .post("/api/v1/webhooks/twilio/sms")
      .set("X-Twilio-Signature", sign(params))
      .type("form")
      .send(params);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("xml");
    expect(res.text).toContain("<Message>");
    expect(res.text).toContain("STOP");
  });

  it("200 + empty TwiML for STOP, and the number is suppressed", async () => {
    const params = { ...base, Body: "STOP" };
    const res = await request(app)
      .post("/api/v1/webhooks/twilio/sms")
      .set("X-Twilio-Signature", sign(params))
      .type("form")
      .send(params);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("<Message>");
    const row = await db.smsConsent.findUnique({ where: { phoneNormalized: "+14155550144" } });
    expect(row?.optedOutAt).not.toBeNull();
  });

  it("end-to-end: signed Y accepts the invitation through the mounted route", async () => {
    const creator = await db.person.create({ data: { firstName: "Org", lastName: "Anizer" } });
    const family = await db.familyGroup.create({ data: { name: "Fam", createdById: creator.id } });
    const event = await db.event.create({
      data: { familyGroupId: family.id, createdByPersonId: creator.id, title: "Route BBQ", startAt: new Date(Date.now() + 86_400_000) }
    });
    const guest = await db.person.create({
      data: { firstName: "Gus", lastName: "Guest", phone: base.From, phoneNormalized: base.From }
    });
    const invitation = await db.eventInvitation.create({
      data: { eventId: event.id, guestPhone: base.From, guestToken: "tok_route_y", linkedPersonId: guest.id, status: "PENDING", sentAt: new Date() }
    });

    const params = { ...base, Body: "Y" };
    const res = await request(app)
      .post("/api/v1/webhooks/twilio/sms")
      .set("X-Twilio-Signature", sign(params))
      .type("form")
      .send(params);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Route BBQ");
    expect((await db.eventInvitation.findUnique({ where: { id: invitation.id } }))?.status).toBe("ACCEPTED");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/routes/twilioSms.test.ts`
Expected: FAIL — 404 (route not mounted).

- [ ] **Step 4: Implement the route + mount**

`apps/api/src/routes/twilioSms.ts`:

```ts
import type { Request, Response } from "express";
import { Router } from "express";
import twilio from "twilio";
import { env } from "../lib/env";
import { handleInboundSms } from "../lib/smsInbound";

export const twilioSmsRouter = Router();

/** Computed per-request (not module load) so env-loading order can never bake in a stale URL. */
function webhookUrl(): string {
  return `${env.API_PUBLIC_URL.replace(/\/$/, "")}/api/v1/webhooks/twilio/sms`;
}

twilioSmsRouter.post("/", async (req: Request, res: Response) => {
  const signature = req.headers["x-twilio-signature"];
  const params = (req.body ?? {}) as Record<string, string>;

  if (
    typeof signature !== "string" ||
    !twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, webhookUrl(), params)
  ) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  const from = params.From;
  const body = typeof params.Body === "string" ? params.Body : "";
  const messageSid = params.MessageSid ?? "";
  if (!from) {
    return res.status(400).json({ error: "Missing From" });
  }

  try {
    const reply = await handleInboundSms(from, body, messageSid);
    const twiml = new twilio.twiml.MessagingResponse();
    if (reply) {
      twiml.message(reply);
    }
    return res.type("text/xml").status(200).send(twiml.toString());
  } catch (e) {
    console.error(JSON.stringify({ event: "sms_inbound_error", messageSid, error: e instanceof Error ? e.message : String(e) }));
    return res.status(500).json({ error: "Internal error" }); // Twilio retries; handler is idempotent
  }
});
```

`server.ts` — after the billing webhook mount, before `express.json`:

```ts
import { twilioSmsRouter } from "./routes/twilioSms";

  app.use(
    "/api/v1/webhooks/twilio/sms",
    express.urlencoded({ extended: false }),
    twilioSmsRouter
  );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/routes/twilioSms.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Verify + commit**

Run from repo root: `npm run lint && npm run type-check`. Run `mcp__gitnexus__detect_changes()` — expected scope: new `twilioSms` route symbols + `createApp`.

```bash
git add apps/api/src/routes/twilioSms.ts apps/api/src/server.ts apps/api/src/lib/env.ts apps/api/src/__tests__/setup/loadTestEnv.ts apps/api/src/__tests__/routes/twilioSms.test.ts .env.example
git commit -m "feat: P3-03 Twilio inbound SMS webhook (signature-verified, TwiML replies)"
```

---

### Task 6: Full verification + docs

**Files:**
- Modify: `docs/FamLink_Secrets_Runbook.md` (auth-token addendum)
- No code changes — verification sweep.

**Interfaces:** none produced; consumes everything above.

- [ ] **Step 1: Full suites**

Run from repo root:

```bash
npm test --workspace=@famlink/api
npm test --workspace=@famlink/web
npm run type-check
npm run lint
git diff --check
```

Expected: API suite green (423 pre-existing + ~30 new), web coverage gate ≥80% (web untouched — baseline 87.29% holds), type-check 6/6, lint 0 errors.

- [ ] **Step 2: detect_changes**

Run `mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })`. Expected affected scope: `notificationService` flows (SendGuestInvitation/Send chains), `invitationService`, new `smsConsent`/`smsInbound`/`twilioSms` symbols. Anything outside that list → investigate before proceeding.

- [ ] **Step 3: Runbook addendum**

Append to the `TWILIO_AUTH_TOKEN` entry in `docs/FamLink_Secrets_Runbook.md`:

```markdown
> **Inbound-webhook note (W3b, 2026-07):** the auth token now also validates inbound SMS webhook
> signatures (`POST /api/v1/webhooks/twilio/sms`). Rotate via secondary-token promotion (as done
> 2026-07-06) so in-flight inbound requests keep validating; after promotion, old-token signatures
> fail with 400 (Twilio retries with the new signature automatically since Twilio signs per-request).
```

- [ ] **Step 4: Commit**

```bash
git add docs/FamLink_Secrets_Runbook.md
git commit -m "docs: P3-03 W3b runbook addendum — auth token validates inbound SMS signatures"
```

---

## Deploy checklist (Steve, after merge — spec §10)

1. Run the Prisma migration in prod (Railway): `npx prisma migrate deploy`.
2. Set `API_PUBLIC_URL` in Railway prod (and Infisical) to the API's public https URL.
3. Twilio console: set the number's "A message comes in" webhook to `https://<api>/api/v1/webhooks/twilio/sms` (HTTP POST).
4. Keep Twilio's default opt-out handling **ON** (carrier-level backstop).
5. Smoke: text STOP then START then Y to the FamLink number from a phone with a pending test invitation.
