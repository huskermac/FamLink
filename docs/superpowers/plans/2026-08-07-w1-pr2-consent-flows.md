# W1 PR 2 — Consent Flows (LinkRequest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consent-gated family membership and household linking via a new `LinkRequest` model — a request→accept flow (both PULL and JOIN directions) where the counterparty (or a guardian for minors) always consents, passive targets consent through a single-use token link, plus the HOUSEHOLD-scoped event-invite escalation.

**Architecture:** A `LinkRequest` row holds pending consent; `FamilyMember`/`HouseholdFamily` rows are created **only on acceptance** (row existence = access, no status filters retrofitted into existing authz). Consent gates a *reachable autonomous party* only. Billing authority stays with the **requesting** family (seat expansion is authorized by the requesting admin at request time, applied at accept). All resolution is race-safe via a conditional status claim inside the grant transaction.

**Tech Stack:** Express 4 + Zod, Prisma 7.7 (interactive `$transaction`, raw `FOR UPDATE`), PostgreSQL (partial unique indexes), Jest + Supertest against real local Postgres, Twilio + Resend (mocked in tests), TypeScript strict.

> **This is a round-2 plan.** It incorporates the 2026-08-07 Codex council review (15 BLOCKERs, all accepted). Round-1 fixes are called out inline as **[R2]**. Steve decisions folded in: **JOIN is in scope** (both directions); **billing authority = requesting admin at request time**.

> ## ⚠️ STATUS: NOT EXECUTION-READY (2026-08-07)
> Round-2 council did **not** converge (15 → 14 BLOCKERs). Structural fixes (conditional-claim grant, lock-revalidated household authority, audit attribution, no pre-accept participant) are confirmed landed, but two **design-level** gaps block execution and need Steve's decision — no plan wording resolves them:
> 1. **Seat billing × async consent don't compose.** Request-time seat authorization is stale by accept time (capacity changes, CIF activation, concurrent requests, Stripe-after-commit has no retry). Likely fix: **decouple** billing from consent — reconcile seat count from actual active membership on membership change / Stripe webhook; drop per-request seat confirmation.
> 2. **Direct-add provenance is unprovable.** `Person` has no creator/owner column, so "data-entry" attach can't distinguish an authored record from a foreign one; the foreign-passive-attach hole remains. Likely fix: add a creator/owning-family column to `Person` (schema change) **or** accept a documented residual risk.
>
> The remaining ~12 round-2 BLOCKERs are mechanical (delivery-wiring regression, atomic token+verify, snapshot delivered contact, minor-branch ordering, attestation-before-minor, channel fallback, inbox target-name, owner-id echo, carry-in/household create-time authz, expiry-sweep-on-create, token-replay idempotency, no-op-grant billing guard, per-task `detect_changes`) — fixable in a round-3 revision **after** the two design decisions land. Do not execute until this banner is removed.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-14-w1-household-family-m2m-design.md`. Consent-gate scope is **§2 decision 8** (amended 2026-08-07): active account → in-app; passive with a contact detail → token; passive with no contact → data entry, no gate.
- **Row-existence = access.** Never add a `status` filter to `activeFamilyMembership`, `eventVisibility`, `householdAccess`, or any P3-00/W3a query. Unconsented state lives *only* in `LinkRequest`.
- **Billing authority = the requesting family.** Seat expansion beyond the tier allowance is authorized by the **requesting admin at request-creation time** (`confirmSeatExpansion` on create; recorded as `seatAuthorizedByRequester`). The consenter never sees or triggers billing. Accept applies the increment; if a seat was needed and the requester never authorized it, **accept still succeeds** and the family goes into the same over-allowance state the current add path produces — billing reconciles via the seat count / Stripe webhook (never block a consenting human on the *other* family's billing). **[R2 — BLOCKER: consenter can't hold billing authority; accept must not deadlock.]**
- **All resolution is race-safe.** Every accept/decline/expire is a **conditional claim**: `updateMany({ where: { id, status: "PENDING" }, ... })` inside the same transaction as the grant; `count === 0` means someone else resolved it → re-read and return current state (idempotent). Never `update` a request by id alone. **[R2 — BLOCKER: race-unsafe billing/resolution.]**
- **Authorize before you reveal.** Every accept/decline loads the request, runs the counterparty check, and only then branches on state. An already-resolved request is **never** serialized to a caller who fails `canConsent`. **[R2 — BLOCKER: idempotent branch leaked payload pre-authz.]**
- **Cross-tenant isolation (hard invariant).** Inbox, consent page, and escalation `skipped[]` carry **names only** — never a foreign `personId`, `familyGroupId`, `householdId`, roster, or token. A dedicated `serializeInboxRequest` (names-only) is the *only* serializer used on counterparty-facing responses. **[R2 — BLOCKER: serializeLinkRequest leaked ids.]**
- **Tokens are never logged and never in a logged URL.** Token is a DB opaque `crypto.randomBytes(32).toString("hex")`, `@unique`, single-use, 30-day. The consent route path is masked in the request logger (Morgan logs full URLs). Delivery/accept logs carry the **request id**, never the token. **[R2 — BLOCKER: Morgan logs /consent/:token.]**
- **Minors never receive token links.** TEEN/CHILD → guardian consents in-app; `consentedByPersonId` = guardian (must be `ADULT`, non-suspended). DOB-unknown passive targets require requester attestation (`attestedAdult`) or the request is refused. **[R2 — BLOCKER: attestation/guardian unenforced.]**
- **Verification per task:** run the targeted test, then before commit run `npm run type-check` and `npm run lint` (eslint-only errors have broken CI). API suite baseline **524/524**; keep green.
- **Commit format:** `feat: P3-04 <desc>`. Co-author trailer per repo convention.
- **Delivery is mockable, not live** (Twilio/Resend pending). Assert via mocks; no live-send smoke in this PR.

---

## File Structure

**Create:** `apps/api/src/lib/linkRequest.ts` (consent core), `apps/api/src/routes/linkRequests.ts` (authed routes), `apps/api/src/routes/consent.ts` (public token routes), `apps/api/src/lib/consentDelivery.ts` (passive delivery), migration dir, test files.

**Modify:** `packages/db/prisma/schema.prisma` (add `LinkRequest`), `apps/api/src/routes/families.ts` (reroute direct-add + provenance gate + delete add-time seat branch), `apps/api/src/routes/events.ts` (household escalation), `apps/api/src/routes/index.ts` (mount routers), `apps/api/src/lib/subscriptionEnforcement.ts` (extract `applySeatIncrement`), `apps/api/src/lib/personIdentity.ts` (`mergePersons` learns `LinkRequest` columns), `apps/api/src/middleware/requestLogger.ts` (mask consent token in logs).

**Boundary:** `lib/linkRequest.ts` owns all consent decisioning + the grant transactions; routes stay thin.

---

## Data model (spec §3.2, extended in R2)

```prisma
model LinkRequest {
  id                       String    @id @default(cuid())
  kind                     String    // FAMILY_MEMBERSHIP | HOUSEHOLD_LINK
  direction                String    // PULL | JOIN
  familyGroupId            String    // membership: the family joined; household: the initiating family
  targetPersonId           String?   // FAMILY_MEMBERSHIP (also = requester for membership JOIN)
  targetHouseholdId        String?   // HOUSEHOLD_LINK
  carryHouseholdId         String?
  carryInSkipped           Boolean   @default(false) // [R2] invalid carry-in recorded, not silent
  requestedByPersonId      String
  status                   String    @default("PENDING") // PENDING|ACCEPTED|DECLINED|EXPIRED|CANCELLED
  consentedByPersonId      String?
  consentChannel           String?   // IN_APP | SMS | EMAIL
  token                    String?   @unique
  tokenChannel             String?   // [R2] SMS | EMAIL — the ONE channel the token was sent on; only that contact is verified on accept
  attestedAdult            Boolean   @default(false)
  seatAuthorizedByRequester Boolean  @default(false) // [R2] billing authorized by requesting admin at create
  expiresAt                DateTime
  createdAt                DateTime  @default(now())
  resolvedAt               DateTime?

  @@index([familyGroupId, status])
  @@index([targetPersonId, status])
  @@index([targetHouseholdId, status])
}
```

All `*PersonId`/`*HouseholdId`/`*FamilyGroupId` are **logical columns (no FK)**, matching `HouseholdAuditEntry`.

Partial unique indexes (hand-added in the migration — Prisma `@@unique` can't be partial) prevent concurrent duplicate PENDING requests at the DB level **[R2 — BLOCKER: duplicate-pending had no DB constraint]**:
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

**Produces:** `LinkRequest` model + client type; the two partial unique indexes.

- [ ] **Step 1: Failing test** — round-trip + duplicate-pending rejection.

```typescript
import { db } from "@famlink/db";
describe("LinkRequest schema", () => {
  it("persists PENDING with R2 columns", async () => {
    const r = await db.linkRequest.create({ data: {
      kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: "f1",
      targetPersonId: "p1", requestedByPersonId: "p0",
      expiresAt: new Date(Date.now() + 86_400_000) } });
    expect(r.status).toBe("PENDING");
    expect(r.seatAuthorizedByRequester).toBe(false);
    expect(r.carryInSkipped).toBe(false);
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

- [ ] **Step 2:** Add the model to `schema.prisma` (block above).
- [ ] **Step 3:** `npx prisma migrate dev --name link_request --create-only --config=prisma.config.ts` (from `packages/db`); then **hand-append the two partial unique index `CREATE`s** to the generated `migration.sql` (Prisma won't emit partials). Confirm no `DROP`/`ALTER` of existing tables; no backfill.
- [ ] **Step 4:** `npx prisma migrate dev --config=prisma.config.ts && npm run build` (regenerate + copy client to `dist`; PR-1 stale-client gotcha).
- [ ] **Step 5:** `npm test --workspace=@famlink/api -- linkRequest.migration` → PASS (both).
- [ ] **Step 6:** Commit `feat: P3-04 LinkRequest model + migration (partial-unique pending guards)`.

---

### Task 2: Consent-gate classification + token helpers

**Files:** create `apps/api/src/lib/linkRequest.ts`; test `apps/api/src/lib/__tests__/linkRequest.classify.test.ts`.

**Produces:** `classifyMembershipTarget`, `generateConsentToken`, `isMinorLevel`, `isAdultLevel`.

- [ ] **Step 1: Failing tests** — the four branches + minor/adult helpers (as round-1 Task 2, plus:)

```typescript
it("passive with only NORMALIZED contact (CIF-created) still classifies TOKEN", async () => {
  const p = await db.person.create({ data: { firstName:"N", lastName:"C", ageGateLevel:"ADULT",
    userId:null, email:null, phone:null, phoneNormalized:"+14155552671" } });
  expect((await classifyMembershipTarget({ personId: p.id })).kind).toBe("TOKEN");
});
```
**[R2 — BLOCKER #8:** classification and delivery must both consider normalized contact fields, since CIF stores only those on new persons.**]**

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** (contact presence checks **both** raw and normalized):

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

- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: P3-04 consent-gate classification + token helpers`.

---

### Task 3: Create link-request route — membership PULL + JOIN, kind-specific schema, request-time seat authorization

**Files:** create `apps/api/src/routes/linkRequests.ts`; modify `index.ts`, `lib/linkRequest.ts`; test `linkRequests.create.test.ts`.

**Produces:** `POST /api/v1/link-requests` (mounted at `/api/v1/link-requests`, family id in body); `createMembershipRequest`; `serializeOwnerRequest` (requester-facing, includes own ids) and `serializeInboxRequest` (counterparty-facing, **names only**).

> **Route shape:** one router at `/api/v1/link-requests` (family id in body) so the family-agnostic inbox/accept/decline live with create. Documented deviation from spec's `/families/:id/link-requests`.

- [ ] **Step 1: Failing tests** — membership PULL (active/token/data-entry-409/non-admin-403/duplicate-409), **membership JOIN** (a person asks a family; requester==target; created PENDING), **kind-specific schema** rejects mixed/empty targets (400), **request-time seat authorization** (active-account target needing a seat → 402 unless `confirmSeatExpansion`, recorded on the row).

```typescript
it("membership JOIN: a person asks to join a family → 201 PENDING, requester is the target", async () => {
  const res = await asPerson(applicantId).post("/api/v1/link-requests").send({
    kind:"FAMILY_MEMBERSHIP", direction:"JOIN", familyGroupId: targetFamilyId });
  expect(res.status).toBe(201);
  const row = await db.linkRequest.findFirst({ where:{ familyGroupId: targetFamilyId, requestedByPersonId: applicantId }});
  expect(row!.targetPersonId).toBe(applicantId);
});
it("active-account target needing a seat → 402 unless requester confirms; confirmation recorded", async () => {
  const r1 = await asAdmin(adminId).post("/api/v1/link-requests").send({
    kind:"FAMILY_MEMBERSHIP", direction:"PULL", familyGroupId, targetPersonId: seatConsumingActiveId });
  expect(r1.status).toBe(402);
  const r2 = await asAdmin(adminId).post("/api/v1/link-requests").send({
    kind:"FAMILY_MEMBERSHIP", direction:"PULL", familyGroupId, targetPersonId: seatConsumingActiveId, confirmSeatExpansion:true });
  expect(r2.status).toBe(201);
  const row = await db.linkRequest.findUnique({ where:{ id: r2.body.id }});
  expect(row!.seatAuthorizedByRequester).toBe(true);
});
it("DOB-unknown passive target without attestation → 400 ATTESTATION_REQUIRED", async () => {
  const res = await asAdmin(adminId).post("/api/v1/link-requests").send({
    kind:"FAMILY_MEMBERSHIP", direction:"PULL", familyGroupId, targetEmail:"dobunknown@x.com" });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe("ATTESTATION_REQUIRED");
});
```

- [ ] **Step 2:** Run → FAIL (404).
- [ ] **Step 3: Implement `createMembershipRequest`** (classification, JOIN vs PULL authz split, attestation gate, request-time seat authorization, duplicate handled by the DB partial index → catch P2002):

```typescript
// lib/linkRequest.ts
import type { LinkRequest, Prisma } from "@famlink/db";
import { activeFamilyMembership, hasPermission } from "./familyAccess";
import { checkSeatExpansion } from "./subscriptionEnforcement";

export class DataEntryNoConsent extends Error {}
export class RequestAlreadyPending extends Error {}
export class SeatAuthorizationRequired extends Error { constructor(public activeCount: number){ super("seat"); } }
export class AttestationRequired extends Error {}

export async function createMembershipRequest(params: {
  familyGroupId: string; direction: LinkRequestDirection; requester: { id: string };
  target?: { personId?: string; email?: string; phone?: string };
  carryHouseholdId?: string; attestedAdult?: boolean; confirmSeatExpansion?: boolean;
}): Promise<{ request: LinkRequest; cls: MembershipTargetClass }> {
  // JOIN: the requester IS the target (a person asking to join `familyGroupId`).
  const target = params.direction === "JOIN" ? { personId: params.requester.id } : (params.target ?? {});
  const cls = await classifyMembershipTarget(target);
  if (cls.kind === "DATA_ENTRY") throw new DataEntryNoConsent();

  const targetPerson = await db.person.findUnique({ where: { id: cls.personId } });
  const minor = targetPerson ? isMinorLevel(targetPerson.ageGateLevel) : false;

  // Attestation: DOB-unknown passive TOKEN target treated as adult only with requester attestation (spec §11).
  if (cls.kind === "TOKEN" && !targetPerson?.dateOfBirth && !params.attestedAdult) throw new AttestationRequired();

  // Request-time seat authorization (billing authority = requesting family). PULL only; JOIN applicant can't authorize the family's billing — the accepting admin does (handled at accept for JOIN).
  let seatAuthorized = false;
  if (params.direction === "PULL" && targetPerson?.userId) {
    const activeCount = await db.familyMember.count({
      where: { familyGroupId: params.familyGroupId, person: { userId: { not: null } }, suspendedAt: null } });
    const check = await checkSeatExpansion(params.familyGroupId, activeCount);
    if (check.requiresConfirmation && !params.confirmSeatExpansion) throw new SeatAuthorizationRequired(activeCount);
    seatAuthorized = check.requiresConfirmation && Boolean(params.confirmSeatExpansion);
  }

  const useToken = cls.kind === "TOKEN" && !minor; // minors: guardian in-app, never a token (Task 6 also asserts)
  try {
    const request = await db.linkRequest.create({ data: {
      kind: "FAMILY_MEMBERSHIP", direction: params.direction, familyGroupId: params.familyGroupId,
      targetPersonId: cls.personId, carryHouseholdId: params.carryHouseholdId ?? null,
      requestedByPersonId: params.requester.id, status: "PENDING",
      consentChannel: (minor || cls.kind === "IN_APP") ? "IN_APP" : null,
      token: useToken ? generateConsentToken() : null,
      attestedAdult: params.attestedAdult ?? false, seatAuthorizedByRequester: seatAuthorized,
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
    consentChannel:r.consentChannel, seatAuthorizedByRequester:r.seatAuthorizedByRequester,
    expiresAt:r.expiresAt.toISOString(), createdAt:r.createdAt.toISOString(), resolvedAt:r.resolvedAt?.toISOString() ?? null };
}
// serializeInboxRequest (names only) defined in Task 4.
```

- [ ] **Step 4: Implement the route** with a **kind-specific Zod schema** (`superRefine`: FAMILY_MEMBERSHIP+PULL requires exactly one of `targetPersonId`/contact and forbids household fields; FAMILY_MEMBERSHIP+JOIN forbids any target; HOUSEHOLD_LINK requires `targetHouseholdId`, forbids person/contact) **[R2 — MAJOR: schema didn't enforce shapes]**; map `DataEntryNoConsent`→409 `DATA_ENTRY_NO_CONSENT`, `RequestAlreadyPending`→409, `SeatAuthorizationRequired`→402 `{seatRequired,currentActiveCount}`, `AttestationRequired`→400. Requester authz: PULL requires `INVITE_MEMBERS` admin of `familyGroupId`; JOIN requires only an authenticated person (the applicant). Dispatch `HOUSEHOLD_LINK` → Task 7 (temporary 501). Return `serializeOwnerRequest`.
- [ ] **Step 5:** Create `consentDelivery.ts` stub (real in Task 5). Mount `linkRequestsRouter` behind `requireAuth, requirePerson` in `index.ts`.
- [ ] **Step 6:** Run → PASS.
- [ ] **Step 7:** Commit `feat: P3-04 create membership link-request (PULL+JOIN, request-time seat auth, kind-specific schema)`.

---

### Task 4: Pending inbox (DB-scoped, names-only) + accept/decline (conditional-claim grant)

**Files:** modify `lib/linkRequest.ts`, `routes/linkRequests.ts`, `lib/subscriptionEnforcement.ts`; test `linkRequests.accept.test.ts`.

**Produces:** `GET /pending`, `POST /:id/accept`, `POST /:id/decline`; `canConsentMembership`, `claimAndAcceptMembership` (conditional-claim tx), `serializeInboxRequest`, `applySeatIncrement`.

- [ ] **Step 1: Failing tests** — grant with default `["MEMBER"]`; **initiating admin can't self-accept** (403) unless direction=JOIN (where the family admin IS the counterparty); guardian accept (ADULT, non-suspended) sets `consentedByPersonId`; **seat applied at accept only when `seatAuthorizedByRequester`**; **concurrent double-accept → exactly one membership** (fire two accepts, assert count 1); **accept-vs-decline race → terminal state consistent** (grant iff status ended ACCEPTED); expired PENDING → 409 + persisted EXPIRED without clobbering a concurrent accept; **already-resolved request returns current state only to an authorized counterparty, 403 to others**; inbox returns names-only (no ids/token) and is **DB-scoped** (a foreign tenant's unrelated PENDING requests never appear and are never mutated on read).

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Extract `applySeatIncrement({ familyGroupId })` into `subscriptionEnforcement.ts` (the Stripe seat-increment side effect, verbatim from families.ts — DRY).
- [ ] **Step 4: Implement expiry-safe claim, counterparty auth, and the grant tx** in `lib/linkRequest.ts`:

```typescript
import { hasAdminRole } from "./familyAccess";
import { applySeatIncrement } from "./subscriptionEnforcement";

/** Conditional expiry: never clobbers a concurrently-resolved row. Returns the fresh row. */
export async function resolveExpiry(r: LinkRequest): Promise<LinkRequest> {
  if (r.status !== "PENDING" || r.expiresAt.getTime() >= Date.now()) return r;
  await db.linkRequest.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "EXPIRED", resolvedAt: new Date() } });
  return (await db.linkRequest.findUnique({ where: { id: r.id } }))!;
}

/** §6.3 membership matrix. PULL: active adult → self; minor → ADULT non-suspended admin of a family the minor
 *  belongs to, or (family-less minor) the ADULT `guardianPersonId`. JOIN: any admin of the target family.
 *  Requester may consent only if they ALSO hold the counterparty authority (dual-authority exception). */
export async function canConsentMembership(r: LinkRequest, person: { id: string }): Promise<boolean> {
  if (r.kind !== "FAMILY_MEMBERSHIP" || !r.targetPersonId) return false;
  if (r.direction === "JOIN") {
    const m = await activeFamilyMembership(r.familyGroupId, person.id);
    return Boolean(m && hasAdminRole(m)); // accepting-family admin; requester(applicant) isn't an admin here so no self-accept
  }
  const target = await db.person.findUnique({ where: { id: r.targetPersonId } });
  if (!target) return false;
  if (isAdultLevel(target.ageGateLevel)) {
    if (person.id === r.requestedByPersonId && person.id !== target.id) return false; // pure requester can't self-accept
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

/** Grant inside a conditional claim. Returns true if THIS call performed the grant. Idempotent. */
export async function claimAndAcceptMembership(r: LinkRequest, consentedByPersonId: string, channel: ConsentChannel): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const claim = await tx.linkRequest.updateMany({ where: { id: r.id, status: "PENDING" },
      data: { status: "ACCEPTED", consentedByPersonId, consentChannel: channel, resolvedAt: new Date() } });
    if (claim.count === 0) return false; // someone else resolved it — no double grant
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
        await tx.linkRequest.update({ where: { id: r.id }, data: { carryInSkipped: true } }); // [R2] record, don't silently skip
      }
    }
    return true;
  });
}
```

- [ ] **Step 5: Implement routes** — order `GET /pending` before `/:id`. `accept`: load raw → `resolveExpiry` → **`canConsent*` FIRST** (403 if not) → if terminal, return current state (idempotent) → else `claimAndAcceptMembership`; **after** a successful grant, if `r.seatAuthorizedByRequester` (PULL) or (JOIN) the accepting admin confirms, call `applySeatIncrement` (outside the tx — Stripe is external; the conditional claim guarantees single execution). `decline`: authz-first, conditional claim to DECLINED, idempotent. `GET /pending`: **DB-scoped** query — `status:"PENDING", expiresAt:{gt:now}`, and `OR: [{ targetPersonId: requester.id }, { AND:[{ direction:"JOIN" }, { familyGroupId: { in: <families requester admins> } }] }, { <minor requests where requester is an admin of the minor's family> }]` — then `canConsent*`-filter the small result set; serialize with `serializeInboxRequest` (names only). **Never** `resolveExpiry`-mutate rows during an inbox read (filter expired out in SQL). **[R2 — MAJOR/BLOCKER: global scan + foreign-row mutation + id leak.]**

```typescript
export async function serializeInboxRequest(r: LinkRequest): Promise<{ id:string; kind:string; direction:string; requestingFamilyName:string; carryHouseholdName:string|null; notice:string }> {
  const fam = await db.familyGroup.findUnique({ where: { id: r.familyGroupId }, select: { name: true } });
  const carry = r.carryHouseholdId ? await db.household.findUnique({ where: { id: r.carryHouseholdId }, select: { name: true } }) : null;
  return { id: r.id, kind: r.kind, direction: r.direction,
    requestingFamilyName: fam?.name ?? "A family",
    carryHouseholdName: carry?.name ?? null, // [R2] carry-in disclosed to the target
    notice: "Accepting adds you to this family. Linked families' admins can edit shared household details." };
}
```

- [ ] **Step 6:** Run → PASS (incl. concurrency tests).
- [ ] **Step 7:** Commit `feat: P3-04 inbox (names-only, scoped) + accept/decline (conditional-claim grant, seat at accept)`.

---

### Task 5: Passive token delivery (normalized contacts, single channel) + public consent page (token not logged)

**Files:** real `lib/consentDelivery.ts`; create `routes/consent.ts`; modify `index.ts`, `middleware/requestLogger.ts`; tests `consentDelivery.test.ts`, `consent.page.test.ts`.

- [ ] **Step 1: Failing tests** — delivery names family only (no roster), SMS budgeted+footer ≤320; **delivers to normalized contact when raw is null** (CIF case); **single channel** (both contacts present → sent on ONE, `tokenChannel` recorded, not both); consent page view (names only, 410 on expiry, no token echo); accept **verifies only `tokenChannel`'s contact** (phone-delivered → `phoneVerifiedAt` set, `emailVerifiedAt` untouched); single-use (2nd accept 409); **token never appears in Morgan output** (assert the masked log line).

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement `consentDelivery.ts`** — read normalized fields, pick one channel deterministically (prefer SMS if a phone exists, else email), record `tokenChannel`, deliver only there, honor suppression, log request id (never token):

```typescript
import type { LinkRequest } from "@famlink/db";
import { db } from "@famlink/db";
import { env } from "./env";
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
  const channel: "SMS" | "EMAIL" | null = phone ? "SMS" : email ? "EMAIL" : null;
  if (!channel) return;
  await db.linkRequest.update({ where: { id: args.request.id }, data: { tokenChannel: channel } });
  const consentUrl = `${env.WEB_APP_URL.replace(/\/$/,"")}/consent/${args.request.token}`;
  const m = buildConsentMessage({ familyName: family.name, consentUrl });
  const notifier = new NotificationService();
  await notifier.sendGuestInvitation({ invitationId: args.request.id, // log carries request id, NOT token
    email: channel === "EMAIL" ? email : null, phone: channel === "SMS" ? phone : null,
    message: { subject: m.subject, body: m.body, smsBody: m.smsBody } });
}
```

- [ ] **Step 4: Implement `routes/consent.ts`** (public, rate-limited) — GET view (`resolveExpiry`→410 on EXPIRED; names only), POST accept: authz is possession of the token; conditional-claim grant + verify only `tokenChannel`'s contact, all in one tx (reuse `claimAndAcceptMembership` then verify, or inline the verify inside a wrapping tx). Single-use falls out of the conditional claim (2nd call → count 0 → 409 with current state).
- [ ] **Step 5: Mask the token in the request logger** — in `requestLogger.ts`, add a Morgan `url` token override (or `skip`/custom format) that rewrites any path matching `^/api/v1/consent/[^/]+` to `/api/v1/consent/[redacted]` before logging. **[R2 — BLOCKER #7.]**
- [ ] **Step 6:** Mount `consentRouter` at `/api/v1/consent` (public) in `index.ts`.
- [ ] **Step 7:** Run → PASS.
- [ ] **Step 8:** Commit `feat: P3-04 passive token delivery (normalized, single-channel) + consent page (token redacted in logs)`.

---

### Task 6: Guardian + attestation enforcement (regression lock)

**Files:** test-focused: `lib/__tests__/linkRequest.guardian.test.ts` (+ tighten `createMembershipRequest`/`canConsentMembership` if a test reveals a gap).

- [ ] **Step 1: Failing/locking tests** — minor WITH contact gets **no token** (guardian in-app); a **non-ADULT** or **suspended** would-be guardian → `canConsentMembership` false; family-less minor consented only by the ADULT `guardianPersonId`; DOB-unknown passive without attestation refused (already in Task 3 — assert here too for the matrix).
- [ ] **Step 2:** Run → the minor-no-token + adult/suspended guardian tests drive any remaining tightening in Task 4's `canConsentMembership` (it already checks `isAdultLevel(actor)` + `suspendedAt: null`; confirm and add tests).
- [ ] **Step 3:** Run → PASS.
- [ ] **Step 4:** Commit `test: P3-04 guardian ADULT/non-suspended + minor-no-token + attestation matrix`.

---

### Task 7: Household link requests — PULL + JOIN, visibility precondition, lock-revalidated authz, carry disclosure

**Files:** modify `lib/linkRequest.ts`, `routes/linkRequests.ts`; test `linkRequests.household.test.ts`.

**Produces:** `createHouseholdLinkRequest` (PULL requires initiating-family visibility of H via a resident-member; JOIN does not), `canConsentHousehold`, `claimAndAcceptHousehold` (authz + pending re-validated **under** the `FOR UPDATE` lock; dual-authority allowed; correct audit attribution).

- [ ] **Step 1: Failing tests** — PULL accept creates `HouseholdFamily` + `LINKED` audit with `actorFamilyGroupId` = **the consenter's** currently-linked family (not the initiating family); **PULL requires the initiating family to see H via a resident-member** (else 403/400 at create); JOIN accept works with no such precondition; **counterparty unlinks before accept → accept fails under the lock** (authz re-checked in-tx); **dual-authority**: an admin of both the initiating family and a family linked to H may accept; double-accept idempotent (one link); duplicate-pending rejected (partial index).

- [ ] **Step 2:** Run → FAIL (501).
- [ ] **Step 3: Implement** `createHouseholdLinkRequest` + `canConsentHousehold` + `claimAndAcceptHousehold`:

```typescript
import { writeHouseholdAudit } from "./householdAccess";

export async function createHouseholdLinkRequest(params: {
  familyGroupId: string; requester: { id: string }; targetHouseholdId: string; direction: LinkRequestDirection;
}): Promise<LinkRequest> {
  // PULL precondition: the initiating family must SEE H via a resident who is a member of it. [R2 BLOCKER #10]
  if (params.direction === "PULL") {
    const sees = await db.householdMember.findFirst({ where: { householdId: params.targetHouseholdId,
      person: { familyMemberships: { some: { familyGroupId: params.familyGroupId, suspendedAt: null } } } } });
    if (!sees) throw new HouseholdNotVisible();
  }
  const already = await db.householdFamily.findUnique({ where: { householdId_familyGroupId: {
    householdId: params.targetHouseholdId, familyGroupId: params.familyGroupId } } });
  if (already) throw new RequestAlreadyPending();
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
export class HouseholdNotVisible extends Error {}

/** Counterparty = admin of a family CURRENTLY linked to H. Dual-authority allowed (requester may also qualify). */
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

export async function claimAndAcceptHousehold(r: LinkRequest, consenter: { id: string }): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Household" WHERE "id" = ${r.targetHouseholdId} FOR UPDATE`;
    // Re-validate authority AND pending status UNDER the lock. [R2 BLOCKER #11]
    const stillAdmin = await tx.familyMember.findFirst({ where: { personId: consenter.id, suspendedAt: null,
      familyGroup: { householdLinks: { some: { householdId: r.targetHouseholdId! } } }, roles: { has: "ADMIN" } } });
    if (!stillAdmin) return false;
    const claim = await tx.linkRequest.updateMany({ where: { id: r.id, status: "PENDING" },
      data: { status: "ACCEPTED", consentedByPersonId: consenter.id, consentChannel: "IN_APP", resolvedAt: new Date() } });
    if (claim.count === 0) return false;
    const existing = await tx.householdFamily.findUnique({ where: { householdId_familyGroupId: {
      householdId: r.targetHouseholdId!, familyGroupId: r.familyGroupId } } });
    if (!existing) {
      await tx.householdFamily.create({ data: { householdId: r.targetHouseholdId!, familyGroupId: r.familyGroupId, linkedByPersonId: consenter.id } });
      await writeHouseholdAudit(tx, { householdId: r.targetHouseholdId!, actorPersonId: consenter.id,
        actorFamilyGroupId: stillAdmin.familyGroupId, action: "LINKED" }); // [R2 MAJOR] consenter's family, not initiator's
    }
    return true;
  });
}
```

- [ ] **Step 4:** Wire the `HOUSEHOLD_LINK` create branch + accept/decline dispatch on `r.kind`; extend `GET /pending` to include household requests via `householdConsentFamily`; map `HouseholdNotVisible`→403. Serialize household inbox rows with `serializeInboxRequest` (add `targetHouseholdName` names-only).
- [ ] **Step 5:** Run → PASS (incl. lock-revalidation + dual-authority).
- [ ] **Step 6:** Commit `feat: P3-04 household link requests (PULL+JOIN, visibility precondition, lock-revalidated authz)`.

---

### Task 8: Reroute direct member-add + provenance gate + caller audit

**Files:** modify `routes/families.ts`; test `families.members.reroute.test.ts`. **Also audit web callers.**

**Produces:** direct-add gated to **provably-authored data-entry** targets; add-time seat branch deleted.

- [ ] **Step 1: Audit every direct-add caller** (do this first, it shapes the test fixtures):

Run: `git grep -n "families/.*/members\|/members'" apps/web apps/mobile apps/api` and inspect `apps/web/app/onboarding/steps/InviteStep.tsx`. **[R2 — BLOCKER #1.]** Record findings in the task notes. Expected: onboarding creates a brand-new passive person (in no other family) → still passes the provenance gate; any caller that passes contact must move to the link-request flow (a PR-3 web change — note it, don't silently break: the API returns `CONSENT_REQUIRED` with a hint so PR-3 can adapt).

- [ ] **Step 2: Failing tests** — passive+no-contact+**not a member of any other family** → 201 (data entry); passive+no-contact but **already a member of another family** (foreign authored record) → 409 `CONSENT_REQUIRED` (no FamilyMember created) **[R2 — BLOCKER #2 provenance hole]**; active-account target → 409; passive+contact target → 409.

- [ ] **Step 3: Implement the guard** — after target lookup, classify + provenance-check; **delete** the `if (targetPerson.userId) { ...seat + Stripe... }` block:

```typescript
import { classifyMembershipTarget } from "../lib/linkRequest";
// ...
const cls = await classifyMembershipTarget({ personId: body.data.personId });
const otherFamilyCount = await db.familyMember.count({
  where: { personId: body.data.personId, familyGroupId: { not: familyId } } });
if (cls.kind !== "DATA_ENTRY" || otherFamilyCount > 0) {
  res.status(409).json({ error: "CONSENT_REQUIRED",
    hint: "This person has an account, contact details, or belongs to another family — send a link request they can accept.",
    linkRequest: { endpoint: "/api/v1/link-requests", kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: familyId, targetPersonId: body.data.personId } });
  return;
}
// seat-billing branch removed — billing is authorized at link-request create + applied at accept (Tasks 3/4).
```

- [ ] **Step 4:** Update existing families member tests that added active/contact/foreign targets directly; run `npm test --workspace=@famlink/api -- families` → PASS.
- [ ] **Step 5:** Prune orphaned imports (`stripe`/`checkSeatExpansion`) **only if** no other handler in `families.ts` uses them (grep first). `npm run lint --workspace=@famlink/api` → 0 errors.
- [ ] **Step 6:** Commit `feat: P3-04 gate direct member-add to provably-authored data-entry; seat billing moves to accept`.

---

### Task 9: HOUSEHOLD-scope event-invite escalation (reuse W3a path, gated, no id leak)

**Files:** modify `routes/events.ts`; test `events.household-invite.test.ts`.

**Produces:** a `{ kind: "household", householdId }` invitee that expands to: event-family members → `EventInvitation`; non-member residents **with an account** → W3a `famlinkUser` invitation (`EventInvitation` + `linkedPersonId` + role + token; accept grants the `EventParticipant`); non-member residents **contact-only, no account** → guest `EventInvitation` (guest path, they can't authenticate); passive/minor with no reachable consent → **skipped, surfaced by display name + reason** (never a foreign id).

- [ ] **Step 1: Failing tests** — member resident → `EventInvitation`; non-member active resident → `EventInvitation` with `linkedPersonId`+role (NOT an `EventParticipant` yet — visibility only after accept) **[R2 — BLOCKER #13]**; non-member contact-only resident → guest `EventInvitation`; passive/minor non-member → `skipped:[{displayName, reason}]` with **no personId** **[R2 — BLOCKER #14 id leak]**; **household-access gate**: an organizer whose family isn't linked to the household → 403; **event-admin gate**: expansion that produces cross-family invitees requires event-admin access (extend the existing check that today only detects explicit `famlinkUser` invitees).

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — add `{ kind:"household", householdId }` to `InviteeSchema`; **before** the loop, gate: (a) the household must be linked to the event's family (`householdFamily` where `householdId` + `familyGroupId = event.familyGroupId`) or the organizer must otherwise have household access → else 403; (b) if any household will expand to non-member residents, require `resolveEventAccess(...).canAdmin` (reuse the existing cross-family gate, widened to household expansion). In the loop, per resident: event-family member → `EventInvitation` (scope HOUSEHOLD); non-member with `userId` → `famlinkUser` `EventInvitation` (push to `famlinkUserInvites`); non-member contact-only (no `userId`, has contact) → guest `EventInvitation` + `guestInvites`; else → `skipped.push({ displayName, reason: minor ? "MINOR_NON_MEMBER" : "NO_CONTACT" })`. **Never** create an `EventParticipant` directly (no invented status). Reuse the existing famlinkUser/guest notification dispatch already in this handler.
- [ ] **Step 4:** Return `{ invitations: createdInvitations, skipped }` (skipped = display names + reasons only).
- [ ] **Step 5:** Run → PASS (+ no regression in existing invite tests).
- [ ] **Step 6:** Commit `feat: P3-04 HOUSEHOLD-scope invite escalation (W3a path reuse, access+admin gated, name-only skips)`.

---

### Task 10: CIF `mergePersons` learns `LinkRequest` person columns

**Files:** modify `apps/api/src/lib/personIdentity.ts`; test `lib/__tests__/personIdentity.linkRequest.test.ts`.

**Produces:** `mergePersons` repoints `LinkRequest.targetPersonId`, `requestedByPersonId`, `consentedByPersonId` from the merged (losing) person to the surviving person. **[R2 — BLOCKER #15.]**

- [ ] **Step 1: Failing test** — create a PENDING request targeting a passive person; merge that person into an account; assert the request's `targetPersonId` now points at the survivor and is still resolvable (not orphaned).

```typescript
it("mergePersons repoints LinkRequest.targetPersonId to the survivor", async () => {
  // seed passive target + a survivor account, a PENDING request at the passive id, then merge
  await mergePersons({ survivingPersonId: survivor.id, mergedPersonId: passive.id });
  const req = await db.linkRequest.findUnique({ where: { id: reqId } });
  expect(req!.targetPersonId).toBe(survivor.id);
});
```

- [ ] **Step 2:** Run → FAIL (column not repointed).
- [ ] **Step 3: Implement** — add `LinkRequest` to the logical-person-column repointing in `mergePersons` (the same mechanism that already repoints logical no-FK columns like `HouseholdAuditEntry.actorPersonId`): update `LinkRequest` rows where `targetPersonId`/`requestedByPersonId`/`consentedByPersonId` = merged id → survivor id. If a repoint would collide with the partial-unique pending index (both persons had a pending request to the same family), resolve deterministically (keep the older PENDING, mark the other `CANCELLED`) — add that to the test.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: P3-04 mergePersons repoints LinkRequest person columns (no orphaned consent)`.

---

### Task 11: Isolation + concurrency regression pack

**Files:** create `routes/__tests__/linkRequests.isolation.test.ts`, `routes/__tests__/linkRequests.concurrency.test.ts`. Test-only (any failure = a real leak/race → fix the owning task's production file).

- [ ] **Step 1: Isolation pack** — inv1 (inbox + consent page carry family/household **names** only; assert absence of every foreign id + roster + token in the JSON); inv4 (token never in Morgan output — capture the actual logger line, assert `[redacted]`; **not** a `console.info` spy) **[R2 — BLOCKER #7]**; inv5 (only a matrix counterparty accepts; foreign → 403 **before** any payload); row-existence (no `FamilyMember`/`HouseholdFamily` while PENDING); escalation `skipped[]` has no `personId`.

- [ ] **Step 2: Concurrency pack** **[R2 — MAJOR: races untested]** — concurrent double-accept (membership + household) → exactly one grant; concurrent link-vs-unlink on a household → min-1 holds, no tenantless household; concurrent duplicate-create → one row (partial index); accept-vs-decline → terminal state and grant agree; a Stripe-throwing `applySeatIncrement` after a committed grant → membership persists, error surfaced, no double claim.

```typescript
it("two simultaneous accepts create exactly one membership", async () => {
  const [a, b] = await Promise.all([
    asPerson(targetId).post(`/api/v1/link-requests/${reqId}/accept`).send({}),
    asPerson(targetId).post(`/api/v1/link-requests/${reqId}/accept`).send({}) ]);
  expect([a.status, b.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
  expect(await db.familyMember.count({ where: { familyGroupId, personId: targetId } })).toBe(1);
});
```

- [ ] **Step 3: Release gate** — `npm test --workspace=@famlink/api && npm run type-check && npm run lint` → API green (≥524 + new), type-check 6/6, lint 0.
- [ ] **Step 4:** GitNexus `detect_changes({ scope:"compare", base_ref:"main" })`; cross-check `git diff --stat` (worktree new-file gotcha). Affected surface should be the LinkRequest files + `families.ts`/`events.ts`/`subscriptionEnforcement.ts`/`personIdentity.ts`/`requestLogger.ts` + schema.
- [ ] **Step 5:** Commit `test: P3-04 W1 PR-2 isolation + concurrency regression pack`.

---

## Self-Review (against spec + R2 findings)

**Spec coverage:** §3.2 model → T1; §2 dec-8 gate → T2/T3/T8; §6.2 create (membership PULL+JOIN, household PULL+JOIN) → T3/T7; inbox+accept/decline → T4; passive token + `/consent` + contact verify → T5; §6.3 matrix + guardian + minor-no-token + attestation → T3/T4/T6; carry-in (disclose + record skip) → T4; §2 dec-3 / inv-3 escalation → T9; FOR-UPDATE on link create → T7; §11 attestation → T3; CIF merge → T10; isolation/concurrency → T11. ✅

**Every accepted BLOCKER mapped:** #1 onboarding caller→T8.1; #2 provenance→T8; #3 seat authority→T3(create)+T4(apply); #4 race-safe→T4/T7 conditional-claim; #5 expiry/idempotency+DB-constraint→T1(index)/T4(resolveExpiry+authz-first); #6 inbox id leak→T4 `serializeInboxRequest`; #7 token in logs→T5(mask)+T11(assert); #8 delivery/verify→T2/T5(normalized+single-channel); #9 attestation/guardian→T3/T6; #10 JOIN+PULL-visibility→T3/T7; #11 lock-revalidated authz + dual-authority→T7; #12 carry-in disclose/record→T4; #13 W3a participant status→T9; #14 escalation gates + id leak→T9; #15 CIF merge→T10. MAJORs: scoped inbox→T4; audit attribution→T7; delivery-state (surfaced via `tokenChannel`/logs; full delivery-status model deferred — note); schema shapes→T3; race tests→T11.

**Deferred (name in review brief):** web/mobile consent inbox + `/consent` page → PR 3/PR 4; delivery-failure retry/status model (only best-effort + `tokenChannel` recorded here); PR-3 must update `InviteStep.tsx` to pass contact + use link-request (API returns `CONSENT_REQUIRED` hint so it can).

## Council round-2 focus

1. Does the conditional-claim (`updateMany where status=PENDING`) fully serialize every accept path (membership, household, token page) with the grant in the *same* tx?
2. Is `applySeatIncrement` ever reachable more than once per request, or on a request whose grant didn't happen?
3. Any remaining serializer that emits a foreign id/roster/token (inbox, consent page, escalation `skipped`, error payloads)?
4. Household accept: is authority + pending status truly re-checked *inside* the `FOR UPDATE` tx, and is the audit `actorFamilyGroupId` the consenter's family?
5. Does the direct-add provenance rule (`DATA_ENTRY` + not-a-member-of-another-family) actually close the foreign-passive-attach hole without breaking onboarding?
6. Escalation: does it ever create an `EventParticipant` pre-accept, or invite a resident the organizer shouldn't reach?
