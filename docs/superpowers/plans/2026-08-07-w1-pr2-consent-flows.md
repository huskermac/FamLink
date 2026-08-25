# W1 PR 2 — Consent Flows (LinkRequest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consent-gated family membership and household linking through a new `LinkRequest` model. The flow is request then accept (both PULL and JOIN directions). The counterparty, or a guardian for a minor, always consents. A passive target consents through a single-use token link. The plan also adds the HOUSEHOLD-scope event-invite escalation.

**Architecture:** A `LinkRequest` row holds the pending consent. The system creates a `FamilyMember` or `HouseholdFamily` row only on acceptance. Row existence means access. The design adds no status filter to the existing authorization queries. Seat billing is decoupled from consent (decision 10): the consent flow makes no Stripe call, and the daily reconciliation cron meters the true active-member count. A data-entry direct-add is allowed only for a passive, contact-less `Person` the requester's family authored (decision 9, proven by `Person.createdByFamilyGroupId`). Every accept, decline, and expiry is race-safe through a conditional status claim inside the grant transaction.

**Tech Stack:** Express 4 with Zod, Prisma 7.7 (interactive `$transaction`, raw `FOR UPDATE`), PostgreSQL (partial unique indexes), Jest with Supertest against a real local Postgres, Twilio and Resend (mocked in tests), TypeScript strict.

> **This is a round-3 plan.** It folds in the two design decisions Steve locked on 2026-08-07 — decision 9 (`Person.createdByFamilyGroupId` provenance) and decision 10 (seat billing decoupled from consent, reconciled from actual membership). Round-3 also clears the ~12 mechanical round-2 council BLOCKERs. Round-2 fixes carry the tag **[R2]**. Round-3 changes carry the tag **[R3]**. The reconciliation slice that decision 10 needs is already built and merged (PR #13, `a689085`): `reconcileSeats`, `runSeatReconciliationPass`, and `billingImpactForAdd` in `subscriptionEnforcement.ts` / `jobs/billingEnforcement.ts`. `checkSeatExpansion` and the 402 seat gate no longer exist.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-14-w1-household-family-m2m-design.md`. The consent-gate scope is **§2 decision 8** (amended 2026-08-07): an active account gets in-app consent. A passive record with a contact detail gets token consent. A passive record with no contact detail is data entry with no gate.
- **Row existence means access.** Never add a `status` filter to `activeFamilyMembership`, `eventVisibility`, `householdAccess`, or any P3-00 / W3a query. Unconsented state lives only in `LinkRequest`.
- **The consent flow makes no Stripe call (decision 10).** The consent and accept path never calls Stripe and never blocks acceptance on billing. Accept creates the `FamilyMember` row and stops. The daily 06:00-UTC `runSeatReconciliationPass` cron meters the new active member into Stripe. An added active member is un-metered for up to about 24 hours until that pass. This window is by design. A request-time cost disclosure to the requesting admin is allowed. It comes from `billingImpactForAdd` (a pure read, no Stripe call). It is informational and non-binding. It never blocks and never charges. **[R3 — supersedes the round-2 request-time seat authorization, `checkSeatExpansion`, the 402 confirm, and `applySeatIncrement`, all now removed.]**
- **Direct-add provenance (decision 9).** A data-entry direct-add through `POST /families/:familyId/members` is allowed only when the target is a passive `Person` with no contact detail **and** `Person.createdByFamilyGroupId` equals the requester's family. A `Person` with no owner or a foreign owner needs a consented `LinkRequest`. **[R3.]**
- **All resolution is race-safe.** Every accept, decline, and expiry is a conditional claim: `updateMany({ where: { id, status: "PENDING" }, ... })` inside the same transaction as the grant. `count === 0` means another caller resolved it, so re-read and return the current state (idempotent). Never `update` a request by id alone. **[R2.]**
- **Authorize before you reveal.** Every accept and decline loads the request, runs the counterparty check, and only then branches on state. An already-resolved request is never serialized to a caller who fails `canConsent`. **[R2.]**
- **Cross-tenant isolation (hard invariant).** The inbox, the consent page, and the escalation `skipped[]` carry names only. They never carry a foreign `personId`, `familyGroupId`, `householdId`, roster, or token. A dedicated `serializeInboxRequest` (names only) is the only serializer on counterparty-facing responses. **[R2.]**
- **Tokens are never logged and never in a logged URL.** A token is a DB-opaque `crypto.randomBytes(32).toString("hex")`, `@unique`, single-use, 30-day. The consent route path is masked in the request logger (Morgan logs full URLs). Delivery and accept logs carry the request id, never the token. **[R2.]**
- **Minors never get token links.** A TEEN or CHILD needs guardian in-app consent. `consentedByPersonId` is the guardian (an `ADULT`, non-suspended). A DOB-unknown passive target needs requester attestation (`attestedAdult`), or the request is refused. **[R2.]**
- **Verification per task:** run the targeted test, then before every commit run `npm run type-check` and `npm run lint` (an eslint-only error broke CI before) AND GitNexus `detect_changes({ scope:"compare", base_ref:"main" })` to confirm the commit touches only the expected symbols (cross-check `git diff --stat` for brand-new files, which `detect_changes` maps unreliably in a worktree). The API suite baseline is **534/534**. Keep it green.
- **Commit format:** `feat: P3-04 <desc>`. Add the co-author trailer per repo convention.
- **Delivery is mockable, not live** (Twilio and Resend pending). Assert through mocks. Do no live-send smoke test in this PR.

---

## File Structure

**Create:** `apps/api/src/lib/linkRequest.ts` (consent core), `apps/api/src/routes/linkRequests.ts` (authed routes), `apps/api/src/routes/consent.ts` (public token routes), `apps/api/src/lib/consentDelivery.ts` (passive delivery), two migration directories, and the test files.

**Modify:** `packages/db/prisma/schema.prisma` (add `LinkRequest`, add `Person.createdByFamilyGroupId`), `apps/api/src/routes/persons.ts` (stamp provenance on create), `apps/api/src/routes/families.ts` (reroute direct-add through the provenance gate, remove the dead `confirmSeatExpansion` field), `apps/api/src/routes/events.ts` (household escalation), `apps/api/src/routes/index.ts` (mount routers), `apps/api/src/lib/personIdentity.ts` (`mergePersons` learns the `LinkRequest` columns), `apps/api/src/middleware/requestLogger.ts` (mask the consent token in logs).

**Boundary:** `lib/linkRequest.ts` owns all consent decisioning and the grant transactions. Routes stay thin. The consent flow imports no Stripe symbol.

---

## Data model (spec §3.2, extended for round-3)

```prisma
model LinkRequest {
  id                  String    @id @default(cuid())
  kind                String    // FAMILY_MEMBERSHIP | HOUSEHOLD_LINK
  direction           String    // PULL | JOIN
  familyGroupId       String    // membership: the family joined; household: the initiating family
  targetPersonId      String?   // FAMILY_MEMBERSHIP (also = requester for membership JOIN)
  targetHouseholdId   String?   // HOUSEHOLD_LINK
  carryHouseholdId    String?
  carryInSkipped      Boolean   @default(false) // [R2] invalid carry-in recorded, not silent
  requestedByPersonId String
  status              String    @default("PENDING") // PENDING|ACCEPTED|DECLINED|EXPIRED|CANCELLED
  consentedByPersonId String?
  consentChannel      String?   // IN_APP | SMS | EMAIL
  token               String?   @unique
  tokenChannel        String?   // [R2] SMS | EMAIL — the ONE channel the token was sent on
  deliveredContact    String?   // [R3] snapshot of the exact email/phone the token was delivered to
  attestedAdult       Boolean   @default(false)
  expiresAt           DateTime
  createdAt           DateTime  @default(now())
  resolvedAt          DateTime?

  @@index([familyGroupId, status])
  @@index([targetPersonId, status])
  @@index([targetHouseholdId, status])
}
```

All `*PersonId` / `*HouseholdId` / `*FamilyGroupId` columns are logical (no FK), the same as `HouseholdAuditEntry`.

The round-2 `seatAuthorizedByRequester` column is removed. Decision 10 ends request-time seat authorization, so no row needs to record it. **[R3.]**

The `deliveredContact` column snapshots the exact contact value the token was targeted at, at delivery time. Accept verifies and stamps that contact, not the person's current contact, because a passive person's contact can change between delivery and accept. **[R3 — round-2 BLOCKER "snapshot delivered contact".]** Its purpose is to fix which channel accept verifies. It is not a claim of successful transport — `sendGuestInvitation` is best-effort and swallows a transport failure (council MAJOR). A full delivery-status model stays deferred (see the self-review). A failed send simply means no one accepts, so no verification stamp happens.

Partial unique indexes (hand-added in the migration, because a Prisma `@@unique` cannot be partial) stop concurrent duplicate PENDING requests at the DB level **[R2 — round-2 BLOCKER "duplicate-pending had no DB constraint"]**:
```sql
CREATE UNIQUE INDEX "LinkRequest_pending_membership_uq"
  ON "LinkRequest" ("familyGroupId", "targetPersonId")
  WHERE "status" = 'PENDING' AND "kind" = 'FAMILY_MEMBERSHIP';
CREATE UNIQUE INDEX "LinkRequest_pending_household_uq"
  ON "LinkRequest" ("familyGroupId", "targetHouseholdId")
  WHERE "status" = 'PENDING' AND "kind" = 'HOUSEHOLD_LINK';
```

---

## Shared types

```typescript
// apps/api/src/lib/linkRequest.ts
export type MembershipTargetClass =
  | { kind: "DATA_ENTRY"; personId: string }
  | { kind: "IN_APP"; personId: string; minor: boolean }
  | { kind: "TOKEN"; personId: string };
export type LinkRequestDirection = "PULL" | "JOIN";
export type ConsentChannel = "IN_APP" | "SMS" | "EMAIL";
export const LINK_REQUEST_TTL_DAYS = 30;
```

---

### Task 1: `LinkRequest` schema + migration (with partial unique indexes)

**Files:** modify `packages/db/prisma/schema.prisma`; create `packages/db/prisma/migrations/<ts>_link_request/migration.sql`; test `apps/api/src/routes/__tests__/linkRequest.migration.test.ts`.

**Interfaces:**
- Produces: the `LinkRequest` model and its client type; the two partial unique indexes.

- [ ] **Step 1: Write the failing test** — round-trip plus duplicate-pending rejection.

```typescript
import { db } from "@famlink/db";
describe("LinkRequest schema", () => {
  it("persists PENDING with the round-3 columns", async () => {
    const r = await db.linkRequest.create({ data: {
      kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: "f1",
      targetPersonId: "p1", requestedByPersonId: "p0",
      expiresAt: new Date(Date.now() + 86_400_000) } });
    expect(r.status).toBe("PENDING");
    expect(r.carryInSkipped).toBe(false);
    expect(r.deliveredContact).toBeNull();
    await db.linkRequest.delete({ where: { id: r.id } });
  });
  it("rejects a second PENDING membership request for the same (family,target)", async () => {
    const base = { kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: "f2",
      targetPersonId: "pX", requestedByPersonId: "p0", expiresAt: new Date(Date.now()+86_400_000) };
    const a = await db.linkRequest.create({ data: base });
    await expect(db.linkRequest.create({ data: base })).rejects.toThrow(); // partial unique index
    await db.linkRequest.delete({ where: { id: a.id } });
  });
});
```

- [ ] **Step 2: Add the model** to `schema.prisma` (the block above).
- [ ] **Step 3: Generate the migration.** Run `npx prisma migrate dev --name link_request --create-only --config=prisma.config.ts` (from `packages/db`). Then hand-append the two partial unique index `CREATE`s to the generated `migration.sql` (Prisma does not emit partials). Make sure that the file has no `DROP` or `ALTER` of an existing table and no backfill.
- [ ] **Step 4: Apply and rebuild.** Run `npx prisma migrate dev --config=prisma.config.ts && npm run build` (regenerate the client and copy it to `dist`; this avoids the PR-1 stale-client problem).
- [ ] **Step 5: Run the test.** Run `npm test --workspace=@famlink/api -- linkRequest.migration`. Expected: PASS (both cases).
- [ ] **Step 6: Commit** `feat: P3-04 LinkRequest model + migration (partial-unique pending guards)`.

---

### Task 2: `Person.createdByFamilyGroupId` provenance — column, backfill, and create-time stamp

**Files:** modify `packages/db/prisma/schema.prisma`; create `packages/db/prisma/migrations/<ts>_person_provenance/migration.sql`; modify `apps/api/src/routes/persons.ts`; test `apps/api/src/routes/__tests__/persons.provenance.test.ts`.

**Interfaces:**
- Produces: the `Person.createdByFamilyGroupId String?` column; an optional `familyGroupId` field on `CreatePersonSchema`; the stamp behavior on `POST /persons`.
- Consumes (later): Task 9 reads `createdByFamilyGroupId` for the direct-add gate.

> **Design note (why `POST /persons` gains `familyGroupId`).** `POST /persons` today creates a `Person` with no family context. Decision 9 needs the record to remember the family that authored it. So this task adds an optional `familyGroupId` to the create body. When the caller passes it, the requester must be an active member of that family, and the system stamps `createdByFamilyGroupId` for a passive new person. The onboarding self-person is an account (`userId` set) and never carries this field. The web caller starts to pass `familyGroupId` in PR-3; until then a passive person created without it has a null owner and can be attached only through a consented `LinkRequest`.

- [ ] **Step 1: Write the failing test** — a stamp on a passive create, a 403 for a non-member family, and no stamp for an account create.

```typescript
it("POST /persons with familyGroupId stamps createdByFamilyGroupId on a passive person", async () => {
  const res = await asPerson(memberId).post("/api/v1/persons").send({
    firstName: "Kid", lastName: "Doe", familyGroupId });
  expect(res.status).toBe(201);
  const row = await db.person.findUnique({ where: { id: res.body.id } });
  expect(row!.createdByFamilyGroupId).toBe(familyGroupId);
  expect(row!.userId).toBeNull();
});
it("POST /persons rejects familyGroupId when the requester is not a member", async () => {
  const res = await asPerson(outsiderId).post("/api/v1/persons").send({
    firstName: "X", lastName: "Y", familyGroupId: foreignFamilyId });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run the test.** Expected: FAIL (unknown column and unknown field).
- [ ] **Step 3: Add the column and the backfill migration.** Add `createdByFamilyGroupId String?` to the `Person` model in `schema.prisma`. Generate the migration with `--create-only`, then hand-add the backfill (prod has about 12 persons, so a single pass is safe):

```sql
UPDATE "Person" p
SET "createdByFamilyGroupId" = (
  SELECT fm."familyGroupId" FROM "FamilyMember" fm WHERE fm."personId" = p."id"
)
WHERE p."userId" IS NULL
  AND p."createdByFamilyGroupId" IS NULL
  AND (SELECT COUNT(*) FROM "FamilyMember" fm WHERE fm."personId" = p."id") = 1;
```

A passive person who is a member of exactly one family gets that family as the owner. A passive person who is a member of more than one family stays null on purpose — an arbitrary pick does not prove authorship (council MAJOR). A null-owner passive person can be attached only through a consented `LinkRequest`, which is the safe default. Prod is tiny (about 12 persons, most in one family), so this backfills the common case and leaves the ambiguous case for consent.

- [ ] **Step 4: Apply and rebuild.** Run `npx prisma migrate dev --config=prisma.config.ts && npm run build`.
- [ ] **Step 5: Stamp on create.** In `persons.ts`, add `familyGroupId: z.string().min(1).optional()` to `CreatePersonSchema`. In the `POST /` handler, after the requester lookup, add:

```typescript
let createdByFamilyGroupId: string | null = null;
if (data.familyGroupId) {
  if (!requesterPerson) {
    res.status(400).json({ error: "Person record not found — complete onboarding" });
    return;
  }
  const membership = await activeFamilyMembership(data.familyGroupId, requesterPerson.id);
  if (!membership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }
  if (!linkToClerk) createdByFamilyGroupId = data.familyGroupId; // passive record only
}
```

Add `createdByFamilyGroupId` to the `db.person.create` data. Import `activeFamilyMembership` from `../lib/familyAccess`.

- [ ] **Step 6: Run the test.** Run `npm test --workspace=@famlink/api -- persons.provenance`. Expected: PASS.
- [ ] **Step 7: Commit** `feat: P3-04 Person.createdByFamilyGroupId provenance column + backfill + create-time stamp`.

---

### Task 3: Consent-gate classification + token helpers

**Files:** create `apps/api/src/lib/linkRequest.ts`; test `apps/api/src/lib/__tests__/linkRequest.classify.test.ts`.

**Interfaces:**
- Produces: `classifyMembershipTarget`, `generateConsentToken`, `isMinorLevel`, `isAdultLevel`, `hasAnyContact`, and the shared types above.

- [ ] **Step 1: Write the failing tests** — the four branches plus the minor/adult helpers, and the normalized-contact case.

```typescript
it("passive with only NORMALIZED contact (CIF-created) still classifies TOKEN", async () => {
  const p = await db.person.create({ data: { firstName:"N", lastName:"C", ageGateLevel:"ADULT",
    userId:null, email:null, phone:null, phoneNormalized:"+14155552671" } });
  expect((await classifyMembershipTarget({ personId: p.id })).kind).toBe("TOKEN");
});
```
**[R2 — BLOCKER #8:** classification and delivery must both look at the normalized contact fields, because CIF stores only those on a new person.**]**

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** the classifier (a contact-presence check looks at both raw and normalized):

```typescript
import crypto from "crypto";
import { db } from "@famlink/db";
import { findOrCreatePersonByContact } from "./personIdentity";

export const LINK_REQUEST_TTL_DAYS = 30;
export function isMinorLevel(l: string): boolean { return l === "TEEN" || l === "CHILD"; }
export function isAdultLevel(l: string): boolean { return l === "ADULT"; }
export function generateConsentToken(): string { return crypto.randomBytes(32).toString("hex"); }

export function hasAnyContact(p: { email: string|null; phone: string|null; emailNormalized: string|null; phoneNormalized: string|null }): boolean {
  return Boolean(p.email || p.phone || p.emailNormalized || p.phoneNormalized);
}

export async function classifyMembershipTarget(input: { personId?: string; email?: string; phone?: string }): Promise<MembershipTargetClass> {
  const person = input.personId
    ? await db.person.findUnique({ where: { id: input.personId } })
    : await findOrCreatePersonByContact({ email: input.email, phone: input.phone });
  if (!person) throw new Error("target person not found");
  if (person.userId) return { kind: "IN_APP", personId: person.id, minor: isMinorLevel(person.ageGateLevel) };
  return hasAnyContact(person) ? { kind: "TOKEN", personId: person.id } : { kind: "DATA_ENTRY", personId: person.id };
}
```

- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: P3-04 consent-gate classification + token helpers`.

---

### Task 4: Create link-request route — membership PULL + JOIN, kind-specific schema, billing disclosure

**Files:** create `apps/api/src/routes/linkRequests.ts`; modify `index.ts`, `lib/linkRequest.ts`; test `linkRequests.create.test.ts`.

**Interfaces:**
- Consumes: `classifyMembershipTarget`, `isMinorLevel` (Task 3); `billingImpactForAdd` (from `../lib/subscriptionEnforcement`).
- Produces: `POST /api/v1/link-requests` (family id in the body); `createMembershipRequest`; `serializeOwnerRequest` (requester-facing, own ids); `sweepExpiredMembershipPending`. `serializeInboxRequest` is defined in Task 5.

> **Route shape:** one router at `/api/v1/link-requests` (family id in the body) so the family-agnostic inbox, accept, and decline live with create. This is a documented deviation from the spec's `/families/:id/link-requests`.

- [ ] **Step 1: Write the failing tests** — membership PULL (active target created PENDING, token target created PENDING, data-entry target rejected 409, non-admin 403, duplicate 409, already-a-member target 409 `ALREADY_MEMBER`, a foreign `carryHouseholdId` not linked to this family 400 `CARRY_HOUSEHOLD_INVALID`), membership JOIN (requester equals target, created PENDING), the kind-specific schema (a mixed or empty target is 400), the attestation gate (a DOB-unknown passive target without attestation is 400), and the billing disclosure present on an active-account PULL create and absent on a TOKEN PULL create.

```typescript
it("membership JOIN: a person asks to join a family → 201 PENDING, requester is the target", async () => {
  const res = await asPerson(applicantId).post("/api/v1/link-requests").send({
    kind:"FAMILY_MEMBERSHIP", direction:"JOIN", familyGroupId: targetFamilyId });
  expect(res.status).toBe(201);
  const row = await db.linkRequest.findFirst({ where:{ familyGroupId: targetFamilyId, requestedByPersonId: applicantId }});
  expect(row!.targetPersonId).toBe(applicantId);
});
it("DOB-unknown passive target without attestation → 400 ATTESTATION_REQUIRED", async () => {
  const res = await asAdmin(adminId).post("/api/v1/link-requests").send({
    kind:"FAMILY_MEMBERSHIP", direction:"PULL", familyGroupId, targetEmail:"dobunknown@x.com" });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe("ATTESTATION_REQUIRED");
});
it("PULL create returns a non-binding billing disclosure and creates the request regardless", async () => {
  const res = await asAdmin(adminId).post("/api/v1/link-requests").send({
    kind:"FAMILY_MEMBERSHIP", direction:"PULL", familyGroupId, targetPersonId: activeTargetId });
  expect(res.status).toBe(201);
  expect(res.body.billingImpact).toHaveProperty("willBill");
});
```

- [ ] **Step 2: Run the tests.** Expected: FAIL (404).
- [ ] **Step 3: Implement `createMembershipRequest`** — classify, split PULL vs JOIN authorization, run the attestation gate, sweep an expired duplicate before insert, and let the DB partial index catch a live duplicate (P2002). This function calls no Stripe symbol.

```typescript
// lib/linkRequest.ts
import type { LinkRequest } from "@famlink/db";
import { activeFamilyMembership } from "./familyAccess";

export class DataEntryNoConsent extends Error {}
export class RequestAlreadyPending extends Error {}
export class AttestationRequired extends Error {}
export class AlreadyMember extends Error {}
export class CarryHouseholdInvalid extends Error {}

/** [R3] Sweep an expired-but-still-PENDING duplicate so it cannot block the partial-unique index. */
export async function sweepExpiredMembershipPending(familyGroupId: string, targetPersonId: string): Promise<void> {
  await db.linkRequest.updateMany({
    where: { kind: "FAMILY_MEMBERSHIP", familyGroupId, targetPersonId, status: "PENDING", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED", resolvedAt: new Date() } });
}

export async function createMembershipRequest(params: {
  familyGroupId: string; direction: LinkRequestDirection; requester: { id: string };
  target?: { personId?: string; email?: string; phone?: string };
  carryHouseholdId?: string; attestedAdult?: boolean;
}): Promise<{ request: LinkRequest; cls: MembershipTargetClass }> {
  // JOIN: the requester IS the target (a person asks to join `familyGroupId`).
  const target = params.direction === "JOIN" ? { personId: params.requester.id } : (params.target ?? {});
  const cls = await classifyMembershipTarget(target);
  if (cls.kind === "DATA_ENTRY") throw new DataEntryNoConsent();

  // [council MAJOR] a consent request for an already-granted membership is meaningless — reject it.
  const existingMember = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId: params.familyGroupId, personId: cls.personId } } });
  if (existingMember) throw new AlreadyMember();

  // [council BLOCKER] validate carryHouseholdId at CREATE time. The inbox resolves and shows the
  // household name, so an unvalidated foreign id leaks that name to the counterparty. It must be a
  // household currently linked to the requesting family.
  if (params.carryHouseholdId) {
    const linked = await db.householdFamily.findUnique({ where: { householdId_familyGroupId: {
      householdId: params.carryHouseholdId, familyGroupId: params.familyGroupId } } });
    if (!linked) throw new CarryHouseholdInvalid();
  }

  const targetPerson = await db.person.findUnique({ where: { id: cls.personId } });
  const minor = targetPerson ? isMinorLevel(targetPerson.ageGateLevel) : false;

  // Attestation-before-minor ordering [R2/R3]: a known minor never uses a token and never
  // uses attestation (guardian consents in-app). Attestation applies ONLY to a DOB-unknown
  // passive TOKEN target treated as an adult (spec §11).
  if (cls.kind === "TOKEN" && !minor && !targetPerson?.dateOfBirth && !params.attestedAdult) {
    throw new AttestationRequired();
  }

  const useToken = cls.kind === "TOKEN" && !minor; // minors: guardian in-app, never a token
  await sweepExpiredMembershipPending(params.familyGroupId, cls.personId);
  try {
    const request = await db.linkRequest.create({ data: {
      kind: "FAMILY_MEMBERSHIP", direction: params.direction, familyGroupId: params.familyGroupId,
      targetPersonId: cls.personId, carryHouseholdId: params.carryHouseholdId ?? null,
      requestedByPersonId: params.requester.id, status: "PENDING",
      consentChannel: (minor || cls.kind === "IN_APP") ? "IN_APP" : null,
      token: useToken ? generateConsentToken() : null,
      attestedAdult: params.attestedAdult ?? false,
      expiresAt: new Date(Date.now() + LINK_REQUEST_TTL_DAYS * 86_400_000) } });
    return { request, cls };
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && (e as {code:string}).code === "P2002") throw new RequestAlreadyPending();
    throw e;
  }
}

export function serializeOwnerRequest(r: LinkRequest) { /* requester-facing: own ids OK */
  return { id:r.id, kind:r.kind, direction:r.direction, familyGroupId:r.familyGroupId,
    targetPersonId:r.targetPersonId, targetHouseholdId:r.targetHouseholdId, status:r.status,
    consentChannel:r.consentChannel,
    expiresAt:r.expiresAt.toISOString(), createdAt:r.createdAt.toISOString(), resolvedAt:r.resolvedAt?.toISOString() ?? null };
}
// serializeInboxRequest (names only) is defined in Task 5.
```

- [ ] **Step 4: Implement the route** with a kind-specific Zod schema (`superRefine`: FAMILY_MEMBERSHIP + PULL needs exactly one of `targetPersonId` or a contact and forbids the household fields; FAMILY_MEMBERSHIP + JOIN forbids any target; HOUSEHOLD_LINK needs `targetHouseholdId` and forbids the person and contact fields) **[R2 — MAJOR: the schema did not enforce shapes]**. Map `DataEntryNoConsent` → 409 `DATA_ENTRY_NO_CONSENT`, `RequestAlreadyPending` → 409, `AlreadyMember` → 409 `ALREADY_MEMBER`, `CarryHouseholdInvalid` → 400 `CARRY_HOUSEHOLD_INVALID`, `AttestationRequired` → 400. Requester authorization: PULL needs an `INVITE_MEMBERS` admin of `familyGroupId`; JOIN needs only an authenticated person (the applicant). Billing disclosure: read `billingImpactForAdd(familyGroupId)` and add it to the response as `billingImpact` **only when `cls.kind === "IN_APP"` on a PULL create** — a passive TOKEN target stays `userId: null` and does not raise the active-seat count until it claims an account, so a `willBill` on it is wrong (council MINOR). For a JOIN create, omit `billingImpact` (the applicant must not see the family's billing). Dispatch a `HOUSEHOLD_LINK` body to Task 8 (a temporary 501). Return `serializeOwnerRequest` plus the optional `billingImpact`.
- [ ] **Step 5: Wire token delivery and mount.** **[council BLOCKER: delivery was never called from create.]** After a successful create whose class is `TOKEN`, call `deliverConsentLink({ request, personId: cls.personId })` (best-effort; a delivery error must not fail the 201, so wrap it and log the request id). Create a `consentDelivery.ts` stub first (the real one lands in Task 6, so this step imports the stub and Task 6 fills it in). Mount `linkRequestsRouter` behind `requireAuth, requirePerson` in `index.ts`. **NOTE:** the delivered link points at the PR-3 web page `WEB_APP_URL/consent/:token`, which does not exist until PR 3. This PR keeps delivery mocked (not live), so the dangling destination is acceptable here. The API accept route (`POST /api/v1/consent/:token/accept`, Task 6) is what PR 3's page calls.
- [ ] **Step 6: Run the tests.** Expected: PASS.
- [ ] **Step 7: Commit** `feat: P3-04 create membership link-request (PULL+JOIN, kind-specific schema, billing disclosure)`.

---

### Task 5: Pending inbox (DB-scoped, names-only) + accept/decline (conditional-claim grant, no Stripe)

**Files:** modify `lib/linkRequest.ts`, `routes/linkRequests.ts`; test `linkRequests.accept.test.ts`.

**Interfaces:**
- Consumes: `hasAdminRole`, `activeFamilyMembership` (from `../lib/familyAccess`); `resolveExpiry`, `createMembershipRequest` types (Task 4).
- Produces: `GET /pending`, `POST /:id/accept`, `POST /:id/decline`; `canConsentMembership`, `recheckMembershipConsentTx` (tx-scoped authority mirror), `grantMembershipInTx` (exported grant core, reused by Task 6), `claimAndAcceptMembership` (self-accept wrapper), `serializeInboxRequest`, `resolveExpiry`.

> **Billing note (decision 10):** the accept path creates the `FamilyMember` row and makes no Stripe call. The daily `runSeatReconciliationPass` meters the new active member. Do not call `reconcileSeats` or any Stripe method here. The upsert makes a repeat accept a no-op, so no membership double-count and no re-bill can happen.

> **Authority note (council MAJOR):** for a JOIN accept and a minor-guardian accept, the consenting authority is role-derived and can change between `canConsent*` and the claim. Mirror the household path: for these two branches, re-check the consenting authority inside the grant transaction (a `tx`-scoped admin/guardian lookup) before the conditional claim, and abort the tx if it no longer holds. A self-accept (target equals the consenter) needs no re-check — its authority is identity and cannot change.

- [ ] **Step 1: Write the failing tests** — a grant with the default `["MEMBER"]` role; an initiating admin cannot self-accept a PULL (403), but a JOIN admin is the counterparty and can; a guardian accept (ADULT, non-suspended) sets `consentedByPersonId`; two simultaneous accepts create exactly one membership (fire two, assert count 1); an accept-versus-decline race ends in one terminal state (a grant exists only if the status ended ACCEPTED); an expired PENDING → 409 and a persisted EXPIRED without clobbering a concurrent accept; an already-resolved request returns the current state to an authorized counterparty and 403 to any other caller; a foreign caller who posts accept to an EXPIRED-but-unswept request gets 403 and the row stays PENDING (authorize before mutate); a family-less minor's guardian (the `guardianPersonId`) sees the request in `GET /pending`; the inbox returns names only (no ids, no token) and is DB-scoped (a foreign tenant's unrelated PENDING request never appears and is never mutated on read); a repeat accept of an already-member target keeps the membership count at 1.

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement the expiry-safe claim, the counterparty authorization, and the grant tx** in `lib/linkRequest.ts`:

```typescript
import { hasAdminRole } from "./familyAccess";

/** Conditional expiry: never clobbers a concurrently-resolved row. Returns the fresh row. */
export async function resolveExpiry(r: LinkRequest): Promise<LinkRequest> {
  if (r.status !== "PENDING" || r.expiresAt.getTime() >= Date.now()) return r;
  await db.linkRequest.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "EXPIRED", resolvedAt: new Date() } });
  return (await db.linkRequest.findUnique({ where: { id: r.id } }))!;
}

/** §6.3 membership matrix. PULL: active adult → self; minor → ADULT non-suspended admin of a family the
 *  minor belongs to, or (family-less minor) the ADULT `guardianPersonId`. JOIN: any admin of the target
 *  family. A requester may consent only when they ALSO hold the counterparty authority (dual-authority). */
export async function canConsentMembership(r: LinkRequest, person: { id: string }): Promise<boolean> {
  if (r.kind !== "FAMILY_MEMBERSHIP" || !r.targetPersonId) return false;
  if (r.direction === "JOIN") {
    const m = await activeFamilyMembership(r.familyGroupId, person.id);
    return Boolean(m && hasAdminRole(m)); // accepting-family admin; the applicant is not an admin here
  }
  const target = await db.person.findUnique({ where: { id: r.targetPersonId } });
  if (!target) return false;
  if (isAdultLevel(target.ageGateLevel)) {
    if (person.id === r.requestedByPersonId && person.id !== target.id) return false; // pure requester cannot self-accept
    return person.id === target.id;
  }
  // minor → ADULT, non-suspended admin of a family the minor belongs to
  const actor = await db.person.findUnique({ where: { id: person.id } });
  if (!actor || !isAdultLevel(actor.ageGateLevel)) return false;
  const adminMemberships = await db.familyMember.findMany({
    where: { personId: person.id, suspendedAt: null, familyGroup: { members: { some: { personId: target.id } } } } });
  if (adminMemberships.some(hasAdminRole)) return true;
  const minorFamilies = await db.familyMember.count({ where: { personId: target.id } });
  return minorFamilies === 0 && target.guardianPersonId === person.id;
}

import type { Prisma } from "@famlink/db";

/** The grant core, on a caller-supplied tx. The conditional claim re-checks status AND expiry
 *  [council BLOCKER: expiry was not enforced by the claim], so an expired-but-unswept row is never
 *  granted. Returns true if THIS call did the grant. No Stripe call. Exported so the token-accept
 *  path (Task 6) can run the grant and the contact-verification stamp in ONE transaction. */
export async function grantMembershipInTx(
  tx: Prisma.TransactionClient, r: LinkRequest, consentedByPersonId: string, channel: ConsentChannel
): Promise<boolean> {
  const claim = await tx.linkRequest.updateMany({ where: { id: r.id, status: "PENDING", expiresAt: { gt: new Date() } },
    data: { status: "ACCEPTED", consentedByPersonId, consentChannel: channel, resolvedAt: new Date() } });
  if (claim.count === 0) return false; // another caller resolved it, or it expired — no double grant
  await tx.familyMember.upsert({
    where: { familyGroupId_personId: { familyGroupId: r.familyGroupId, personId: r.targetPersonId! } },
    create: { familyGroupId: r.familyGroupId, personId: r.targetPersonId!, roles: ["MEMBER"], permissions: [] },
    update: {} });
  if (r.carryHouseholdId) {
    const valid = await tx.householdFamily.findUnique({
      where: { householdId_familyGroupId: { householdId: r.carryHouseholdId, familyGroupId: r.familyGroupId } } });
    if (valid) {
      await tx.householdMember.upsert({
        where: { householdId_personId: { householdId: r.carryHouseholdId, personId: r.targetPersonId! } },
        create: { householdId: r.carryHouseholdId, personId: r.targetPersonId! }, update: {} });
    } else {
      await tx.linkRequest.update({ where: { id: r.id }, data: { carryInSkipped: true } }); // [R2] record, not silent
    }
  }
  return true;
}

/** In-app accept wrapper. Idempotent. No Stripe call. */
export async function claimAndAcceptMembership(r: LinkRequest, consentedByPersonId: string, channel: ConsentChannel): Promise<boolean> {
  return db.$transaction((tx) => grantMembershipInTx(tx, r, consentedByPersonId, channel));
}
```

- [ ] **Step 4: Implement the routes.** Order `GET /pending` before `/:id`.

  For `accept`: load the raw row → run `canConsent*` on the RAW row FIRST (403 if it fails) → only then `resolveExpiry` → if the status is now terminal, return the current state (idempotent) → else grant. **[council BLOCKER: `resolveExpiry` MUTATES the row, so it must run AFTER the counterparty check — otherwise a foreign caller who guesses an expired id flips it to EXPIRED.]** The grant path splits on the counterparty:
  - **Self-accept** (target equals the consenter) — authority is identity and cannot change, so call `claimAndAcceptMembership(r, consenter.id, "IN_APP")`.
  - **JOIN or minor-guardian accept** — the authority is role-derived and can change, so open the tx here and re-check it INSIDE the tx before the grant **[council MAJOR: the recheck must be code, not prose]**:

```typescript
const granted = await db.$transaction(async (tx) => {
  // Re-check the role-derived authority under the tx (JOIN: admin of r.familyGroupId; guardian: ADULT admin
  // of the minor's family, or the family-less minor's guardianPersonId). Return null on loss of authority.
  const stillAuthorized = await recheckMembershipConsentTx(tx, r, consenter.id);
  if (!stillAuthorized) return "UNAUTHORIZED" as const;
  const ok = await grantMembershipInTx(tx, r, consenter.id, "IN_APP");
  return ok ? "GRANTED" as const : "RESOLVED" as const;
});
```
Map `UNAUTHORIZED` → 403 (never serialize state), `RESOLVED` → re-read and return the current state, `GRANTED` → 200. When `claimAndAcceptMembership` (the self path) returns `false`, re-read and return the current state (a rare expiry-in-the-gap → no grant, safe). Make no Stripe call. Add `recheckMembershipConsentTx(tx, r, personId)` to `lib/linkRequest.ts` — the tx-scoped mirror of the JOIN/guardian branches of `canConsentMembership`.

  For `decline`: authorize first on the raw row → `resolveExpiry` → if terminal return the current state → else a conditional claim to DECLINED (`where { id, status:"PENDING" }`). Running `resolveExpiry` first means an expired request resolves to EXPIRED, so decline cannot flip an expired row to DECLINED **[council BLOCKER: decline claim ignored expiry]**.

  For `GET /pending`: a DB-scoped query — `status:"PENDING", expiresAt:{gt:now}` and `OR: [ { targetPersonId: requester.id }, { AND:[{ direction:"JOIN" }, { familyGroupId: { in: <families the requester admins> } }] }, { AND:[{ kind:"FAMILY_MEMBERSHIP" }, { targetPerson: { is: { familyMemberships: { some: { familyGroup: { members: { some: { personId: requester.id, roles: { has: "ADMIN" }, suspendedAt: null } } } } } } } }] }, { AND:[{ kind:"FAMILY_MEMBERSHIP" }, { targetPerson: { is: { guardianPersonId: requester.id, familyMemberships: { none: {} } } } }] } ]` — the third branch is the minor-in-a-family case (the requester admins the minor's family), the fourth is the family-less-minor case (the requester is the `guardianPersonId`). **[council BLOCKER: the family-less-guardian branch was missing, so a family-less minor's guardian saw no inbox item.]** Then filter the small result set with `canConsent*` and serialize with `serializeInboxRequest` (names only). Never `resolveExpiry`-mutate a row during an inbox read (filter expired rows out in SQL). **[R2 — MAJOR/BLOCKER: a global scan plus a foreign-row mutation plus an id leak.]** **NOTE:** this needs a `targetPerson` relation from `LinkRequest` to `Person`. `targetPersonId` is a logical column (no FK), so add a Prisma relation with `@relation(fields:[targetPersonId], references:[id])` marked optional, or resolve the two guardian branches with a pre-query of the requester's ward/family person ids and an `IN` list. Pick the pre-query form if the relation complicates the no-FK convention.

```typescript
export async function serializeInboxRequest(r: LinkRequest): Promise<{ id:string; kind:string; direction:string; requestingFamilyName:string; targetName:string|null; carryHouseholdName:string|null; notice:string }> {
  const fam = await db.familyGroup.findUnique({ where: { id: r.familyGroupId }, select: { name: true } });
  const target = r.targetPersonId ? await db.person.findUnique({ where: { id: r.targetPersonId }, select: { firstName: true, preferredName: true } }) : null;
  const carry = r.carryHouseholdId ? await db.household.findUnique({ where: { id: r.carryHouseholdId }, select: { name: true } }) : null;
  return { id: r.id, kind: r.kind, direction: r.direction,
    requestingFamilyName: fam?.name ?? "A family",
    targetName: target ? (target.preferredName ?? target.firstName) : null, // [R3] names-only "who" for the counterparty
    carryHouseholdName: carry?.name ?? null, // [R2] carry-in disclosed to the target
    notice: "Accepting adds you to this family. Linked families' admins can edit shared household details." };
}
```

- [ ] **Step 5: Run the tests.** Expected: PASS (including the concurrency tests).
- [ ] **Step 6: Commit** `feat: P3-04 inbox (names-only, scoped) + accept/decline (conditional-claim grant, no Stripe)`.

---

### Task 6: Passive token delivery (normalized contacts, single channel with fallback) + public consent page

**Files:** create the real `lib/consentDelivery.ts`; create `routes/consent.ts`; modify `index.ts`, `middleware/requestLogger.ts`; tests `consentDelivery.test.ts`, `consent.page.test.ts`.

**Interfaces:**
- Consumes: `claimAndAcceptMembership`, `resolveExpiry` (Task 5); `NotificationService`, `buildBudgetedSmsBody`, `GUEST_SMS_FOOTER`, `MAX_GUEST_INVITE_SMS` (from `./notificationService`).
- Produces: `deliverConsentLink`, `buildConsentMessage`; `POST /api/v1/consent/:token/accept`, `GET /api/v1/consent/:token`.

- [ ] **Step 1: Write the failing tests** — delivery names the family only (no roster); the SMS is budgeted with the footer and ≤320 chars; delivery uses the normalized contact when the raw contact is null (the CIF case); delivery uses ONE channel and records `tokenChannel` and `deliveredContact` (both contacts present → sent on one, not both); a suppressed SMS number falls back to email; the consent page view shows names only, returns 410 on expiry, and never echoes the token; accept verifies only the delivered contact (a phone delivery sets `phoneVerifiedAt` and leaves `emailVerifiedAt` untouched); a second accept is 409 (single-use); the token never appears in the Morgan output (assert the masked log line).

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `consentDelivery.ts`** — read the normalized fields, pick one channel deterministically (prefer SMS when a phone exists and is not suppressed, else email), record `tokenChannel` and the exact `deliveredContact`, honor `SmsConsent` suppression with an email fallback, and log the request id (never the token):

```typescript
import type { LinkRequest } from "@famlink/db";
import { db } from "@famlink/db";
import { env } from "./env";
import { isPhoneSuppressed } from "./smsConsent";
import { NotificationService, buildBudgetedSmsBody, GUEST_SMS_FOOTER, MAX_GUEST_INVITE_SMS } from "./notificationService";

export function buildConsentMessage(o: { familyName: string; consentUrl: string }) {
  const prefix = "You've been invited to join ";
  const suffix = ` on FamLink. Review & respond: ${o.consentUrl}\n${GUEST_SMS_FOOTER}`;
  return { subject: `Join ${o.familyName} on FamLink`,
    body: `You've been invited to join ${o.familyName} on FamLink. Review & respond: ${o.consentUrl}. Linked families' admins can edit shared household details.`,
    smsBody: buildBudgetedSmsBody({ prefix, title: o.familyName, suffix, max: MAX_GUEST_INVITE_SMS }) };
}

export async function deliverConsentLink(args: { request: LinkRequest; personId: string }): Promise<void> {
  if (!args.request.token) return;
  const [person, family] = await Promise.all([
    db.person.findUnique({ where: { id: args.personId } }),
    db.familyGroup.findUnique({ where: { id: args.request.familyGroupId }, select: { name: true } }) ]);
  if (!person || !family) return;
  const phone = person.phone ?? person.phoneNormalized;
  const email = person.email ?? person.emailNormalized;
  // Single channel with fallback [R3]: prefer a non-suppressed phone, else email.
  const phoneOk = phone ? !(await isPhoneSuppressed(phone)) : false;
  const channel: "SMS" | "EMAIL" | null = phoneOk ? "SMS" : email ? "EMAIL" : null;
  if (!channel) return;
  const deliveredContact = channel === "SMS" ? phone! : email!;
  await db.linkRequest.update({ where: { id: args.request.id }, data: { tokenChannel: channel, deliveredContact } });
  const consentUrl = `${env.WEB_APP_URL.replace(/\/$/,"")}/consent/${args.request.token}`;
  const m = buildConsentMessage({ familyName: family.name, consentUrl });
  const notifier = new NotificationService();
  await notifier.sendGuestInvitation({ invitationId: args.request.id, // log carries the request id, NOT the token
    email: channel === "EMAIL" ? email : null, phone: channel === "SMS" ? phone : null,
    message: { subject: m.subject, body: m.body, smsBody: m.smsBody } });
}
```

> **NOTE:** confirm the exact `isPhoneSuppressed` import path and the `NotificationService.sendGuestInvitation` signature against the W3b code before you implement. If a helper name differs, use the real one — do not invent a name.

- [ ] **Step 4: Implement `routes/consent.ts`** (public, rate-limited). The GET view runs `resolveExpiry` (410 on EXPIRED) and shows names only. The POST accept authorizes by possession of the token (look the request up by `token`, 404 if none). It runs the grant AND the contact verification in ONE `db.$transaction` through the exported `grantMembershipInTx`, so a verification failure rolls the grant back too **[council BLOCKER: `claimAndAcceptMembership` opens its own tx, so the old "reuse it, then stamp inside the same tx" was not atomic]**:

```typescript
import { grantMembershipInTx } from "../lib/linkRequest";
// r = the LinkRequest found by token; the token holder is r.targetPersonId
const granted = await db.$transaction(async (tx) => {
  const ok = await grantMembershipInTx(tx, r, r.targetPersonId!, r.tokenChannel === "SMS" ? "SMS" : "EMAIL");
  if (!ok) return false; // already resolved or expired — the claim inside enforces status + expiry
  // Verify ONLY the exact contact the token was delivered to (r.deliveredContact), NOT whatever the
  // person's current contact is. If they changed that contact after delivery, possession of this token
  // no longer proves control of the current one, so grant membership but skip the verification stamp.
  // [council BLOCKER: deliveredContact must drive the stamp, not tokenChannel alone.]
  const person = await tx.person.findUnique({ where: { id: r.targetPersonId! } });
  if (r.tokenChannel === "SMS" && (person?.phone === r.deliveredContact || person?.phoneNormalized === r.deliveredContact)) {
    await tx.person.update({ where: { id: r.targetPersonId! }, data: { phoneVerifiedAt: new Date() } });
  } else if (r.tokenChannel === "EMAIL" && (person?.email === r.deliveredContact || person?.emailNormalized === r.deliveredContact)) {
    await tx.person.update({ where: { id: r.targetPersonId! }, data: { emailVerifiedAt: new Date() } });
  }
  return true;
});
```

The single-use property falls out of the conditional claim inside `grantMembershipInTx` (a second call → count 0 → 409 with the current state). The stamp targets only the channel the token went on and only when the person's current contact still equals `deliveredContact`. A test must cover the contact-changed case (grant succeeds, no stamp).
- [ ] **Step 5: Mask the token in the request logger** — in `requestLogger.ts`, mask the consent token both in the request path AND in the `Referer` header, because a POST from the `/consent/<token>` web page carries the token in `Referer` **[R2 — BLOCKER #7; council BLOCKER: the referrer was still logged raw]**. Concrete approach:

```typescript
import morgan from "morgan";
import { env } from "../lib/env";

const redactConsentToken = (s: string): string => s.replace(/(\/consent\/)[^/?#]+/g, "$1[redacted]");

morgan.token("safeurl", (req) => {
  const url = (req as { originalUrl?: string; url?: string }).originalUrl ?? (req as { url?: string }).url ?? "";
  return redactConsentToken(url);
});
morgan.token("saferef", (req) => redactConsentToken((req.headers?.referer ?? req.headers?.referrer ?? "-") as string));

const devFormat = ":method :safeurl :status :response-time ms - :res[content-length]";
const prodFormat = ':remote-addr - :remote-user [:date[clf]] ":method :safeurl HTTP/:http-version" :status :res[content-length] ":saferef" ":user-agent"';
export const requestLogger = morgan(env.NODE_ENV === "development" ? devFormat : prodFormat);
```

- [ ] **Step 6: Mount** `consentRouter` at `/api/v1/consent` (public) in `index.ts`.
- [ ] **Step 7: Run the tests.** Expected: PASS.
- [ ] **Step 8: Commit** `feat: P3-04 passive token delivery (normalized, single-channel with fallback) + consent page (token redacted in logs)`.

---

### Task 7: Guardian + attestation enforcement (regression lock)

**Files:** test-focused: `lib/__tests__/linkRequest.guardian.test.ts` (and tighten `createMembershipRequest` or `canConsentMembership` if a test finds a gap).

- [ ] **Step 1: Write the locking tests** — a minor WITH a contact gets no token (guardian in-app); a non-ADULT or suspended person who tries to consent → `canConsentMembership` returns false; a family-less minor is consented only by the ADULT `guardianPersonId`; a DOB-unknown passive without attestation is refused (also asserted in Task 4, repeated here for the matrix); a known minor with `attestedAdult:true` still gets no token (attestation cannot promote a minor).
- [ ] **Step 2: Run the tests.** The minor-no-token and adult/suspended-guardian tests drive any remaining tightening in the Task 5 `canConsentMembership` (it already checks `isAdultLevel(actor)` and `suspendedAt: null` — confirm and add the tests).
- [ ] **Step 3: Run the tests.** Expected: PASS.
- [ ] **Step 4: Commit** `test: P3-04 guardian ADULT/non-suspended + minor-no-token + attestation matrix`.

---

### Task 8: Household link requests — PULL + JOIN, visibility precondition, lock-revalidated authz

**Files:** modify `lib/linkRequest.ts`, `routes/linkRequests.ts`; test `linkRequests.household.test.ts`.

**Interfaces:**
- Consumes: `writeHouseholdAudit` (from `./householdAccess`); `hasAdminRole` (from `./familyAccess`); the conditional-claim pattern (Task 5).
- Produces: `createHouseholdLinkRequest`, `canConsentHousehold`, `claimAndAcceptHousehold`, `householdConsentFamily`, `HouseholdNotVisible`.

- [ ] **Step 1: Write the failing tests** — a requester who is not an admin of the initiating family → 403 at create (both PULL and JOIN); a PULL accept creates the `HouseholdFamily` link and a `LINKED` audit entry whose `actorFamilyGroupId` is the consenter's currently-linked family (not the initiating family); a PULL create needs the initiating family to see H through a resident-member (else 403 at create); a JOIN accept works with no such precondition; a counterparty who unlinks before accept → accept returns `UNAUTHORIZED` → 403 (authorization re-checked in-tx, and lost authority is NOT idempotent success); dual-authority (an admin of both the initiating family and a family linked to H can accept); a double-accept is idempotent (one link); a duplicate-pending is rejected (partial index).

- [ ] **Step 2: Run the tests.** Expected: FAIL (501).
- [ ] **Step 3: Implement** `createHouseholdLinkRequest`, `canConsentHousehold`, and `claimAndAcceptHousehold`:

```typescript
import { writeHouseholdAudit } from "./householdAccess";

export class HouseholdNotVisible extends Error {}
export class NotInitiatingAdmin extends Error {}

export async function createHouseholdLinkRequest(params: {
  familyGroupId: string; requester: { id: string }; targetHouseholdId: string; direction: LinkRequestDirection;
}): Promise<LinkRequest> {
  // [council BLOCKER] the requester must be an admin of the INITIATING family (`familyGroupId`) — for BOTH
  // directions. Without this, JOIN lets any authenticated person open a request on an arbitrary family, and
  // PULL only proved the family can see H, not that the requester belongs to that family.
  const initiating = await activeFamilyMembership(params.familyGroupId, params.requester.id);
  if (!initiating || !hasAdminRole(initiating)) throw new NotInitiatingAdmin();
  // PULL precondition: the initiating family must SEE H through a resident who is a member of it. [R2 BLOCKER #10]
  if (params.direction === "PULL") {
    const sees = await db.householdMember.findFirst({ where: { householdId: params.targetHouseholdId,
      person: { familyMemberships: { some: { familyGroupId: params.familyGroupId, suspendedAt: null } } } } });
    if (!sees) throw new HouseholdNotVisible();
  }
  const already = await db.householdFamily.findUnique({ where: { householdId_familyGroupId: {
    householdId: params.targetHouseholdId, familyGroupId: params.familyGroupId } } });
  if (already) throw new RequestAlreadyPending();
  // [R3] sweep an expired-but-still-PENDING duplicate so it cannot block the partial-unique index
  await db.linkRequest.updateMany({ where: { kind: "HOUSEHOLD_LINK", familyGroupId: params.familyGroupId,
    targetHouseholdId: params.targetHouseholdId, status: "PENDING", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED", resolvedAt: new Date() } });
  try {
    return await db.linkRequest.create({ data: { kind: "HOUSEHOLD_LINK", direction: params.direction,
      familyGroupId: params.familyGroupId, targetHouseholdId: params.targetHouseholdId,
      requestedByPersonId: params.requester.id, status: "PENDING",
      expiresAt: new Date(Date.now() + LINK_REQUEST_TTL_DAYS * 86_400_000) } });
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && (e as {code:string}).code === "P2002") throw new RequestAlreadyPending();
    throw e;
  }
}

/** Counterparty = admin of a family CURRENTLY linked to H. Dual-authority allowed (requester can also qualify). */
async function householdConsentFamily(householdId: string, personId: string): Promise<string | null> {
  const memberships = await db.familyMember.findMany({ where: { personId, suspendedAt: null,
    familyGroup: { householdLinks: { some: { householdId } } } } });
  const admin = memberships.find(hasAdminRole);
  return admin ? admin.familyGroupId : null;
}
export async function canConsentHousehold(r: LinkRequest, person: { id: string }): Promise<boolean> {
  if (r.kind !== "HOUSEHOLD_LINK" || !r.targetHouseholdId) return false;
  return (await householdConsentFamily(r.targetHouseholdId, person.id)) !== null; // dual-authority: no requester exclusion
}

/** [council MAJOR] distinct outcomes so the route never treats lost authority as idempotent success. */
export type HouseholdAcceptOutcome = "GRANTED" | "RESOLVED" | "UNAUTHORIZED";

export async function claimAndAcceptHousehold(r: LinkRequest, consenter: { id: string }): Promise<HouseholdAcceptOutcome> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Household" WHERE "id" = ${r.targetHouseholdId} FOR UPDATE`;
    // Re-validate authority AND pending status UNDER the lock. [R2 BLOCKER #11]
    const stillAdmin = await tx.familyMember.findFirst({ where: { personId: consenter.id, suspendedAt: null,
      familyGroup: { householdLinks: { some: { householdId: r.targetHouseholdId! } } }, roles: { has: "ADMIN" } } });
    if (!stillAdmin) return "UNAUTHORIZED"; // lost authority — the route returns 403, NOT idempotent success
    // The claim re-checks status AND expiry under the lock. [council BLOCKER: expiry must be enforced by the claim]
    const claim = await tx.linkRequest.updateMany({ where: { id: r.id, status: "PENDING", expiresAt: { gt: new Date() } },
      data: { status: "ACCEPTED", consentedByPersonId: consenter.id, consentChannel: "IN_APP", resolvedAt: new Date() } });
    if (claim.count === 0) return "RESOLVED"; // already resolved or expired — the route returns the current state
    const existing = await tx.householdFamily.findUnique({ where: { householdId_familyGroupId: {
      householdId: r.targetHouseholdId!, familyGroupId: r.familyGroupId } } });
    if (!existing) {
      await tx.householdFamily.create({ data: { householdId: r.targetHouseholdId!, familyGroupId: r.familyGroupId, linkedByPersonId: consenter.id } });
      await writeHouseholdAudit(tx, { householdId: r.targetHouseholdId!, actorPersonId: consenter.id,
        actorFamilyGroupId: stillAdmin.familyGroupId, action: "LINKED" }); // [R2 MAJOR] consenter's family, not the initiator's
    }
    return "GRANTED";
  });
}
```

The household accept route maps the outcome: `GRANTED` → 200 with the fresh state; `RESOLVED` → re-read and return the current state (idempotent, 200); `UNAUTHORIZED` → 403. Never serialize state on `UNAUTHORIZED`.

- [ ] **Step 4: Wire the branches.** Wire the `HOUSEHOLD_LINK` create branch and dispatch accept and decline on `r.kind`. The household create needs `INVITE_MEMBERS`-class admin authorization of the initiating family (enforced inside `createHouseholdLinkRequest`). Extend `GET /pending` to include household requests through `householdConsentFamily`. Map `HouseholdNotVisible` → 403 and `NotInitiatingAdmin` → 403. Map the accept outcome (`GRANTED`/`RESOLVED`/`UNAUTHORIZED`) per the note above. Serialize a household inbox row with `serializeInboxRequest` (add `targetHouseholdName`, names only).
- [ ] **Step 5: Run the tests.** Expected: PASS (including lock-revalidation and dual-authority).
- [ ] **Step 6: Commit** `feat: P3-04 household link requests (PULL+JOIN, visibility precondition, lock-revalidated authz)`.

---

### Task 9: Reroute direct member-add + provenance gate + remove the dead seat field

**Files:** modify `apps/api/src/routes/families.ts`, `apps/web/app/onboarding/steps/InviteStep.tsx`; test `families.members.reroute.test.ts` and the InviteStep web test. Also audit the other web callers.

**Interfaces:**
- Consumes: `classifyMembershipTarget` (Task 3); `Person.createdByFamilyGroupId` (Task 2).
- Produces: a direct-add gated to a provably-authored data-entry target; the dead `confirmSeatExpansion` field removed.

- [ ] **Step 1: Audit every direct-add caller first** (this shapes the test fixtures):

Run `git grep -n "families/.*/members\|/members'" apps/web apps/mobile apps/api` and inspect `apps/web/app/onboarding/steps/InviteStep.tsx`. **[R2 — BLOCKER #1.]** Record the findings in the task notes. Expected: onboarding creates a brand-new passive person owned by the creator's family, so it still passes the provenance gate. Any caller that passes a contact must move to the link-request flow (a PR-3 web change — note it, do not silently break it: the API returns `CONSENT_REQUIRED` with a hint so PR-3 can adapt).

- [ ] **Step 2: Write the failing tests** — a passive, contact-less target whose `createdByFamilyGroupId` equals this family → 201 (data entry); a passive, contact-less target whose `createdByFamilyGroupId` is null or a foreign family → 409 `CONSENT_REQUIRED` (no `FamilyMember` created) **[R3 — decision 9 provenance]**; an active-account target → 409; a passive-with-contact target → 409.

- [ ] **Step 3: Implement the guard** — re-read the person AND create the `FamilyMember` in ONE transaction, so the target cannot acquire an account or a contact between the check and the insert **[council MAJOR: classify-then-insert was a TOCTOU pair]**. The gate predicate is the same one `classifyMembershipTarget` uses (passive, no raw or normalized contact) plus the decision-9 provenance test. The billing branch is already gone (removed by the PR-13 billing slice), so this task adds only the gate and removes the now-dead `confirmSeatExpansion` field:

```typescript
const result = await db.$transaction(async (tx) => {
  // Lock the person row so it cannot gain a userId or a contact between the read and the insert.
  // A plain READ COMMITTED tx does NOT prevent that race on its own. [council MAJOR: TOCTOU needs a lock.]
  await tx.$queryRaw`SELECT "id" FROM "Person" WHERE "id" = ${body.data.personId} FOR UPDATE`;
  const t = await tx.person.findUnique({ where: { id: body.data.personId } });
  if (!t) return { error: "NOT_FOUND" as const };
  const passiveNoContact = t.userId === null && !t.email && !t.phone && !t.emailNormalized && !t.phoneNormalized;
  if (!passiveNoContact || t.createdByFamilyGroupId !== familyId) return { error: "CONSENT_REQUIRED" as const };
  try {
    const member = await tx.familyMember.create({ data: {
      familyGroupId: familyId, personId: t.id, roles: body.data.roles, permissions: body.data.permissions } });
    return { member };
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && (e as {code:string}).code === "P2002") return { error: "ALREADY_MEMBER" as const };
    throw e;
  }
});
if ("error" in result) {
  if (result.error === "NOT_FOUND") { res.status(400).json({ error: "Person not found" }); return; }
  if (result.error === "ALREADY_MEMBER") { res.status(400).json({ error: "Person is already a member of this family" }); return; }
  res.status(409).json({ error: "CONSENT_REQUIRED",
    hint: "This person has an account, contact details, or a different owning family — send a link request they can accept.",
    linkRequest: { endpoint: "/api/v1/link-requests", kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: familyId, targetPersonId: body.data.personId } });
  return;
}
```

- [ ] **Step 4: Keep onboarding working (the one web change PR-2 carries).** **[council BLOCKER: the gate breaks onboarding, because `InviteStep.tsx` creates the passive person without `familyGroupId`, so the person has a null owner and the direct add then returns `CONSENT_REQUIRED`.]** In `apps/web/app/onboarding/steps/InviteStep.tsx`, add `familyGroupId` to the existing `POST /api/v1/persons` body (which today sends only `firstName`/`lastName`/`ageGateLevel`). This stamps `createdByFamilyGroupId` (Task 2), so the following direct member-add passes the provenance gate.
  - **IMPORTANT — do NOT also start sending the collected email/phone.** `InviteStep` today collects an email or phone but **discards it** (it never puts it in the `POST /persons` body), so onboarding already creates contact-less data-entry records and sends no invitation. Keep that behavior. If this step passed the contact, the person classifies as TOKEN and the direct add correctly returns `CONSENT_REQUIRED`, which breaks onboarding. So the created record stays contact-less (a genuine authored data-entry record, consistent with decision 8), and PR-2 introduces no new consent bypass. Routing a contact-bearing onboarding invitee through the consent/token flow is a **PR-3** change (it needs the consent UI PR-3 builds) — see the deferred item.
  - The stale `402` seat-modal branch in `InviteStep` (the `SeatExpansionModal` path) is dead after the PR-13 billing slice. Leave it for a PR-3 cleanup unless it blocks the test; note it in the task notes.
  - Add or update the web test for the `POST /persons` call carrying `familyGroupId`. Run `npx vitest run --coverage` in `apps/web`. Expected: PASS at ≥80% lines. This is the minimum web change to keep onboarding green — the full consent inbox and `/consent` page stay in PR 3.
- [ ] **Step 5: Remove the dead field.** Delete `confirmSeatExpansion` from `AddMemberSchema` (the PR-13 billing slice removed its only reader, so it is dead). Update any families member test that added an active, a contact, or a foreign target directly. Run `npm test --workspace=@famlink/api -- families`. Expected: PASS.
- [ ] **Step 6: Lint.** Prune an orphaned import only when no other handler in `families.ts` uses it (grep first). Run `npm run lint --workspace=@famlink/api`. Expected: 0 errors.
- [ ] **Step 7: Commit** `feat: P3-04 gate direct member-add to provably-authored data-entry (provenance); keep onboarding green; remove dead confirmSeatExpansion`.

---

### Task 10: HOUSEHOLD-scope event-invite escalation (reuse the W3a path, gated, no id leak)

**Files:** modify `routes/events.ts`; test `events.household-invite.test.ts`.

**Interfaces:**
- Consumes: the existing W3a `resolveEventAccess` and the famlinkUser / guest invitation dispatch already in `events.ts`.
- Produces: a `{ kind: "household", householdId }` invitee that expands the household with the correct gates and name-only skips.

The escalation expands a household invitee: an event-family member → an `EventInvitation`; a non-member resident with an account → a W3a `famlinkUser` invitation (`EventInvitation` + `linkedPersonId` + role + token; accept grants the `EventParticipant`); a non-member resident with a contact but no account → a guest `EventInvitation` (they cannot authenticate); a passive or minor non-member with no reachable consent → skipped, surfaced by display name and reason (never a foreign id).

- [ ] **Step 1: Write the failing tests** — a member resident → an `EventInvitation`; a non-member active resident → an `EventInvitation` with `linkedPersonId` and role (NOT an `EventParticipant` yet — visibility only after accept) **[R2 — BLOCKER #13]**; a non-member contact-only resident → a guest `EventInvitation`; a passive or minor non-member → `skipped:[{displayName, reason}]` with no personId **[R2 — BLOCKER #14 id leak]**; a household-access gate (an organizer whose family is not linked to the household → 403); an event-admin gate (an expansion that produces a cross-family invitee needs event-admin access); the invitations response carries no `guestToken`, `linkedPersonId`, `personId`, email, or phone (assert their absence in the JSON).

- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** — add `{ kind:"household", householdId }` to `InviteeSchema`. Before the loop, gate two things: (a) the household must be linked to the event's family (a `householdFamily` row with this `householdId` and `familyGroupId = event.familyGroupId`), or the organizer must otherwise have household access, else 403; (b) if any household will expand to a non-member resident, the organizer needs `resolveEventAccess(...).canAdmin` (reuse the existing cross-family gate, widened to the household expansion). In the loop, per resident: an event-family member → an `EventInvitation` (scope HOUSEHOLD); a non-member with `userId` → a `famlinkUser` `EventInvitation` (push to `famlinkUserInvites`); a non-member with a contact but no `userId` → a guest `EventInvitation` plus `guestInvites`; else → `skipped.push({ displayName, reason: minor ? "MINOR_NON_MEMBER" : "NO_CONTACT" })`. Never create an `EventParticipant` directly. Reuse the famlinkUser / guest notification dispatch already in this handler.
- [ ] **Step 4: Return a serialized summary, never raw rows.** **[council BLOCKER: `createdInvitations.push(created)` returns raw `EventInvitation` rows carrying `guestToken`, `linkedPersonId`, and guest email/phone. Household expansion pulls FOREIGN residents into that response, so it hands the organizer acceptance tokens and foreign person ids.]** Map each created invitation to a name-and-status shape only: `{ displayName, channel, status }` — no `guestToken`, no `linkedPersonId`, no `personId`, no email or phone. Return `{ invitations: <serialized summaries>, skipped }` (skipped carries display names and reasons only). Confirm the existing (non-household) invite response either already used this safe shape or gets migrated to it in the same change (do not widen an existing leak; if the current handler returns raw rows, this is the moment to serialize it, with a regression test).
- [ ] **Step 5: Run the tests.** Expected: PASS (and no regression in the existing invite tests).
- [ ] **Step 6: Commit** `feat: P3-04 HOUSEHOLD-scope invite escalation (W3a path reuse, access+admin gated, name-only skips)`.

---

### Task 11: CIF `mergePersons` learns the `LinkRequest` person columns

**Files:** modify `apps/api/src/lib/personIdentity.ts`; test `lib/__tests__/personIdentity.linkRequest.test.ts`.

**Interfaces:**
- Consumes: the existing `mergePersons` logical-column repoint mechanism (the `nonUnique` array).
- Produces: `mergePersons` repoints `LinkRequest.targetPersonId`, `requestedByPersonId`, and `consentedByPersonId` from the merged (losing) person to the survivor. **[R2 — BLOCKER #15.]**

- [ ] **Step 1: Write the failing test** — a PENDING request targets a passive person; merge that person into an account; assert the request's `targetPersonId` now points at the survivor and stays resolvable (not orphaned).

```typescript
it("mergePersons repoints LinkRequest.targetPersonId to the survivor", async () => {
  // seed a passive target + a survivor account, a PENDING request at the passive id, then merge
  await mergePersons(survivor.id, passive.id);
  const req = await db.linkRequest.findUnique({ where: { id: reqId } });
  expect(req!.targetPersonId).toBe(survivor.id);
});
```

- [ ] **Step 2: Run the test.** Expected: FAIL (the column is not repointed).
- [ ] **Step 3: Implement** — add three entries to the `nonUnique` array in `mergePersons` (the same mechanism that already repoints `HouseholdAuditEntry.actorPersonId`):

```typescript
["LinkRequest.targetPersonId", tx.linkRequest.updateMany({ where: { targetPersonId: duplicateId }, data: { targetPersonId: canonicalId } })],
["LinkRequest.requestedByPersonId", tx.linkRequest.updateMany({ where: { requestedByPersonId: duplicateId }, data: { requestedByPersonId: canonicalId } })],
["LinkRequest.consentedByPersonId", tx.linkRequest.updateMany({ where: { consentedByPersonId: duplicateId }, data: { consentedByPersonId: canonicalId } })]
```

A repoint can collide with the partial-unique pending index when both persons had a PENDING request to the same family. In that case the `updateMany` throws P2002 inside the tx. Guard it: before the repoint, resolve the collision deterministically — keep the older PENDING and set the other to `CANCELLED`. Add that case to the test.

- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: P3-04 mergePersons repoints LinkRequest person columns (no orphaned consent)`.

---

### Task 12: Isolation + concurrency regression pack

**Files:** create `routes/__tests__/linkRequests.isolation.test.ts`, `routes/__tests__/linkRequests.concurrency.test.ts`. Test-only (any failure is a real leak or race — fix the owning task's production file).

- [ ] **Step 1: Write the isolation pack** — inv1 (the inbox and the consent page carry family and household names only; assert the absence of every foreign id, roster, and token in the JSON); inv4 (the token never appears in the Morgan output — capture the actual logger line and assert `[redacted]`, not a `console.info` spy; include a POST whose `Referer` header is the `/consent/<token>` URL and assert the logged referrer is `[redacted]` too) **[R2 — BLOCKER #7; council BLOCKER: the referrer]**; inv5 (only a matrix counterparty accepts; a foreign caller → 403 before any payload, and the row stays PENDING); row-existence (no `FamilyMember` or `HouseholdFamily` while PENDING); the escalation `invitations` and `skipped[]` carry no token and no foreign `personId`.

- [ ] **Step 2: Write the concurrency pack** **[R2 — MAJOR: races untested]** — a concurrent double-accept (membership and household) → exactly one grant; a concurrent link-versus-unlink on a household → min-1 holds and no tenantless household; a concurrent duplicate-create → one row (partial index); an accept-versus-decline → the terminal state and the grant agree; an expired-but-still-PENDING duplicate is swept before a new create so the partial index does not spuriously reject **[R3]**.

The double-accept test must prove that exactly ONE call performed the claim, not only that the final membership count is 1 — the idempotent upsert makes the count 1 even when claim serialization is broken (council MINOR). To make this observable, the accept route returns `granted: boolean` (true only when THIS call did the grant — the `GRANTED` outcome; `RESOLVED` returns `granted:false` with the current state). Assert exactly one `granted:true`.

```typescript
it("two simultaneous accepts grant exactly once", async () => {
  const [a, b] = await Promise.all([
    asPerson(targetId).post(`/api/v1/link-requests/${reqId}/accept`).send({}),
    asPerson(targetId).post(`/api/v1/link-requests/${reqId}/accept`).send({}) ]);
  expect([a.status, b.status].every((s) => s === 200)).toBe(true);
  expect([a.body.granted, b.body.granted].filter(Boolean).length).toBe(1); // exactly one caller claimed
  expect(await db.familyMember.count({ where: { familyGroupId, personId: targetId } })).toBe(1);
  const row = await db.linkRequest.findUnique({ where: { id: reqId } });
  expect(row!.status).toBe("ACCEPTED");
});
```

- [ ] **Step 3: Release gate** — run `npm test --workspace=@famlink/api && npm run type-check && npm run lint`. Expected: the API suite green (≥534 plus the new tests), type-check 6/6, lint 0 errors.
- [ ] **Step 4: Per-task change detection** **[R2 — BLOCKER: per-task `detect_changes`]** — run GitNexus `detect_changes({ scope:"compare", base_ref:"main" })` and cross-check `git diff --stat` (the worktree new-file gotcha means a `detect_changes` symbol list is unreliable for a brand-new file — trust `git diff` for those). The affected surface must be the LinkRequest files plus `families.ts` / `events.ts` / `persons.ts` / `personIdentity.ts` / `requestLogger.ts` plus the schema.
- [ ] **Step 5: Commit** `test: P3-04 W1 PR-2 isolation + concurrency regression pack`.

---

## Self-Review (against the spec and the round-2/round-3 findings)

**Spec coverage:** §3.2 model → T1; decision 9 provenance column + backfill + stamp → T2; §2 decision 8 gate → T3/T4/T9; §6.2 create (membership PULL+JOIN, household PULL+JOIN) → T4/T8; the inbox plus accept/decline → T5; passive token plus `/consent` plus contact verify → T6; §6.3 matrix plus guardian plus minor-no-token plus attestation → T4/T5/T7; carry-in (disclose + record skip) → T5; §2 decision 3 / invariant 3 escalation → T10; the FOR-UPDATE lock on a household link create → T8; §11 attestation → T4; the CIF merge → T11; isolation and concurrency → T12. Decision 10 (no Stripe in the consent flow) is a global constraint honored across T4 (read-only disclosure only), T5 (grant with no Stripe), and T9 (the seat branch already removed by PR #13). ✅

**Every accepted BLOCKER is mapped:** #1 onboarding caller → T9.1; #2 provenance → T2 (column) + T9 (gate); #3 seat authority → removed by decision 10 (T4 read-only disclosure, T5 no inline billing); #4 race-safe → T5/T8 conditional-claim; #5 expiry/idempotency + the DB constraint → T1 (index) + T4/T8 (expiry sweep before create) + T5 (`resolveExpiry` + authorize-first); #6 inbox id leak → T5 `serializeInboxRequest`; #7 token in logs → T6 (mask) + T12 (assert); #8 delivery/verify → T3/T6 (normalized + single channel + snapshot); #9 attestation/guardian → T4/T7; #10 JOIN + PULL-visibility → T4/T8; #11 lock-revalidated authz + dual-authority → T8; #12 carry-in disclose/record → T5; #13 W3a participant status → T10; #14 escalation gates + id leak → T10; #15 CIF merge → T11. The round-2 mechanical BLOCKERs are all mapped: delivery-wiring regression → T9.1; atomic token + verify → T6; snapshot delivered contact → T1 (`deliveredContact`) + T6; minor-branch ordering + attestation-before-minor → T4; channel fallback → T6; inbox target-name → T5; owner-id echo → T4 `serializeOwnerRequest`; carry-in / household create-time authz → T5/T8; expiry-sweep-on-create → T4/T8; token-replay idempotency → T6; no-op-grant guard → T5 (idempotent upsert); per-task `detect_changes` → T12.

**Deferred (name each in the review brief):** the web/mobile consent inbox and the `/consent` page → PR 3 / PR 4; the delivery-failure retry/status model (this PR does best-effort delivery plus a `tokenChannel` and `deliveredContact` record only); **onboarding consent routing → PR 3** — `InviteStep` today collects an email or phone and discards it, so onboarding creates contact-less data-entry records with no invitation sent. PR-2 keeps that behavior (it only adds `familyGroupId` for provenance). PR 3 must make onboarding pass the collected contact and route a contact-bearing invitee through the link-request/token consent flow (the API returns a `CONSENT_REQUIRED` hint so PR 3 can adapt), and remove the now-dead `402` `SeatExpansionModal` branch in `InviteStep`.

**A note on the round-2 council item I scoped rather than fixed here:** the reviewer flagged onboarding as a "shipped consent bypass". I disagree it blocks PR-2. Onboarding already discards the collected contact today, so the records it creates are genuinely contact-less data entry — consistent with decision 8, not a new bypass PR-2 introduces. Making onboarding honor the contact through consent needs the PR-3 consent UI, so it belongs in PR 3 (recorded above), not forced into this API PR.

**Carry the PR-2 constraints (from the PR-1 whole-branch review):** T8 takes the same `SELECT … FOR UPDATE` lock on the household row when it creates a link (min-1 was serialized only against a concurrent unlink until now). The review brief must name `families.ts`, `aiTools.ts`, and the audit endpoint as in-scope even though PR 2 does not touch them — PR 2 is what makes a multi-link household reachable, and the PR-1 review found isolation leaks living in exactly those files (invisible to a per-task review and invisible in PR 2's own diff).

## Council round-3 (Codex) — findings folded in

A Codex council pass on the round-3 draft returned 10 BLOCKERs, 6 MAJORs, and 2 MINORs. All are folded in:

- **Atomic token + verify** (BLOCKER) — `claimAndAcceptMembership` opened its own tx, so "reuse it, then stamp verify in the same tx" was not atomic. Fixed: `grantMembershipInTx(tx, …)` is the shared grant core; the token route wraps grant + verify in one `db.$transaction` (Task 6).
- **Expiry enforced by the claim** (BLOCKER) — every conditional claim now filters `expiresAt: { gt: now }`, so an expired-but-unswept row is never granted (Task 5 core, Task 8).
- **Authorize before mutate** (BLOCKER) — the accept route runs `canConsent*` on the raw row BEFORE `resolveExpiry` (which mutates). A foreign caller on an expired id gets 403 and no write (Task 5).
- **Household create authorization** (BLOCKER) — `createHouseholdLinkRequest` now requires the requester to be an admin of the initiating family, for both PULL and JOIN (`NotInitiatingAdmin` → 403; Task 8).
- **`carryHouseholdId` validated at create** (BLOCKER) — an unvalidated foreign id leaked its name to the counterparty through the inbox. Now validated at create (`CarryHouseholdInvalid` → 400; Task 4).
- **Family-less guardian inbox** (BLOCKER) — `GET /pending` gained the `guardianPersonId` branch, so a family-less minor's guardian sees the request (Task 5).
- **Onboarding stays green** (BLOCKER) — `InviteStep.tsx` now passes `familyGroupId` so the created person carries provenance and passes the gate; PR-2 carries this one web change (Task 9).
- **Token delivery wired** (BLOCKER) — a TOKEN create now calls `deliverConsentLink` (Task 4 step 5). The delivered link targets the PR-3 web page, acceptable while delivery is mocked.
- **Escalation response serialized** (BLOCKER) — Task 10 returns name-and-status summaries, never raw `EventInvitation` rows with `guestToken` / `linkedPersonId`.
- **Logger masks the referrer** (BLOCKER) — the token is redacted in both the path and the `Referer` header (Task 6, asserted in Task 12).
- **MAJORs:** in-tx authority re-check for the JOIN/guardian accept (Task 5 note); a discriminated household-accept outcome so lost authority is never idempotent success (Task 8); a single-family-only provenance backfill (Task 2); a transactional direct-add gate to close the classify→insert TOCTOU (Task 9); a reject on an already-existing member (Task 4).
- **MINORs:** the double-accept test proves a single claim, not only a final count (Task 12); the billing disclosure appears only for an active-account target (Task 4).

A second Codex pass verified convergence and confirmed the fixes landed (atomic token+verify, authorize-before-mutate, household initiation authz, carry-in validation, the family-less guardian branch, wired delivery, safe Task-10 serialization, path+Referer masking, correct audit attribution, no pre-accept `EventParticipant`, no Stripe call). It surfaced a second round of concrete gaps, all now folded in: `deliveredContact` now drives the verification stamp (Task 6); the JOIN/guardian authority re-check is concrete code inside the tx (`recheckMembershipConsentTx`, Task 5); decline is expiry-safe through `resolveExpiry`-first (Task 5); the direct-add tx takes a `FOR UPDATE` lock on the person to close the READ COMMITTED TOCTOU (Task 9); the accept route returns a `granted` flag so the concurrency test proves a single claim (Task 12); and `detect_changes` runs before every commit (Global Constraints). The reviewer also called onboarding a "shipped consent bypass" — scoped to PR 3, with the reasoning recorded in the self-review. The two council rounds are the cap; execution follows.

## Council round-3 focus

1. Does the conditional claim (`updateMany where status=PENDING`) fully serialize every accept path (membership, household, token page) with the grant in the same tx?
2. Does the consent flow call any Stripe symbol, on any path? (It must not — decision 10.)
3. Does any serializer still emit a foreign id, roster, or token (the inbox, the consent page, the escalation `skipped`, an error payload)?
4. Household accept: is the authority plus the pending status truly re-checked inside the `FOR UPDATE` tx, and is the audit `actorFamilyGroupId` the consenter's family?
5. Does the direct-add provenance rule (`DATA_ENTRY` plus `createdByFamilyGroupId === familyId`) close the foreign-passive-attach hole without breaking onboarding?
6. Does the escalation ever create an `EventParticipant` before accept, or invite a resident the organizer must not reach?
7. Does the expiry sweep before create stop a stale expired-PENDING row from blocking the partial-unique index?
