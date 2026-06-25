# Contact Identity Foundation — Plan A (Backbone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish durable, normalized, verified-unique contact identity on `Person` — normalization, a canonical resolver, verified-only uniqueness, and Clerk-sourced email verification.

**Architecture:** Add normalized + verified-at columns to `Person`; enforce uniqueness via partial unique indexes (verified contacts only); route all contact resolution through one `findOrCreatePersonByContact`; source email verification from the existing Clerk webhook + a one-time backfill. The merge/reconcile engine is **Plan B** (separate).

**Tech Stack:** TypeScript, Express, Prisma (`@famlink/db`), `libphonenumber-js` (new), Clerk webhook (svix), Vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-06-25-contact-identity-foundation-design.md`

## Global Constraints

- **Test runner:** Vitest from `apps/api` (`npx vitest run <path>`). Lib/DB tests hit local Postgres `famlink_test`; route/webhook tests use supertest.
- **Commit format:** `feat: P3-03 <short description>`.
- **`@famlink/db` resolves to compiled `dist/`** — after any schema change, run `cd packages/db && npx prisma generate && npm run build` or the API sees a stale client.
- **Verified-only uniqueness:** a normalized email/phone is unique only among rows where the matching `*VerifiedAt IS NOT NULL` (partial unique index). Unverified contacts may repeat.
- **Normalization:** email = trim + lowercase; phone = E.164 via `libphonenumber-js` (default country `US`). Normalized values written on every `Person` contact write.
- **Verification source = Clerk** (email). Phone verification delivery = W3b (column exists, left null here).
- **Prod is clean** (0 contact collisions, 0 emails) — migration is additive; a pre-flight collision check guards the assumption.
- **No merge logic in this plan** — `mergePersons`, the webhook claim path, and guest reconcile are **Plan B**.

---

## File Structure

- **Create** `apps/api/src/lib/contact.ts` — `normalizeEmail`, `normalizePhone` (pure).
- **Create** `apps/api/src/lib/__tests__/contact.test.ts`.
- **Modify** `packages/db/prisma/schema.prisma` — `Person` += 4 columns + 2 plain indexes; new migration with hand-added partial unique indexes.
- **Create** `apps/api/src/lib/personIdentity.ts` — `findOrCreatePersonByContact`.
- **Create** `apps/api/src/lib/__tests__/personIdentity.test.ts`.
- **Modify** `apps/api/src/routes/webhooks.ts` — set `emailNormalized` + `emailVerifiedAt` on Clerk upsert.
- **Modify** `apps/api/src/routes/__tests__/webhooks.test.ts`.
- **Modify** `apps/api/src/routes/events.ts` — guest-invite branch uses `findOrCreatePersonByContact`.
- **Modify** `apps/api/src/routes/__tests__/events.test.ts`.
- **Create** `apps/api/src/scripts/backfillClerkContacts.ts` — one-time backfill for accounted persons.

---

### Task 1: Contact normalization (`contact.ts`)

**Files:**
- Create: `apps/api/src/lib/contact.ts`
- Test: `apps/api/src/lib/__tests__/contact.test.ts`
- Modify: `apps/api/package.json` (add `libphonenumber-js`)

**Interfaces:**
- Produces: `normalizeEmail(raw: string | null | undefined): string | null`; `normalizePhone(raw: string | null | undefined, defaultCountry?: string): string | null`.

- [ ] **Step 1: Add the dependency**

Run: `cd apps/api && npm install libphonenumber-js`
Expected: `libphonenumber-js` appears in `apps/api/package.json` dependencies.

- [ ] **Step 2: Write the failing tests**

Create `apps/api/src/lib/__tests__/contact.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizeEmail, normalizePhone } from "../contact";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  John.Doe@Example.COM ")).toBe("john.doe@example.com");
  });
  it("returns null for empty/nullish", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("formats a US number to E.164", () => {
    expect(normalizePhone("(415) 555-2671")).toBe("+14155552671");
    expect(normalizePhone("415-555-2671")).toBe("+14155552671");
  });
  it("respects an explicit country code in the input", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("returns null for unparseable/empty", () => {
    expect(normalizePhone("not a phone")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/lib/__tests__/contact.test.ts`
Expected: FAIL — `../contact` not found.

- [ ] **Step 4: Implement**

Create `apps/api/src/lib/contact.ts`:

```typescript
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry: string = "US"
): string | null {
  if (!raw || raw.trim().length === 0) return null;
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry as CountryCode);
  return parsed && parsed.isValid() ? parsed.number : null;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/lib/__tests__/contact.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/contact.ts apps/api/src/lib/__tests__/contact.test.ts apps/api/package.json apps/api/package-lock.json
git commit -m "feat: P3-03 contact normalization (email lowercase, phone E.164)"
```

---

### Task 2: Schema — normalized + verified columns + partial unique indexes

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (`Person`)
- Migration: `packages/db/prisma/migrations/<ts>_person_contact_identity/migration.sql`

**Interfaces:**
- Produces: `Person.emailNormalized`, `Person.phoneNormalized`, `Person.emailVerifiedAt`, `Person.phoneVerifiedAt`; partial unique indexes on normalized contacts where verified; plain indexes on normalized columns.

- [ ] **Step 1: Edit the schema**

In `packages/db/prisma/schema.prisma`, `model Person`, add after `phone String?` (line ~23):

```prisma
  emailNormalized String?
  phoneNormalized String?
  emailVerifiedAt DateTime?
  phoneVerifiedAt DateTime?
```

And add to the index block (near `@@index([userId])`):

```prisma
  @@index([emailNormalized])
  @@index([phoneNormalized])
```

- [ ] **Step 2: Generate the migration (create-only) and add partial unique indexes by hand**

Run: `cd packages/db && npx prisma migrate dev --name person_contact_identity --create-only`
Then append to the generated `migration.sql`:

```sql
CREATE UNIQUE INDEX "Person_emailNormalized_verified_key"
  ON "Person"("emailNormalized") WHERE "emailVerifiedAt" IS NOT NULL;
CREATE UNIQUE INDEX "Person_phoneNormalized_verified_key"
  ON "Person"("phoneNormalized") WHERE "phoneVerifiedAt" IS NOT NULL;
```

- [ ] **Step 3: Apply + regenerate client + rebuild db package**

Run: `cd packages/db && npx prisma migrate dev && npm run build`
Expected: migration applies to `famlink_dev`/`famlink_test`; client + `dist/` rebuilt with the new fields.

- [ ] **Step 4: Smoke test the columns + partial uniqueness**

Create `apps/api/src/lib/__tests__/personIdentity.test.ts` (expanded in Task 3) with a uniqueness smoke test:

```typescript
import { db } from "@famlink/db";
import { describe, it, expect } from "vitest";

describe("Person contact partial uniqueness", () => {
  it("rejects two VERIFIED persons with the same normalized email", async () => {
    await db.person.create({ data: { firstName: "A", lastName: "X", ageGateLevel: "ADULT", emailNormalized: "dup@x.com", emailVerifiedAt: new Date() } });
    await expect(
      db.person.create({ data: { firstName: "B", lastName: "Y", ageGateLevel: "ADULT", emailNormalized: "dup@x.com", emailVerifiedAt: new Date() } })
    ).rejects.toThrow();
  });
  it("allows two UNVERIFIED persons with the same normalized email", async () => {
    await db.person.create({ data: { firstName: "C", lastName: "X", ageGateLevel: "ADULT", emailNormalized: "shared@x.com" } });
    await expect(
      db.person.create({ data: { firstName: "D", lastName: "Y", ageGateLevel: "ADULT", emailNormalized: "shared@x.com" } })
    ).resolves.toBeTruthy();
  });
});
```

- [ ] **Step 5: Run it**

Run: `cd apps/api && npx vitest run src/lib/__tests__/personIdentity.test.ts`
Expected: PASS (partial unique index enforces verified-only uniqueness).

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/api/src/lib/__tests__/personIdentity.test.ts
git commit -m "feat: P3-03 Person normalized+verified contact columns with verified-only unique indexes"
```

---

### Task 3: Canonical resolver (`findOrCreatePersonByContact`)

**Files:**
- Create: `apps/api/src/lib/personIdentity.ts`
- Test: `apps/api/src/lib/__tests__/personIdentity.test.ts` (extend)

**Interfaces:**
- Consumes: `normalizeEmail`, `normalizePhone` (Task 1); `db`.
- Produces: `findOrCreatePersonByContact(input: { email?: string | null; phone?: string | null; name?: string | null }): Promise<Person>` — normalizes; looks up by normalized email or phone, **preferring a verified match** (`emailVerifiedAt`/`phoneVerifiedAt` not null), else any match; else creates a contact-only `Person` (`userId: null`, names split from `name` or defaulted) with normalized columns set.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/lib/__tests__/personIdentity.test.ts`:

```typescript
import { findOrCreatePersonByContact } from "../personIdentity";

describe("findOrCreatePersonByContact", () => {
  it("creates a contact-only person when no match", async () => {
    const p = await findOrCreatePersonByContact({ email: "New.Person@X.com", name: "New Person" });
    expect(p.userId).toBeNull();
    expect(p.emailNormalized).toBe("new.person@x.com");
    expect(p.firstName).toBe("New");
  });
  it("returns an existing person matched by normalized email", async () => {
    const created = await db.person.create({ data: { firstName: "Match", lastName: "Me", ageGateLevel: "ADULT", emailNormalized: "match@x.com" } });
    const got = await findOrCreatePersonByContact({ email: "MATCH@x.com" });
    expect(got.id).toBe(created.id);
  });
  it("prefers a VERIFIED match over an unverified one", async () => {
    await db.person.create({ data: { firstName: "Unv", lastName: "A", ageGateLevel: "ADULT", emailNormalized: "pref@x.com" } });
    const verified = await db.person.create({ data: { firstName: "Ver", lastName: "B", ageGateLevel: "ADULT", emailNormalized: "pref@x.com", emailVerifiedAt: new Date() } });
    const got = await findOrCreatePersonByContact({ email: "pref@x.com" });
    expect(got.id).toBe(verified.id);
  });
  it("matches by phone when email absent", async () => {
    const created = await db.person.create({ data: { firstName: "Ph", lastName: "One", ageGateLevel: "ADULT", phoneNormalized: "+14155552671" } });
    const got = await findOrCreatePersonByContact({ phone: "(415) 555-2671" });
    expect(got.id).toBe(created.id);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/lib/__tests__/personIdentity.test.ts`
Expected: FAIL — `findOrCreatePersonByContact` not exported.

- [ ] **Step 3: Implement**

Create `apps/api/src/lib/personIdentity.ts`:

```typescript
import { db } from "@famlink/db";
import type { Person } from "@famlink/db";
import { normalizeEmail, normalizePhone } from "./contact";

function splitName(name?: string | null): { firstName: string; lastName: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Guest", lastName: "-" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "-" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function findOrCreatePersonByContact(input: {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}): Promise<Person> {
  const emailNormalized = normalizeEmail(input.email);
  const phoneNormalized = normalizePhone(input.phone);

  if (emailNormalized || phoneNormalized) {
    const matches = await db.person.findMany({
      where: {
        OR: [
          ...(emailNormalized ? [{ emailNormalized }] : []),
          ...(phoneNormalized ? [{ phoneNormalized }] : [])
        ]
      }
    });
    if (matches.length > 0) {
      // Prefer a verified match on the contact we were given.
      const verified = matches.find(
        (m) =>
          (emailNormalized && m.emailNormalized === emailNormalized && m.emailVerifiedAt !== null) ||
          (phoneNormalized && m.phoneNormalized === phoneNormalized && m.phoneVerifiedAt !== null)
      );
      return verified ?? matches[0];
    }
  }

  const { firstName, lastName } = splitName(input.name);
  return db.person.create({
    data: { userId: null, firstName, lastName, ageGateLevel: "ADULT", emailNormalized, phoneNormalized }
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/lib/__tests__/personIdentity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/personIdentity.ts apps/api/src/lib/__tests__/personIdentity.test.ts
git commit -m "feat: P3-03 canonical findOrCreatePersonByContact resolver"
```

---

### Task 4: Webhook sets normalized + verified email

**Files:**
- Modify: `apps/api/src/routes/webhooks.ts`
- Test: `apps/api/src/routes/__tests__/webhooks.test.ts`

**Interfaces:**
- Consumes: `normalizeEmail` (Task 1).
- Behavior: on `user.created`/`user.updated`, when an email is present, also set `emailNormalized` + `emailVerifiedAt = now` (Clerk delivers verified primary emails). No merge/claim in this plan (Plan B).

- [ ] **Step 1: Write the failing test**

In `apps/api/src/routes/__tests__/webhooks.test.ts`, add (follow the file's existing svix-mock pattern):

```typescript
it("sets emailNormalized and emailVerifiedAt from the Clerk email", async () => {
  // arrange: a verified user.created payload with email "User@Example.com"
  // (reuse the file's signed-payload helper)
  await postUserCreated({ id: "clerk_x", email_addresses: [{ email_address: "User@Example.com" }] });
  const p = await db.person.findUnique({ where: { userId: "clerk_x" } });
  expect(p?.emailNormalized).toBe("user@example.com");
  expect(p?.emailVerifiedAt).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/__tests__/webhooks.test.ts`
Expected: FAIL — columns not set.

- [ ] **Step 3: Implement**

In `apps/api/src/routes/webhooks.ts`: import `import { normalizeEmail } from "../lib/contact";`. In the `user.created`/`user.updated` block, compute `const emailNormalized = normalizeEmail(primaryEmail);` and add to BOTH the `create` and `update` objects of the `db.person.upsert`:

```typescript
          emailNormalized,
          emailVerifiedAt: emailNormalized ? new Date() : null,
```

(Keep `email: primaryEmail` as-is for display.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/routes/__tests__/webhooks.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/webhooks.ts apps/api/src/routes/__tests__/webhooks.test.ts
git commit -m "feat: P3-03 webhook sets normalized + verified email on Person"
```

---

### Task 5: Route guest invites through the resolver

**Files:**
- Modify: `apps/api/src/routes/events.ts`
- Test: `apps/api/src/routes/__tests__/events.test.ts`

**Interfaces:**
- Consumes: `findOrCreatePersonByContact` (Task 3).
- Behavior: replace the ad-hoc `matchPersonByContact` in the guest-invite branch with `findOrCreatePersonByContact`, so a guest's contact resolves (normalized) to a canonical person and the invitation's `linkedPersonId` is set from it. Existing guest behavior (token, RSVP link) preserved; the difference is normalized matching + a contact-only Person now exists for the guest.

- [ ] **Step 1: Write the failing test**

In `events.test.ts`, add to the invitations describe:

```typescript
it("guest invite links to a person resolved by normalized contact", async () => {
  // pre-create a contact-only person with emailNormalized "guest@x.com"
  // then invite guestEmail "GUEST@x.com" (different case) to the event
  const res = await request(app).post(`/api/v1/events/${eventId}/invitations`)
    .send({ invitees: [{ kind: "guest", guestEmail: "GUEST@x.com", guestName: "G" }] });
  expect(res.status).toBe(201);
  const inv = await db.eventInvitation.findFirst({ where: { eventId, guestEmail: "GUEST@x.com" } });
  expect(inv?.linkedPersonId).toBe(preCreatedPersonId);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/__tests__/events.test.ts`
Expected: FAIL — exact-match `matchPersonByContact` misses the case-different email.

- [ ] **Step 3: Implement**

In `events.ts`: import `findOrCreatePersonByContact` from `../lib/personIdentity`. In the guest branch of `POST /:eventId/invitations`, replace `const match = await matchPersonByContact(invitee.guestEmail, invitee.guestPhone);` with:

```typescript
        const match = await findOrCreatePersonByContact({
          email: invitee.guestEmail,
          phone: invitee.guestPhone,
          name: invitee.guestName
        });
```

and set `linkedPersonId: match.id` (no longer `match?.id ?? null` — the resolver always returns a person). Remove the now-unused `matchPersonByContact` function if no other call sites remain (grep first; W3a-UI's elevation will also adopt the resolver later — leave `matchPersonByContact` removed only if unreferenced).

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/routes/__tests__/events.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/events.ts apps/api/src/routes/__tests__/events.test.ts
git commit -m "feat: P3-03 resolve guest invite contacts via canonical resolver"
```

---

### Task 6: One-time Clerk contact backfill script

**Files:**
- Create: `apps/api/src/scripts/backfillClerkContacts.ts`

**Interfaces:**
- A standalone script (run once) that, for each `Person` with a `userId` but no `emailNormalized`, fetches the Clerk user's primary verified email and sets `email`, `emailNormalized`, `emailVerifiedAt`. Idempotent; logs a summary; skips rows that would collide (logs them for manual review rather than failing).

- [ ] **Step 1: Implement the script**

Create `apps/api/src/scripts/backfillClerkContacts.ts`:

```typescript
/**
 * One-time backfill: copy Clerk-verified emails onto Person rows that have an
 * account but no normalized email. Run: `npx tsx src/scripts/backfillClerkContacts.ts`
 * Idempotent. Collisions (a verified email already owned by another person) are
 * logged and skipped, not applied.
 */
import { createClerkClient } from "@clerk/backend";
import { db } from "@famlink/db";
import { env } from "../lib/env";
import { normalizeEmail } from "../lib/contact";

async function main(): Promise<void> {
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const targets = await db.person.findMany({
    where: { userId: { not: null }, emailNormalized: null },
    select: { id: true, userId: true }
  });
  let updated = 0;
  const collisions: string[] = [];
  for (const p of targets) {
    const user = await clerk.users.getUser(p.userId as string);
    const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
    const emailNormalized = normalizeEmail(primary?.emailAddress ?? null);
    if (!emailNormalized) continue;
    const clash = await db.person.findFirst({
      where: { emailNormalized, emailVerifiedAt: { not: null }, NOT: { id: p.id } },
      select: { id: true }
    });
    if (clash) { collisions.push(`${p.id} <-> ${clash.id} (${emailNormalized})`); continue; }
    await db.person.update({
      where: { id: p.id },
      data: { email: primary?.emailAddress, emailNormalized, emailVerifiedAt: new Date() }
    });
    updated++;
  }
  console.log(`Backfill complete: ${updated} updated, ${collisions.length} collisions skipped.`);
  if (collisions.length > 0) console.log("Collisions (manual review):\n" + collisions.join("\n"));
}

void main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

(If `@clerk/backend` is not already a dependency, `cd apps/api && npm install @clerk/backend`. `env.CLERK_SECRET_KEY` must exist in `lib/env.ts`; if the key name differs, use the existing Clerk secret key env var.)

- [ ] **Step 2: Type-check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no type errors. (The script is not unit-tested — it's a one-shot operational tool; verify it compiles. Running it against prod is an execution-time step done with Steve, not in this plan.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/scripts/backfillClerkContacts.ts apps/api/package.json apps/api/package-lock.json
git commit -m "feat: P3-03 one-time Clerk verified-contact backfill script"
```

---

## Out of scope (Plan B / later)

- **`mergePersons`** (re-point every Person FK + dedupe compound-uniques + delete), the **webhook claim path** (claim a matching contact-only person on signup instead of duplicating), and **guest reconcile** — all **Plan B**. The full Person FK set Plan B must handle: `Person.guardianPersonId`/wards, `FamilyGroup.createdById`, `FamilyMember`, `HouseholdMember`, `NotificationPreference`, `Relationship.fromPersonId`/`toPersonId`, `Event.createdByPersonId`/`birthdayPersonId`, `EventInvitation.personId`/`linkedPersonId`, `RSVP`, `EventParticipant`, `EventItem.createdByPersonId`/`assignedToPersonId`, `EventPhoto.personId`, `AssistantMessage.personId`.
- Phone **verification delivery** (SMS) → W3b.
- W3a-UI-web surfaces → after the foundation.

## Self-Review

- **Spec coverage:** normalization (T1), schema + verified-only uniqueness (T2), canonical resolver (T3), Clerk verification source (T4), resolver wired into a real call site (T5), one-time backfill (T6). Merge/claim/reconcile explicitly deferred to Plan B per the split. ✓
- **Placeholder scan:** all code steps carry real code; test "arrange" comments name exact values + point at existing helpers; the backfill script is complete. ✓
- **Type consistency:** `normalizeEmail`/`normalizePhone` (T1) consumed by T3/T4/T6; `findOrCreatePersonByContact` signature identical in T3 and its T5 call site; column names (`emailNormalized`/`phoneNormalized`/`emailVerifiedAt`/`phoneVerifiedAt`) identical across T2–T6 and match the partial-index columns. ✓
- **Migration safety:** additive columns + partial unique indexes; prod is collision-free (verified by the 2026-06-25 check); rebuild-db-package constraint stated. ✓
