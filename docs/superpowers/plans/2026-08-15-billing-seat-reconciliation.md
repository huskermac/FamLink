# Billing — Usage-Based Seat Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove seat billing from the member-add path. The system adds a member with no inline Stripe call and no seat gate. Coverage starts immediately and has no cap. The daily cron sets the family's Stripe seat quantity from the true active-member count.

**Architecture:** Coverage in `entitlements.ts` no longer uses the `take: seatCount` cap. It keys only on paid, entitling membership. This slice removes the 402 seat-confirm gate and its inline Stripe call from `POST /families/:familyId/members`. A new idempotent function `reconcileSeats(familyGroupId)` sets the absolute Stripe seat quantity from the headcount. A new daily pass runs it for every entitling family. This slice also removes seat-based member suspension and the downgrade-grace machinery. No membership change bills Stripe at the time of the change.

**Tech Stack:** TypeScript, Express, Prisma 7.7 (`@famlink/db`), Stripe SDK (mocked in tests with `vi.hoisted`), Vitest against a real Postgres test DB, `node-cron`.

**Spec:** `docs/superpowers/specs/2026-08-07-billing-seat-reconciliation-design.md` (W1 spec §2 decision 10 slice).

## Global Constraints

- **Package:** All code is in `apps/api` (`@famlink/api`). Every task runs this verification from the repo root: `npm run type-check`, `npm run lint` (0 errors; 34 known warnings are OK), and the API suite `npm test --workspace=@famlink/api`.
- **`proration_behavior: "create_prorations"`** on every Stripe seat-quantity change (spec §5. **Steve chose proration on 2026-08-15**). A mid-cycle seat change makes a proration adjustment. A member added mid-cycle makes a charge. A member removed mid-cycle makes a credit. The adjustment settles on the **next invoice** as arrears. The system makes no immediate out-of-cycle charge. Do **not** use `"none"`.
- **Stripe is the source of truth** for billed seat quantity (decision 2026-06-10).
- **`seatCount` means the true active-member headcount** (spec §5 — `reconcileSeats` writes `activeCount`). After this slice `seatCount` is **display-only**. The only readers that remain are `GET /billing/subscription` and the read-only `seat-impact` preview. Tasks 1–5 remove every correctness reader. The `customer.subscription.updated` webhook is a Stripe backstop that writes `includedSeats + billedQty`. Below the included allowance this value can differ from the headcount for a short time. The next daily reconciliation pass corrects it. Task 3 must **update the schema comment** at `packages/db/prisma/schema.prisma:358-359`, which still says "seatCount … is always the TOTAL allowance". *(This resolves an ambiguity in the spec. Decision 2 calls `seatCount` the "billing quantity". §5 writes `activeCount`. Headcount is the chosen meaning.)*
- **Coverage is derived live, never materialized.**
- **Entitling** := `status ∈ {ACTIVE, TRIALING}` AND `pricingTier.stripePriceId != null` (the free tier never entitles and never bills).
- **Active member** (for billing and headcount) := a `FamilyMember` with `suspendedAt == null` AND `person.userId != null`. A passive or no-account person never affects billing.
- **No destructive migration.** Keep `FamilySubscription.pendingDowngradeTierKey`, `pendingDowngradeSeatCount`, `downgradeGraceEndsAt`, and `PricingTier.activeUserLimit` as dormant columns (marked deprecated). This slice makes no schema change.
- **Do not change the AI daily-limit constants or the foreign-context logic** (`AI_DAILY_LIMIT_*`, the `getAiEntitlementForUser` shape).

## Spec-vs-code reconciliation (read before starting)

The spec names two things that do not exist in the code word-for-word. The intent maps to the real code as follows:
- Spec §8 "manual `expandSeats` endpoint" — **no such mutation exists.** The nearest is the read-only preview `POST /api/v1/billing/seat-impact` (a quote endpoint). It becomes unused, but it is harmless and read-only. **Leave it in place. It is out of scope.**
- Spec §4/§8 "the tier-downgrade billing endpoint stops writing `pendingDowngrade*`" — that write is in the **`customer.subscription.updated` webhook handler** in `apps/api/src/routes/billing.ts`, not a REST endpoint. Task 5 changes it there.
- `AddMemberSchema.confirmSeatExpansion` (`families.ts:53`) — becomes unread after Task 2. **Keep the field in the schema.** The code accepts it and ignores it. A web or mobile client that still sends `confirmSeatExpansion: true` must not get a 400. Do not remove the field in this slice.

---

### Task 1: Remove the seat cap from coverage

**Files:**
- Modify: `apps/api/src/lib/entitlements.ts:19-40` (`isPersonCoveredByFamily`), and the header doc comment `:1-9`.
- Test: `apps/api/src/lib/__tests__/entitlements.test.ts`

**Interfaces:**
- Consumes: `db` from `@famlink/db`; `ENTITLING_STATUSES` (already in the file).
- Produces: `isPersonCoveredByFamily(personId, familyGroupId): Promise<boolean>` — unchanged signature, new semantics: true iff the family's sub is entitling AND the person is an active (`suspendedAt == null`) `FamilyMember` of it. No seat ordering, no cap. `isPersonCovered`, `getAiDailyLimit*`, `getAiEntitlementForUser` inherit the new definition unchanged.

- [ ] **Step 1: Update the failing tests first**

In `entitlements.test.ts`, three existing tests assert the now-removed cap and must be rewritten (the RED signal for this change):

Replace the test at `:62-75` ("excludes members beyond seatCount…") with:

```typescript
  it("covers ALL active members of a paid family regardless of seatCount (no cap)", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id); // admin joins first
    await paidTier("SOLO");
    await subscribe(familyGroup.id, "SOLO", 1); // seatCount=1 must NOT cap coverage
    const late = await db.person.create({
      data: { firstName: "Late", lastName: "Joiner", ageGateLevel: "ADULT", userId: null }
    });
    await db.familyMember.create({
      data: { familyGroupId: familyGroup.id, personId: late.id, roles: [], permissions: [] }
    });
    expect(await isPersonCovered(admin.id)).toBe(true);
    expect(await isPersonCovered(late.id)).toBe(true);
  });
```

Replace the test at `:143-152` ("is false for a member beyond seatCount…") with:

```typescript
  it("covers a member beyond the old seatCount boundary (cap removed)", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    await paidTier("SOLO", 1);
    await subscribe(familyGroup.id, "SOLO", 1);
    const late = await db.person.create({ data: { firstName: "Late", lastName: "J", ageGateLevel: "ADULT", userId: null } });
    await db.familyMember.create({ data: { familyGroupId: familyGroup.id, personId: late.id, roles: [], permissions: [] } });
    expect(await isPersonCoveredByFamily(late.id, familyGroup.id)).toBe(true);
    expect(await isPersonCoveredByFamily(admin.id, familyGroup.id)).toBe(true);
  });
```

Replace the test at `:86-104` ("skips a suspended early-joined member so the next active member is covered") with a plain suspension test (no seat-fallthrough premise):

```typescript
  it("covers the non-suspended member and not the suspended one (both on a 1-seat sub)", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    await paidTier("SOLO");
    await subscribe(familyGroup.id, "SOLO", 1);
    const next = await db.person.create({
      data: { firstName: "Next", lastName: "Member", ageGateLevel: "ADULT", userId: null }
    });
    await db.familyMember.create({
      data: { familyGroupId: familyGroup.id, personId: next.id, roles: [], permissions: [] }
    });
    await db.familyMember.update({
      where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: admin.id } },
      data: { suspendedAt: new Date() }
    });
    expect(await isPersonCovered(admin.id)).toBe(false);
    expect(await isPersonCovered(next.id)).toBe(true);
  });
```

Leave every other test's **assertions** unchanged (free-tier-false, PAST_DUE-false, TRIALING-true, suspended-false, not-a-member-false, OR-coverage, the `getAiDailyLimit`/`getAiEntitlementForUser` blocks all still hold). **Rename** the two whose titles describe the retired cap so they no longer imply a seat boundary: `:38` "is true for a member of a paid ACTIVE family within seatCount" → "… of a paid ACTIVE family"; `:119` "is true for a paid family where the person is within seats" → "is true for an active member of a paid family". Assertions stay as written.

- [ ] **Step 2: Run the tests to verify the cap-exercising ones fail**

Run: `npm test --workspace=@famlink/api -- entitlements`
Expected: the **two cap-exercising tests FAIL** under old code — "covers ALL active members … (no cap)" (old code caps at `take: seatCount`, so `late` reads uncovered) and "covers a member beyond the old seatCount boundary" (same reason). The third rewritten test ("covers the non-suspended member and not the suspended one") **already passes under old code** — it is a kept regression, not a RED signal; do not expect it to fail. This is why the change is safe: it only widens coverage for members the cap previously excluded.

- [ ] **Step 3: Remove the cap in `isPersonCoveredByFamily`**

Replace the body at `apps/api/src/lib/entitlements.ts:19-40` with:

```typescript
export async function isPersonCoveredByFamily(
  personId: string,
  familyGroupId: string
): Promise<boolean> {
  const sub = await db.familySubscription.findUnique({
    where: { familyGroupId },
    select: { status: true, pricingTier: { select: { stripePriceId: true } } }
  });
  if (!sub) return false;
  if (!ENTITLING_STATUSES.has(sub.status)) return false;
  if (sub.pricingTier.stripePriceId === null) return false; // free tier never covers

  const membership = await db.familyMember.findFirst({
    where: { familyGroupId, personId, suspendedAt: null },
    select: { id: true }
  });
  return membership !== null;
}
```

Update the file header comment `:1-9` to describe the new rule (drop the "AND they fall within that family's seatCount" clause):

```typescript
/**
 * AI entitlement resolver (P3-02 / W2; seat cap removed 2026-08-15, decision 10).
 *
 * Coverage is derived live on every call — never materialized. A person is
 * "covered" iff they are an active (non-suspended) member of at least one family
 * whose subscription is entitling (ACTIVE | TRIALING) AND on a paid tier
 * (PricingTier.stripePriceId !== null). There is no per-seat cap: seatCount is the
 * family's active-member headcount (reconciled by the daily cron), not a coverage limit.
 */
```

- [ ] **Step 4: Run the entitlements suite, type-check, and lint**

Run: `npm test --workspace=@famlink/api -- entitlements && npm run type-check && npm run lint`
Expected: entitlements PASS (all describe blocks), type-check 6/6 clean, lint 0 errors (≤34 pre-existing warnings). *(Per-task boundary rule — every task ends with type-check + lint green, not just filtered tests.)*

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/entitlements.ts apps/api/src/lib/__tests__/entitlements.test.ts
git commit -m "feat: P3-04 billing — cap-free coverage (drop take:seatCount from isPersonCoveredByFamily)"
```

---

### Task 2: Remove the 402 seat gate + inline Stripe call from member-add

**Files:**
- Modify: `apps/api/src/routes/families.ts` — delete `:15` (`checkSeatExpansion` import), `:16` (`stripe` import, unused after this task), and the seat-enforcement block `:181-234`.
- Test: `apps/api/src/__tests__/routes/families.test.ts:147-243` (the "seat enforcement" describe).

**Interfaces:**
- Consumes: nothing new.
- Produces: `POST /:familyId/members` creates the member subject only to existing authz + P2002 duplicate handling; no billing side effects, no Stripe call.

- [ ] **Step 1: Rewrite the seat-enforcement test block to assert no billing side effects**

Replace the entire `describe("POST /api/v1/families/:familyId/members — seat enforcement", …)` block at `families.test.ts:147-243` with a block that proves the member is added with no 402 and no Stripe call:

```typescript
  describe("POST /api/v1/families/:familyId/members — no inline billing", () => {
    it("adds an active member with no 402 gate and no Stripe call, even at the seat boundary", async () => {
      const admin = await seedTestPerson({ userId: "clerk_admin_nb" });
      const { familyGroup } = await seedTestFamily(admin.id);
      // activeUserLimit finite + activeCount(1 admin) == seatCount(1) => OLD code
      // returns 402 without confirmSeatExpansion. That is the RED signal; new code
      // must return 201 and never touch Stripe.
      await db.pricingTier.create({
        data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, includedSeats: 1, activeUserLimit: 1, stripePriceId: "price_base", stripeSeatPriceId: "price_seat" }
      });
      await db.familySubscription.create({
        data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 1, stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test", status: "ACTIVE" }
      });
      const second = await seedTestPerson({ userId: "clerk_second_nb" });

      mockGetAuth.mockReturnValue({ userId: "clerk_admin_nb" });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/members`)
        .send({ personId: second.id, roles: ["MEMBER"], permissions: [] });

      expect(res.status).toBe(201);
      expect(res.body.personId).toBe(second.id);
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
      expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
      // seatCount is NOT bumped inline — the daily cron reconciles it.
      const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
      expect(sub?.seatCount).toBe(1);
    });

    it("still accepts a legacy confirmSeatExpansion flag without error (field is vestigial)", async () => {
      const admin = await seedTestPerson({ userId: "clerk_admin_legacy" });
      const { familyGroup } = await seedTestFamily(admin.id);
      const second = await seedTestPerson({ userId: "clerk_second_legacy" });
      mockGetAuth.mockReturnValue({ userId: "clerk_admin_legacy" });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/members`)
        .send({ personId: second.id, roles: ["MEMBER"], permissions: [], confirmSeatExpansion: true });
      expect(res.status).toBe(201);
    });
  });
```

> NOTE for the implementer: match the existing file's auth-mock helper. If the file uses a different name than `mockGetAuth` (look at the top of `families.test.ts`), use that name. The `mockStripe` hoisted mock already exists at `families.test.ts:21`.

- [ ] **Step 2: Run the test to verify the new assertion fails**

Run: `npm test --workspace=@famlink/api -- families`
Expected: the "no 402 gate and no Stripe call" test FAILS under old code — it returns **402** (finite `activeUserLimit`, `activeCount == seatCount`, no `confirmSeatExpansion`). (The legacy-`confirmSeatExpansion` test passes under both old and new code — it is a back-compat guard, not a RED signal.)

- [ ] **Step 3: Delete the seat-enforcement block and now-unused imports**

In `apps/api/src/routes/families.ts`, delete the two imports:

```typescript
// DELETE line 15:
import { checkSeatExpansion } from "../lib/subscriptionEnforcement";
// DELETE line 16:
import { stripe } from "../lib/stripeClient";
```

Then delete the whole seat-enforcement block `:181-234` — everything from the `// Seat enforcement:` comment through the closing brace of `if (targetPerson.userId) { … }`. Keep the `targetPerson` lookup and its not-found guard (`:175-179`) — the code still needs it. The next line after the deletion is `let member;` (`:236`).

Leave `AddMemberSchema.confirmSeatExpansion` (`:53`) as-is (vestigial, per the reconciliation note above).

- [ ] **Step 4: Run the families suite, type-check, and lint**

Run: `npm test --workspace=@famlink/api -- families && npm run type-check && npm run lint`
Expected: PASS. Type-check clean (confirms no other use of the removed `stripe` import in `families.ts`; `checkSeatExpansion` is still defined in `subscriptionEnforcement.ts`, just no longer imported here). Lint 0 errors — in particular, no `no-unused-vars` for the two removed imports.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/families.ts apps/api/src/__tests__/routes/families.test.ts
git commit -m "feat: P3-04 billing — remove 402 seat gate + inline Stripe from member-add"
```

---

### Task 3: Add `reconcileSeats`; delete `checkSeatExpansion`

**Files:**
- Modify (rewrite): `apps/api/src/lib/subscriptionEnforcement.ts`
- Test (rewrite): `apps/api/src/__tests__/lib/subscriptionEnforcement.test.ts`

**Interfaces:**
- Consumes: `db` from `@famlink/db`; `stripe` from `../lib/stripeClient` (relative: `./stripeClient`).
- Produces: `reconcileSeats(familyGroupId: string): Promise<void>` — idempotent; sets `FamilySubscription.seatCount` to the true active-member headcount and upserts the Stripe seat line item to `max(0, headcount - includedSeats)` with `proration_behavior: "create_prorations"`, calling Stripe only when the quantity differs. No-op on missing/non-entitling/free-tier subs. `checkSeatExpansion` and `SeatExpansionCheck` are **removed** (Task 2 dropped the only caller).

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `subscriptionEnforcement.test.ts` with:

```typescript
import { db } from "@famlink/db";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { seedTestFamily, seedTestPerson } from "../helpers/db";

const mockStripe = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn(), update: vi.fn() }
}));
vi.mock("stripe", () => {
  function MockStripe() { return mockStripe; }
  MockStripe.prototype = mockStripe;
  return { default: MockStripe };
});

import { reconcileSeats } from "../../lib/subscriptionEnforcement";

async function paidSub(seatCount: number, opts?: { includedSeats?: number; status?: string; stripeSub?: string | null }) {
  const person = await seedTestPerson({ userId: `u_${Math.random()}` });
  const { familyGroup } = await seedTestFamily(person.id);
  await db.pricingTier.create({
    data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, includedSeats: opts?.includedSeats ?? 1, stripePriceId: "price_base", stripeSeatPriceId: "price_seat" }
  });
  await db.familySubscription.create({
    data: {
      familyGroupId: familyGroup.id, tierKey: "BASE", seatCount,
      status: opts?.status ?? "ACTIVE",
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: opts?.stripeSub === undefined ? "sub_test" : opts.stripeSub
    }
  });
  return { familyGroupId: familyGroup.id, adminPersonId: person.id };
}

async function addActiveMember(familyGroupId: string, i: number) {
  const p = await seedTestPerson({ userId: `m_${familyGroupId}_${i}` });
  await db.familyMember.create({ data: { familyGroupId, personId: p.id, roles: [], permissions: [] } });
  return p;
}

describe("reconcileSeats", () => {
  beforeEach(() => {
    mockStripe.subscriptions.retrieve.mockReset();
    mockStripe.subscriptions.update.mockReset();
  });

  it("no-ops for a family with no subscription", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await reconcileSeats(familyGroup.id);
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("no-ops for a free-tier subscription", async () => {
    const person = await seedTestPerson({ userId: "u_free" });
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, stripePriceId: null } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "FREE", seatCount: 1, status: "ACTIVE" } });
    await reconcileSeats(familyGroup.id);
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("no-ops for a PAST_DUE subscription", async () => {
    const { familyGroupId } = await paidSub(1, { status: "PAST_DUE" });
    await reconcileSeats(familyGroupId);
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("sets seatCount to the active headcount and bills seats above includedSeats", async () => {
    // admin + 2 added = 3 active; includedSeats 1 => desiredQty 2
    const { familyGroupId } = await paidSub(1, { includedSeats: 1 });
    await addActiveMember(familyGroupId, 1);
    await addActiveMember(familyGroupId, 2);
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [] } });
    mockStripe.subscriptions.update.mockResolvedValue({});

    await reconcileSeats(familyGroupId);

    const sub = await db.familySubscription.findUnique({ where: { familyGroupId } });
    expect(sub?.seatCount).toBe(3);
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_test", {
      items: [{ price: "price_seat", quantity: 2 }],
      proration_behavior: "create_prorations"
    });
  });

  it("updates the existing seat item by id when one is present", async () => {
    const { familyGroupId } = await paidSub(5, { includedSeats: 1 }); // stale seatCount 5
    await addActiveMember(familyGroupId, 1); // admin + 1 = 2 active => desiredQty 1
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [{ id: "si_1", price: { id: "price_seat" }, quantity: 4 }] } });
    mockStripe.subscriptions.update.mockResolvedValue({});

    await reconcileSeats(familyGroupId);

    const sub = await db.familySubscription.findUnique({ where: { familyGroupId } });
    expect(sub?.seatCount).toBe(2);
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_test", {
      items: [{ id: "si_1", quantity: 1 }],
      proration_behavior: "create_prorations"
    });
  });

  it("deletes the seat item when headcount drops to within includedSeats", async () => {
    const { familyGroupId } = await paidSub(3, { includedSeats: 2 }); // admin only = 1 active => desiredQty 0
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [{ id: "si_1", price: { id: "price_seat" }, quantity: 1 }] } });
    mockStripe.subscriptions.update.mockResolvedValue({});

    await reconcileSeats(familyGroupId);

    const sub = await db.familySubscription.findUnique({ where: { familyGroupId } });
    expect(sub?.seatCount).toBe(1);
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_test", {
      items: [{ id: "si_1", deleted: true }],
      proration_behavior: "create_prorations"
    });
  });

  it("is idempotent — a second run makes no Stripe WRITE when quantity already matches", async () => {
    // NOTE: reconcile always calls subscriptions.retrieve; idempotency means no
    // subscriptions.update (write), not zero Stripe API calls.
    const { familyGroupId } = await paidSub(2, { includedSeats: 1 }); // admin + 1 = 2 active => desiredQty 1
    await addActiveMember(familyGroupId, 1);
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [{ id: "si_1", price: { id: "price_seat" }, quantity: 1 }] } });
    mockStripe.subscriptions.update.mockResolvedValue({});
    await reconcileSeats(familyGroupId);
    mockStripe.subscriptions.update.mockClear();
    await reconcileSeats(familyGroupId); // seatCount already 2, Stripe qty already 1
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("removes a stray quantity-0 seat item when desiredQty is 0", async () => {
    // admin only = 1 active; includedSeats 2 => desiredQty 0. A quantity-0 seat
    // item is still present and must be deleted (not skipped by the equality guard).
    const { familyGroupId } = await paidSub(1, { includedSeats: 2 });
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [{ id: "si_1", price: { id: "price_seat" }, quantity: 0 }] } });
    mockStripe.subscriptions.update.mockResolvedValue({});
    await reconcileSeats(familyGroupId);
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_test", {
      items: [{ id: "si_1", deleted: true }],
      proration_behavior: "create_prorations"
    });
  });

  it("does not count passive (userId==null) or suspended members", async () => {
    const { familyGroupId } = await paidSub(1, { includedSeats: 1 });
    // passive member (no userId)
    const passive = await db.person.create({ data: { firstName: "P", lastName: "Q", ageGateLevel: "ADULT", userId: null } });
    await db.familyMember.create({ data: { familyGroupId, personId: passive.id, roles: [], permissions: [] } });
    // suspended active member
    const susp = await addActiveMember(familyGroupId, 9);
    await db.familyMember.update({ where: { familyGroupId_personId: { familyGroupId, personId: susp.id } }, data: { suspendedAt: new Date() } });
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [] } });
    await reconcileSeats(familyGroupId);
    const sub = await db.familySubscription.findUnique({ where: { familyGroupId } });
    expect(sub?.seatCount).toBe(1); // admin only
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled(); // desiredQty 0, no seat item
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=@famlink/api -- subscriptionEnforcement`
Expected: FAIL to import — `reconcileSeats` is not exported yet.

- [ ] **Step 3: Rewrite `subscriptionEnforcement.ts`**

Replace the entire file with:

```typescript
import { db } from "@famlink/db";
import { stripe } from "./stripeClient";

const ENTITLING_STATUSES = new Set(["ACTIVE", "TRIALING"]);

/**
 * Reconcile a family's Stripe seat quantity to its true active-member headcount.
 * Idempotent: sets an absolute quantity and only calls Stripe when it differs.
 * No-op for missing / non-entitling / free-tier subscriptions. Billed seat
 * quantity = max(0, activeHeadcount - includedSeats); proration is enabled so a
 * mid-cycle change is billed as arrears on the next invoice.
 */
export async function reconcileSeats(familyGroupId: string): Promise<void> {
  const sub = await db.familySubscription.findUnique({
    where: { familyGroupId },
    include: { pricingTier: true }
  });
  if (!sub) return;
  if (!ENTITLING_STATUSES.has(sub.status)) return;
  if (sub.pricingTier.stripePriceId === null) return; // free tier never bills

  const activeCount = await db.familyMember.count({
    where: { familyGroupId, suspendedAt: null, person: { userId: { not: null } } }
  });

  // Local billing quantity always tracks reality.
  if (sub.seatCount !== activeCount) {
    await db.familySubscription.update({
      where: { familyGroupId },
      data: { seatCount: activeCount }
    });
  }

  // Nothing to push to Stripe (no live subscription or no per-seat price).
  if (!sub.stripeSubscriptionId || !sub.pricingTier.stripeSeatPriceId) return;

  const desiredQty = Math.max(0, activeCount - sub.pricingTier.includedSeats);
  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  const seatItem = stripeSub.items.data.find(
    (item) => item.price?.id === sub.pricingTier.stripeSeatPriceId
  );
  const currentQty = seatItem?.quantity ?? 0;

  // Zero overflow seats: remove any existing seat item. Handled BEFORE the
  // equality guard so a stray quantity-0 item is still cleaned up (Stripe
  // permits quantity-0 subscription items, so currentQty could equal desiredQty
  // at 0 with an item still present).
  if (desiredQty === 0) {
    if (!seatItem) return; // nothing to bill, nothing to remove
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: seatItem.id, deleted: true }],
      proration_behavior: "create_prorations"
    });
    return;
  }

  if (currentQty === desiredQty) return; // idempotent no-op (already correct)

  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    items: [
      seatItem
        ? { id: seatItem.id, quantity: desiredQty }
        : { price: sub.pricingTier.stripeSeatPriceId, quantity: desiredQty }
    ],
    proration_behavior: "create_prorations"
  });
}
```

- [ ] **Step 3b: Fix the stale `seatCount` schema comment**

In `packages/db/prisma/schema.prisma`, the comment at `:358-359` still says `seatCount on the subscription is always the TOTAL allowance: includedSeats + billed seat quantity`. Replace it to state the reconciled meaning:

```
  // seatCount tracks the family's true active-member headcount, reconciled from
  // membership by the daily seat-reconciliation pass (decision 10, 2026-08-15).
  // Billed seat quantity is derived as max(0, seatCount - includedSeats).
```

This is a `//` comment (not a `///` doc-comment), so no Prisma client regeneration is required.

- [ ] **Step 4: Run the subscriptionEnforcement suite, type-check, and lint**

Run: `npm test --workspace=@famlink/api -- subscriptionEnforcement && npm run type-check && npm run lint`
Expected: PASS. Type-check clean (Task 2 already removed the only `checkSeatExpansion` importer). Lint 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/subscriptionEnforcement.ts apps/api/src/__tests__/lib/subscriptionEnforcement.test.ts packages/db/prisma/schema.prisma
git commit -m "feat: P3-04 billing — idempotent reconcileSeats; delete checkSeatExpansion"
```

---

### Task 4: Daily seat-reconciliation pass; retire the downgrade-suspension pass

**Files:**
- Modify: `apps/api/src/jobs/billingEnforcement.ts` — add `runSeatReconciliationPass`, delete `runDowngradeEnforcementPass` (`:27-82`), rewire `startBillingCron`.
- Test: `apps/api/src/__tests__/jobs/billingEnforcement.test.ts` — remove the `runDowngradeEnforcementPass` describe (`:42+`), add a `runSeatReconciliationPass` describe.

**Interfaces:**
- Consumes: `reconcileSeats` from `../lib/subscriptionEnforcement` (Task 3).
- Produces: `runSeatReconciliationPass(): Promise<void>` — iterates entitling subscriptions and calls `reconcileSeats` for each family. A guard makes sure that one family's Stripe error does not abort the pass. `runDowngradeEnforcementPass` no longer exists. `runTrialWarningPass` is unchanged.

- [ ] **Step 1: Write the failing test + drop the downgrade test**

In `billingEnforcement.test.ts`: change the import line `:2` to `import { runTrialWarningPass, runSeatReconciliationPass } from "../../jobs/billingEnforcement";` and delete the entire `describe("runDowngradeEnforcementPass", …)` block (`:42` to its end).

Add a hoisted Stripe mock near the top of the file (the isolation test needs it; place it above the first `describe`, alongside the existing imports — check whether the file already imports `vi`):

```typescript
import { vi } from "vitest"; // add to the existing vitest import if not already present
const mockStripe = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn(), update: vi.fn() }
}));
vi.mock("stripe", () => {
  function MockStripe() { return mockStripe; }
  MockStripe.prototype = mockStripe;
  return { default: MockStripe };
});
```

Append the describe block:

```typescript
describe("runSeatReconciliationPass", () => {
  beforeEach(() => {
    mockStripe.subscriptions.retrieve.mockReset();
    mockStripe.subscriptions.update.mockReset();
  });

  it("reconciles entitling families and skips free-tier and non-entitling (PAST_DUE) ones", async () => {
    // Entitling paid family, stale seatCount, 2 active members (admin + 1), no
    // stripeSubscriptionId => DB-only reconcile (no Stripe call).
    const admin = await seedTestPerson({ userId: "u_recon_admin" });
    const { familyGroup: paid } = await seedTestFamily(admin.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, includedSeats: 5, stripePriceId: "price_base", stripeSeatPriceId: "price_seat" } });
    await db.familySubscription.create({ data: { familyGroupId: paid.id, tierKey: "BASE", seatCount: 9, status: "ACTIVE" } });
    const m = await seedTestPerson({ userId: "u_recon_m" });
    await db.familyMember.create({ data: { familyGroupId: paid.id, personId: m.id, roles: [], permissions: [] } });

    // Free family — skipped (stripePriceId null).
    const freeAdmin = await seedTestPerson({ userId: "u_recon_free" });
    const { familyGroup: free } = await seedTestFamily(freeAdmin.id);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, stripePriceId: null } });
    await db.familySubscription.create({ data: { familyGroupId: free.id, tierKey: "FREE", seatCount: 7, status: "ACTIVE" } });

    // Non-entitling PAST_DUE paid family — skipped (status not entitling).
    const pdAdmin = await seedTestPerson({ userId: "u_recon_pd" });
    const { familyGroup: pd } = await seedTestFamily(pdAdmin.id);
    await db.familySubscription.create({ data: { familyGroupId: pd.id, tierKey: "BASE", seatCount: 8, status: "PAST_DUE" } });

    await runSeatReconciliationPass();

    expect((await db.familySubscription.findUnique({ where: { familyGroupId: paid.id } }))?.seatCount).toBe(2); // reconciled to headcount
    expect((await db.familySubscription.findUnique({ where: { familyGroupId: free.id } }))?.seatCount).toBe(7); // untouched
    expect((await db.familySubscription.findUnique({ where: { familyGroupId: pd.id } }))?.seatCount).toBe(8); // untouched
  });

  it("continues reconciling other families when one family's Stripe call throws", async () => {
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, includedSeats: 1, stripePriceId: "price_base", stripeSeatPriceId: "price_seat" } });

    // Two entitling families, each with a live Stripe subscription and 2 active
    // members (so each reaches the Stripe retrieve leg — desiredQty 1).
    for (const tag of ["x", "y"]) {
      const admin = await seedTestPerson({ userId: `u_iso_${tag}` });
      const { familyGroup } = await seedTestFamily(admin.id);
      await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 9, status: "ACTIVE", stripeCustomerId: `cus_${tag}`, stripeSubscriptionId: `sub_${tag}` } });
      const m = await seedTestPerson({ userId: `u_iso_${tag}2` });
      await db.familyMember.create({ data: { familyGroupId: familyGroup.id, personId: m.id, roles: [], permissions: [] } });
    }

    // Fail the FIRST reconciliation's Stripe call regardless of which family is
    // iterated first; the second must still run. Asserting retrieve ran twice is
    // order-independent and fails if the loop lacks its per-family try/catch
    // (an un-caught first rejection would abort before the second retrieve).
    mockStripe.subscriptions.retrieve
      .mockRejectedValueOnce(new Error("stripe boom"))
      .mockResolvedValue({ items: { data: [] } });
    mockStripe.subscriptions.update.mockResolvedValue({});

    await runSeatReconciliationPass();

    expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
  });
});
```

> The isolation assertion is order-independent. It fails the first Stripe call by call-order (`mockRejectedValueOnce`), not by family identity. It asserts that both families reached the Stripe leg. Without a per-family `try/catch`, the first rejection aborts the pass, and `retrieve` runs only once.

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=@famlink/api -- billingEnforcement`
Expected: FAIL — `runSeatReconciliationPass` not exported (and the old downgrade import is gone).

- [ ] **Step 3: Edit `billingEnforcement.ts`**

Add the import at the top (after the existing imports):

```typescript
import { reconcileSeats } from "../lib/subscriptionEnforcement";
```

Delete the entire `runDowngradeEnforcementPass` function (`:27-82`). Add, in its place:

```typescript
export async function runSeatReconciliationPass(): Promise<void> {
  const subs = await db.familySubscription.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIALING"] },
      pricingTier: { stripePriceId: { not: null } }
    },
    select: { familyGroupId: true }
  });

  for (const { familyGroupId } of subs) {
    try {
      await reconcileSeats(familyGroupId);
    } catch (err) {
      // Non-fatal per family: one Stripe error must not abort the pass.
      console.error("Seat reconciliation error for family", familyGroupId, err);
    }
  }
}
```

Rewrite `startBillingCron` to drop the downgrade pass and add the reconciliation pass:

```typescript
export function startBillingCron(): void {
  // Run at 06:00 UTC daily
  cron.schedule("0 6 * * *", async () => {
    try {
      await runTrialWarningPass();
      await runSeatReconciliationPass();
    } catch (err) {
      console.error("Billing enforcement cron error", err);
    }
  });
}
```

- [ ] **Step 4: Run the job suite, type-check, and lint**

Run: `npm test --workspace=@famlink/api -- billingEnforcement && npm run type-check && npm run lint`
Expected: PASS, type-check 6/6 clean, lint 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jobs/billingEnforcement.ts apps/api/src/__tests__/jobs/billingEnforcement.test.ts
git commit -m "feat: P3-04 billing — daily seat reconciliation pass; retire downgrade-suspension pass"
```

---

### Task 5: Stop scheduling downgrade grace in the subscription-updated webhook

**Files:**
- Modify: `apps/api/src/routes/billing.ts:372-403` (the `customer.subscription.updated` case in `handleStripeEvent`).
- Modify: `apps/api/src/routes/billing.ts:102-104` (the `GET /subscription` response — retire the three `pendingDowngrade*` fields to `null`).
- Test: `apps/api/src/__tests__/routes/billing.test.ts:331-360` (webhook) + a new `GET /subscription` regression test.

**Interfaces:**
- Consumes: nothing new.
- Produces: `customer.subscription.updated` still syncs `tierKey`, `seatCount` (from the Stripe seat quantity — the local convergence backstop), `status`, and `trialEndsAt`. It **no longer writes** `pendingDowngradeTierKey` / `pendingDowngradeSeatCount` / `downgradeGraceEndsAt`. `GET /subscription` returns those three fields as `null` unconditionally (they are retired — the web `BillingBanners` "avoid suspension" banner keys on them, and suspension no longer happens; hardcoding `null` neutralizes the false warning for any family with stale rows without a data migration).

> **Why not clear the DB rows?** Per spec §8 the columns stay dormant (no destructive migration). A null at the read boundary fully closes the false-warning path. The banner condition (`pendingDowngradeTierKey && downgradeGraceEndsAt`) can never be true. This approach does not depend on a one-time script against prod. The stale columns are harmless once unread. (The removal of the now-dead downgrade branch from `apps/web/components/billing/BillingBanners.tsx:20-22` is a non-blocking web cleanup, deferred.)

- [ ] **Step 1: Rewrite the downgrade webhook test**

Replace `billing.test.ts:331-360` ("customer.subscription.updated — syncs status and detects downgrade") with:

```typescript
  it("customer.subscription.updated — syncs tier/seatCount/status and does NOT schedule a downgrade", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    // BASE carries a seat price so totalSeatsFromStripeItems can find the item.
    await db.pricingTier.createMany({ data: [
      { tierKey: "MID", displayName: "Mid", displayOrder: 1, includedSeats: 5, stripePriceId: "price_mid", stripeSeatPriceId: "price_seat" },
      { tierKey: "BASE", displayName: "Base", displayOrder: 0, includedSeats: 2, stripePriceId: "price_base", stripeSeatPriceId: "price_seat" }
    ]});
    // existing seatCount 6 > the incoming total (4) => OLD code detects a
    // downgrade and writes pendingDowngrade*; new code must NOT. That gap is the RED.
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "MID", seatCount: 6, stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test", status: "ACTIVE" }
    });

    const { body, sig } = makeStripeEvent("customer.subscription.updated", {
      id: "sub_test",
      metadata: { familyGroupId: familyGroup.id, tierKey: "BASE" },
      status: "active",
      items: { data: [{ price: { id: "price_seat" }, quantity: 2 }] }
    });

    const res = await request(app)
      .post("/api/v1/billing/webhook")
      .set("stripe-signature", sig)
      .set("content-type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.tierKey).toBe("BASE");
    expect(sub?.seatCount).toBe(4); // 2 billed + includedSeats 2 (BASE)
    expect(sub?.pendingDowngradeTierKey).toBeNull();
    expect(sub?.pendingDowngradeSeatCount).toBeNull();
    expect(sub?.downgradeGraceEndsAt).toBeNull();
  });
```

> `seatCount` here is `totalSeatsFromStripeItems` = billed quantity (2) + `includedSeats` (2 for BASE) = 4. The BASE tier in this test now sets `includedSeats: 2` (the old test used `activeUserLimit`, which no longer participates).

Add a second regression test (near the other `GET /subscription` tests — search the file for `"/subscription"`) proving the retired fields never surface even when the DB row still carries them:

```typescript
  it("GET /subscription returns null for the retired pendingDowngrade fields even when the row has values", async () => {
    const person = await seedTestPerson({ userId: "clerk_sub_pd" });
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, stripePriceId: "price_base" } });
    await db.familySubscription.create({
      data: {
        familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 3, status: "ACTIVE",
        pendingDowngradeTierKey: "BASE", pendingDowngradeSeatCount: 1, downgradeGraceEndsAt: new Date("2026-06-07T00:00:00Z")
      }
    });
    mockGetAuth.mockReturnValue({ userId: "clerk_sub_pd" });

    const res = await request(app).get(`/api/v1/billing/subscription?familyGroupId=${familyGroup.id}`);

    expect(res.status).toBe(200);
    expect(res.body.subscription.pendingDowngradeTierKey).toBeNull();
    expect(res.body.subscription.pendingDowngradeSeatCount).toBeNull();
    expect(res.body.subscription.downgradeGraceEndsAt).toBeNull();
  });
```

> Match the file's auth-mock and request helpers (look at the top of `billing.test.ts`. The auth-mock name can differ from `mockGetAuth`). If `GET /subscription` needs a scope or admin, follow the pattern of the existing `/subscription` tests in the file.

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=@famlink/api -- billing`
Expected: FAIL — old handler still writes `pendingDowngradeTierKey`/`downgradeGraceEndsAt`, and old `GET /subscription` echoes the DB values (so the new regression test sees non-null).

- [ ] **Step 3: Simplify the webhook case**

Replace `billing.ts:372-403` (the whole `case "customer.subscription.updated": { … break; }`) with:

```typescript
    case "customer.subscription.updated": {
      const { familyGroupId, tierKey } = obj.metadata ?? {};
      if (!familyGroupId) return;
      const existing = await db.familySubscription.findUnique({ where: { familyGroupId }, include: { pricingTier: true } });
      if (!existing) return;

      const newTier = await db.pricingTier.findUnique({ where: { tierKey: tierKey ?? existing.tierKey } });
      const newSeatCount = totalSeatsFromStripeItems(
        obj.items?.data,
        newTier ?? existing.pricingTier
      );

      // seatCount is the local convergence backstop for Stripe's quantity.
      // Seat billing is reconciled from headcount by the daily cron (decision 10),
      // and tier downgrades no longer suspend members (decision 4) — so no
      // pendingDowngrade* / grace scheduling here.
      await db.familySubscription.update({
        where: { familyGroupId },
        data: {
          tierKey: tierKey ?? existing.tierKey,
          seatCount: newSeatCount,
          status: obj.status === "past_due" ? "PAST_DUE" : obj.status === "trialing" ? "TRIALING" : "ACTIVE",
          trialEndsAt: obj.trial_end ? new Date(obj.trial_end * 1000) : existing.trialEndsAt
        }
      });
      break;
    }
```

Then retire the three fields in the `GET /subscription` response at `billing.ts:102-104`. Replace:

```typescript
      pendingDowngradeTierKey: sub.pendingDowngradeTierKey ?? null,
      pendingDowngradeSeatCount: sub.pendingDowngradeSeatCount ?? null,
      downgradeGraceEndsAt: sub.downgradeGraceEndsAt?.toISOString() ?? null,
```

with:

```typescript
      // Retired 2026-08-15 (decision 10): downgrades no longer suspend members, so
      // these are always null to clients. Columns remain dormant in the DB (spec §8).
      pendingDowngradeTierKey: null,
      pendingDowngradeSeatCount: null,
      downgradeGraceEndsAt: null,
```

- [ ] **Step 4: Run the billing suite, type-check, and lint**

Run: `npm test --workspace=@famlink/api -- billing && npm run type-check && npm run lint`
Expected: PASS, type-check 6/6 clean, lint 0 errors. (Before running, grep `pendingDowngrade` in `billing.test.ts` to confirm only the one test above asserts it; update any other to expect null.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/billing.ts apps/api/src/__tests__/routes/billing.test.ts
git commit -m "feat: P3-04 billing — subscription-updated webhook no longer schedules downgrade grace"
```

---

### Task 6: `billingImpactForAdd` helper (consumed later by W1 PR-2 / CIF)

**Files:**
- Modify: `apps/api/src/lib/subscriptionEnforcement.ts` — add `billingImpactForAdd`.
- Test: `apps/api/src/__tests__/lib/subscriptionEnforcement.test.ts` — add a describe block.

**Interfaces:**
- Consumes: `db`; `ENTITLING_STATUSES` (already in the file from Task 3).
- Produces: `billingImpactForAdd(familyGroupId: string): Promise<{ willBill: boolean; note: string | null }>` — whether adding one more active member would raise billable headcount beyond `includedSeats` on a paid entitling tier, plus a plain-language note. **No caller in this slice** (W1 PR-2's accept path and CIF activation will consume it).

- [ ] **Step 1: Write the failing tests**

Append to `subscriptionEnforcement.test.ts`:

```typescript
import { billingImpactForAdd } from "../../lib/subscriptionEnforcement";

describe("billingImpactForAdd", () => {
  it("willBill=true with a note once the next active member exceeds includedSeats", async () => {
    // includedSeats 2, admin + 1 = 2 active; adding one more => 3 > 2 => bills.
    const { familyGroupId } = await paidSub(2, { includedSeats: 2 });
    await addActiveMember(familyGroupId, 1);
    const impact = await billingImpactForAdd(familyGroupId);
    expect(impact.willBill).toBe(true);
    expect(impact.note).toBe("This will be reflected on your next invoice.");
  });

  it("willBill=false with no note while the next member stays within includedSeats", async () => {
    // includedSeats 5, admin only = 1 active; adding one more => 2 <= 5 => no bill.
    const { familyGroupId } = await paidSub(1, { includedSeats: 5 });
    const impact = await billingImpactForAdd(familyGroupId);
    expect(impact.willBill).toBe(false);
    expect(impact.note).toBeNull();
  });

  it("willBill=false for a free tier", async () => {
    const person = await seedTestPerson({ userId: "u_bi_free" });
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, stripePriceId: null } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "FREE", seatCount: 1, status: "ACTIVE" } });
    const impact = await billingImpactForAdd(familyGroup.id);
    expect(impact.willBill).toBe(false);
    expect(impact.note).toBeNull();
  });

  it("willBill=false for a paid tier with no per-seat price (reconcile can't bill overflow)", async () => {
    const person = await seedTestPerson({ userId: "u_bi_noseat" });
    const { familyGroup } = await seedTestFamily(person.id);
    // Paid tier, live sub, but stripeSeatPriceId is null => overflow can't be billed.
    await db.pricingTier.create({ data: { tierKey: "NOSEAT", displayName: "No Seat", displayOrder: 1, includedSeats: 1, stripePriceId: "price_ns" } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "NOSEAT", seatCount: 1, status: "ACTIVE", stripeCustomerId: "cus", stripeSubscriptionId: "sub_ns" } });
    const m = await seedTestPerson({ userId: "u_bi_noseat_m" });
    await db.familyMember.create({ data: { familyGroupId: familyGroup.id, personId: m.id, roles: [], permissions: [] } });
    // 2 active, includedSeats 1 => would exceed, but no seat price => no bill.
    const impact = await billingImpactForAdd(familyGroup.id);
    expect(impact.willBill).toBe(false);
    expect(impact.note).toBeNull();
  });
});
```

> Reuses the `paidSub` / `addActiveMember` helpers defined in Task 1's Step 1 of this file. Put the new `import { billingImpactForAdd }` next to the existing `reconcileSeats` import (or merge into one import line).

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=@famlink/api -- subscriptionEnforcement`
Expected: FAIL — `billingImpactForAdd` not exported.

- [ ] **Step 3: Add the helper**

Append to `apps/api/src/lib/subscriptionEnforcement.ts`:

```typescript
/**
 * Whether adding one more active (userId != null) member would raise billable
 * headcount beyond the tier's included seats on a paid, entitling subscription.
 * Pure read; no Stripe call. Consumed by the consent-accept path (W1 PR-2) and
 * CIF activation to surface a "your bill will change" indicator.
 */
export async function billingImpactForAdd(
  familyGroupId: string
): Promise<{ willBill: boolean; note: string | null }> {
  const sub = await db.familySubscription.findUnique({
    where: { familyGroupId },
    include: { pricingTier: true }
  });
  // Only promise a bill under the exact conditions reconcileSeats would actually
  // charge: entitling + paid + a live Stripe subscription + a per-seat price.
  if (
    !sub ||
    !ENTITLING_STATUSES.has(sub.status) ||
    sub.pricingTier.stripePriceId === null ||
    sub.pricingTier.stripeSeatPriceId === null ||
    !sub.stripeSubscriptionId
  ) {
    return { willBill: false, note: null };
  }
  const activeCount = await db.familyMember.count({
    where: { familyGroupId, suspendedAt: null, person: { userId: { not: null } } }
  });
  const willBill = activeCount + 1 > sub.pricingTier.includedSeats;
  return {
    willBill,
    note: willBill ? "This will be reflected on your next invoice." : null
  };
}
```

- [ ] **Step 4: Run the suite + full API verification**

Run: `npm test --workspace=@famlink/api -- subscriptionEnforcement`
Expected: PASS.

Then the full slice verification:

Run: `npm test --workspace=@famlink/api && npm run type-check && npm run lint`
Expected: full API suite green, type-check 6/6 clean, lint 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/subscriptionEnforcement.ts apps/api/src/__tests__/lib/subscriptionEnforcement.test.ts
git commit -m "feat: P3-04 billing — add billingImpactForAdd helper for consent/CIF surfacing"
```

---

## Final verification (run before requesting whole-branch review)

- [ ] `npm test --workspace=@famlink/api` — full API suite green.
- [ ] `npm run type-check` — 6/6 clean.
- [ ] `npm run lint` — 0 errors (≤34 pre-existing warnings).
- [ ] `git diff --check` — clean.
- [ ] `detect_changes({scope: "compare", base_ref: "main"})` — affected symbols confined to `entitlements.ts`, `subscriptionEnforcement.ts`, `billingEnforcement.ts`, `families.ts` (add path), and the `billing.ts` webhook handler. No unexpected flow touched.
- [ ] Grep the tree for stragglers referencing retired symbols: `checkSeatExpansion`, `runDowngradeEnforcementPass`, `SeatExpansionCheck`, `applySeatIncrement` — expect zero non-historical hits.

## Whole-branch review brief (name these as in-scope even where the diff does not touch them)

- **Isolation:** `reconcileSeats` and `billingImpactForAdd` must read and write only the given family's own subscription and its own Stripe objects. They must have no cross-tenant surface. Make sure that the `FamilyMember.count` is family-scoped.
- **Idempotency:** A re-run of the daily pass makes no Stripe **write** when the quantities match. `subscriptions.retrieve` runs every time. The idempotency is about `subscriptions.update`. Examine the `currentQty === desiredQty` guard, the `desiredQty === 0` delete-before-guard branch, and the `seatCount` equality guard.
- **`billingImpactForAdd` fidelity:** It must return `willBill:true` only under the same conditions that make `reconcileSeats` charge (entitling, paid, a live `stripeSubscriptionId`, and a `stripeSeatPriceId`). Then the "your bill will change" indicator does not over-promise.
- **`proration_behavior: "create_prorations"`** on every Stripe write (no `"none"` in the new code).
- **Coverage semantics:** Make sure that no code path uses the old `take: seatCount` boundary. Grep `seatCount` across `apps/api/src` for read-time coverage uses.
- **Dormant columns:** Make sure that this slice adds no destructive migration. `pendingDowngrade*` and `activeUserLimit` stay as unused columns.

## Self-review notes (author, 2026-08-15)

- **Spec coverage:** §3 → Task 1. §4 add-path → Task 2. §5 `reconcileSeats` and §8 `checkSeatExpansion` deletion → Task 3. §6 daily pass and downgrade-pass removal → Task 4. §6 webhook backstop and decision 4 (no `pendingDowngrade`) → Task 5. §7 `billingImpactForAdd` → Task 6. §9 isolation and idempotency → review brief. §10 testing → folded into each task's tests. §11 out-of-scope (`seat-impact` and `expandSeats` removal, the drop of dormant columns, UI) respected.
- **Deviation from spec wording:** The plan never creates `applySeatIncrement` (spec §4 states that `reconcileSeats` supersedes it). The `expandSeats` endpoint named in §8 does not exist. The plan leaves the read-only `seat-impact` preview untouched. The `pendingDowngrade*` write is in the webhook handler, which Task 5 edits.
- **Type consistency:** `reconcileSeats(familyGroupId: string): Promise<void>`, `billingImpactForAdd(familyGroupId: string): Promise<{ willBill: boolean; note: string | null }>`, `runSeatReconciliationPass(): Promise<void>` used consistently across producer/consumer tasks.
- **Proration decision (Steve, 2026-08-15):** `proration_behavior: "create_prorations"`. A mid-cycle seat change bills or credits the partial period on the next invoice (arrears). This decision supersedes the spec §5 `"none"` recommendation. The spec §5 text now records this decision.

## Council round 1 (Codex, 2026-08-15) — folded in

The plan resolves all 4 BLOCKERs, 3 MAJORs, and the MINOR and NIT findings:
- **[BLOCKER] Task 5 did not reach GREEN** — The fixture now gives BASE a `stripeSeatPriceId` and the event item a matching `price.id`. `existing.seatCount = 6 > 4`, so old code schedules a downgrade (RED) and new code does not (GREEN).
- **[BLOCKER] `seatCount` had two meanings** — Pinned to active-member headcount (spec §5). Documented as display-only after this slice. Task 3 updates the stale schema comment.
- **[BLOCKER] Zero-seat delete bypassed by the equality guard** — `reconcileSeats` now branches on `desiredQty === 0` before the `currentQty === desiredQty` guard. Added a stray-quantity-0 regression test.
- **[BLOCKER] Per-task verification** — Every task Step 4 now runs type-check and lint, not only the filtered tests.
- **[MAJOR] False RED steps** — Task 1 Step 2 now names only the two cap-exercising tests as RED. The suspension test is a kept regression. Task 2 uses a finite `activeUserLimit` at the seat boundary, so old code returns 402.
- **[MAJOR] Missing failure-isolation test** — Task 4 adds a two-family test. One family's Stripe call throws and the other still reconciles, with a hoisted Stripe mock.
- **[MAJOR] `billingImpactForAdd` over-promised** — The guard now also needs `stripeSeatPriceId` and a live `stripeSubscriptionId`. Added a no-seat-price test.
- **[MINOR] "no Stripe call" became "no Stripe write"** — `retrieve` always runs. The Task 4 skip test adds a PAST_DUE non-entitling fixture. Commit messages use the repo `feat: P3-04 …` format.
- **[NIT]** Renamed the stale "within seatCount" and "within seats" test titles.

## Council round 2 (Codex, 2026-08-15) — converged

Round 1's four BLOCKERs are cleared. Three new findings, all resolved:
- **[BLOCKER] Existing `pendingDowngrade*` rows made a permanent false "avoid suspension" banner.** `BillingBanners.tsx:20-22` fires on those fields, and suspension is gone. Task 5 now sets the three fields to `null` in the `GET /subscription` response. This neutralizes the banner with no data migration. The columns stay dormant (spec §8). Task 5 adds a regression test with seeded pending values. The web dead-branch removal is deferred.
- **[MAJOR] Isolation test was order-dependent** (`findMany` order is not guaranteed). Rewritten to fail the first Stripe call by call-order (`mockRejectedValueOnce`) and to assert that `retrieve` ran twice. This test is order-independent and fails without the per-family `try/catch`.
- **[MINOR] Task 1 header still said "billing quantity"** — Changed to "active-member headcount".

**Verdict: converged (2-round cap reached).** No open BLOCKERs. The findings moved from 4B/3M to 1B/1M/1MI to 0 open. The plan is execution-ready.
