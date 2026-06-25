# Contact Identity Foundation — Design

| Field | Value |
|---|---|
| Status | **DRAFT — for Steve review → writing-plans. Not authorized to build.** |
| Created | 2026-06-25 |
| Why now | Pulled forward (Steve, 2026-06-25) ahead of W3a-UI-web so cross-family invite/participation builds on durable identity with **no dedup debt**. Was part of W3b's deferred contact-verification prerequisite. |
| Phase tag | P3-03 |
| Related | `Person` (schema), `routes/webhooks.ts` (Clerk webhook), `matchPersonByContact` (events.ts), guest invites/RSVP, W3a `EventParticipant`, W3a-UI-web spec (2026-06-25) |

> Establishes one durable contact identity per person: normalized contacts, verified-only uniqueness, a canonical resolver, Clerk-sourced verification, and a guest→member merge. Decisions from the 2026-06-25 brainstorm + a prod data check are recorded inline.

---

## 0. Why

Cross-family invitation/participation depends on reliably answering "is this contact already a person/account, and which one?" Today: `Person.email`/`phone` are **not normalized and not unique**, `matchPersonByContact` is an exact-string match, guests live only as fields on invitation rows, and there is **no guest→member merge** — so building more invite UI on this accrues duplicate/unlinked records. This foundation fixes identity first.

**Prod data check (2026-06-25, Railway):** 12 persons, 3 families, 3 events, 0 invitations, 5 RSVPs; **0 email/phone collisions; 0 of 12 persons have an email** (emails live in Clerk; 7 have accounts). Conclusion: data is tiny, clean, and disposable-grade — **no wipe needed; no dedupe migration needed.** The migration is purely additive + a small Clerk backfill.

## 1. Scope

**In (full foundation):** (1) contact normalization, (2) canonical resolver, (3) verified-only uniqueness, (4) guest→member merge/claim, (5) `verifiedAt` flag sourced from Clerk.

**Out:** phone **verification delivery** (SMS code) → **W3b**; inbound SMS → W3b; the W3a-UI-web surfaces → next cycle. Phone uniqueness exists structurally but won't be populated/verified until W3b provides phone verification.

## 2. Decisions (2026-06-25, Steve)

1. **Full foundation** (parts 1–5).
2. **Verified-only uniqueness:** a normalized email/phone is unique only among **verified** contacts (partial unique index `WHERE verifiedAt IS NOT NULL`); unverified contacts may repeat (a parent's email on a child's unverified contact stays legal).
3. **`libphonenumber-js`** for phone E.164 normalization (approved new dependency).
4. **Keep prod, clean additive migration** (data is clean/collision-free) — no wipe, no dedupe logic.
5. **Verification source = Clerk** (email); extend the existing webhook + one-time backfill. Phone verification = W3b.

## 3. Data model (`Person`)

Add: `emailNormalized String?`, `phoneNormalized String?`, `emailVerifiedAt DateTime?`, `phoneVerifiedAt DateTime?`. Keep `email`/`phone` as-entered for display.

**Partial unique indexes** (raw SQL in the Prisma migration — Prisma attributes can't express partial uniqueness):
```sql
CREATE UNIQUE INDEX "Person_emailNormalized_verified_key"
  ON "Person"("emailNormalized") WHERE "emailVerifiedAt" IS NOT NULL;
CREATE UNIQUE INDEX "Person_phoneNormalized_verified_key"
  ON "Person"("phoneNormalized") WHERE "phoneVerifiedAt" IS NOT NULL;
```
Plain (non-unique) indexes on `emailNormalized`, `phoneNormalized` for resolver lookups.

## 4. Normalization (`lib/contact.ts`, new)

- `normalizeEmail(raw): string | null` — trim + lowercase; null if empty/invalid.
- `normalizePhone(raw, defaultCountry = "US"): string | null` — `libphonenumber-js` → E.164; null if unparseable.
- Pure functions, unit-tested for edge cases; called on every `Person` contact write.

## 5. Canonical resolver (`lib/personIdentity.ts`, new)

`findOrCreatePersonByContact({ email?, phone?, name? }): Promise<Person>` — normalize inputs → look up by normalized contact, **preferring a verified match**, else any match, else create a contact-only `Person` (`userId: null`) with the provided name. Replaces `matchPersonByContact` at its call sites (guest invites; W3a-UI elevation). Read path is normalized, so format differences no longer cause misses.

## 6. Verification source — Clerk (`routes/webhooks.ts`, extend)

The webhook already upserts `Person` from Clerk `user.created`/`user.updated` with `email = primaryEmail`. Extend it to also set `emailNormalized` and **`emailVerifiedAt = now`** (Clerk delivers only verified primary emails). 

**Claim/merge on the webhook (account claim path):** on `user.created`, before creating a new Person, check for an existing **contact-only** `Person` (`userId: null`) whose **verified** normalized email equals the new account's — if found, **claim** it (set `userId` + names + verified contact) instead of creating a duplicate; if that contact-only person also collides with another verified person, run `mergePersons` (§7). 

**One-time backfill:** a script sets `email`/`emailNormalized`/`emailVerifiedAt` for the 7 existing accounted persons from the Clerk backend API. (Phone left null; phone verification = W3b.)

## 7. Merge / claim (`lib/personIdentity.ts`)

`mergePersons(canonicalId, duplicateId): Promise<void>` — in one transaction: re-point **every** `Person`-referencing FK from the duplicate to the canonical person, dedupe rows that would break a compound unique, then delete the duplicate. The plan enumerates the FK set exhaustively from the schema; known references: `FamilyMember`, `HouseholdMember`, `RSVP(eventId,personId)`, `EventInvitation.personId`+`linkedPersonId`, `EventParticipant(eventId,personId)`, `PersonRelationship.fromPersonId`+`toPersonId`, `EventItem.createdByPersonId`+`assignedToPersonId`, `AssistantMessage.personId`, `NotificationPreference(personId,channel,notifType)`, `Event.createdByPersonId`+`birthdayPersonId`, photos.

**Triggers:** (a) account claim (§6); (b) guest reconcile — when a guest invitation's contact resolves (via the resolver) to a verified person, link/merge the guest's invitation + RSVP rows to that person.

**Conflict policy:** merging two **account** persons (both `userId`) should not occur under verified-uniqueness; if attempted, refuse and log for manual review (never silently drop an account).

## 8. Migration

Additive Prisma migration: add the four columns + the two partial unique indexes + the two plain indexes. Backfill `*Normalized` for existing rows (trivial — emails are null; normalize the few phones). Then the one-time Clerk email backfill (§6) for the 7 accounted persons. **No dedupe step** (prod has 0 collisions); a pre-flight read-only collision check guards the assumption and aborts with a report if violated.

## 9. Isolation / safety

`Person` is already a global entity (the cross-family shared-person bridge), so contact uniqueness is global by design and *enables* sharing. Uniqueness is verified-only, preserving shared family contacts. `mergePersons` is transactional + FK-complete (no dangling refs) and never merges across the account/account boundary. The webhook's svix signature verification is unchanged.

## 10. Testing

- **Unit:** `normalizeEmail`/`normalizePhone` edge cases; resolver (verified-preferred match, any-match, create-when-absent).
- **DB integration:** partial uniqueness (two **verified** same normalized email → rejected; two **unverified** → allowed); webhook sets `emailNormalized`+`emailVerifiedAt`; webhook claim path links a matching contact-only person instead of duplicating.
- **Merge:** `mergePersons` re-points each FK type, dedupes compound-unique collisions, deletes the duplicate; guest-reconcile links invitation/RSVP rows; account/account merge refused.
- **Migration:** pre-flight collision check; additive apply on a seeded dataset; backfill correctness.

## 11. Out of scope

Phone verification delivery (SMS code) → **W3b**; inbound SMS/STOP → W3b; the W3a-UI-web surfaces → next cycle (they consume `findOrCreatePersonByContact` + the verified flag).

## 12. Open questions for review

1. **Backfill mechanism for the 7 accounts:** a one-time script via the Clerk backend SDK (precise, recommended) vs. lazy self-heal on each user's next `user.updated` webhook (zero code, slower). Default: script.
2. **Guest reconcile timing:** reconcile guest rows eagerly at claim time (merge history immediately) vs. lazily when the event is next read. Default: eager at claim (cleaner history).
3. **Default phone country** for `normalizePhone` (`US` for the beta) — confirm, or read from input only (require full E.164 from callers).
