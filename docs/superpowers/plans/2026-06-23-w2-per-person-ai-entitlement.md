# W2 — Per-Person AI Entitlement (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI daily allowance a per-person entitlement derived from paid coverage — a covered person gets the full allowance in *any* family they belong to; everyone else gets a small free baseline.

**Architecture:** Add a read-time entitlement resolver (`entitlements.ts`) that answers "is this person covered?" by OR-ing over their active family memberships' paid subscriptions. Parameterize the existing Redis per-user limiter to accept a daily limit, and have the AI routes pass the coverage-derived limit. No new schema, no stored entitlement state — coverage is computed live on every request.

**Tech Stack:** TypeScript, Express, Prisma (`@famlink/db`), Redis (ioredis), Vitest, supertest.

## Global Constraints

- **Test runner:** Vitest. Run API tests from `apps/api` with `npx vitest run <path>`.
- **Commit format:** `feat: P3-02 <short description>`.
- **Entitlement is derived at read-time — never materialized into stored state.** No new DB columns; coverage is recomputed per request.
- **Do NOT use `FamilySubscription.grandfathered` as the entitlement lever** — it is a Stripe legacy-pricing flag (council round-1, MAJOR). Coverage is derived from subscription status + paid tier only.
- **"Paid tier" = `PricingTier.stripePriceId !== null`.** The free tier is the active tier with `stripePriceId === null` (billing.ts:259, 409).
- **Entitling subscription statuses:** `ACTIVE`, `TRIALING`. (`PAST_DUE`, `CANCELED` do not entitle.)
- **Coverage definition (decided 2026-06-23):** a person is covered iff they are an active (non-suspended) member of ≥1 family whose subscription is entitling AND on a paid tier, AND they fall within that family's `seatCount` when active members are ordered by `joinedAt` ascending (earliest-joined occupy the seats).
- **Allowances (tunable constants):** covered = 20/day, free = 3/day.
- **Scope:** this plan is the W2 **entitlement core**. The per-family usage *attribution*, near-limit *upsell*, and *degrade-foreign-context-first* mechanics from the design (§4) are a separate follow-on plan (W2b) and are intentionally NOT in scope here.

---

## File Structure

- **Create** `apps/api/src/lib/entitlements.ts` — coverage resolver + allowance constants. One responsibility: "what is this person entitled to?"
- **Create** `apps/api/src/lib/__tests__/entitlements.test.ts` — db-backed unit tests for the resolver.
- **Modify** `apps/api/src/lib/aiRateLimit.ts` — accept a `limit` argument instead of a hardcoded `DAILY_LIMIT`.
- **Modify** `apps/api/src/lib/__tests__/aiRateLimit.test.ts` — pass the limit; add a free-tier-limit case.
- **Modify** `apps/api/src/routes/ai.ts` — derive the limit from coverage and pass it to the limiter; de-hardcode the "20" copy.
- **Modify** `apps/api/src/routes/__tests__/ai.test.ts` — mock `entitlements`; cover covered-vs-free limits.

---

### Task 1: Entitlement resolver (`entitlements.ts`)

**Files:**
- Create: `apps/api/src/lib/entitlements.ts`
- Test: `apps/api/src/lib/__tests__/entitlements.test.ts`

**Interfaces:**
- Consumes: `db` from `@famlink/db`.
- Produces:
  - `AI_DAILY_LIMIT_COVERED: number` (= 20)
  - `AI_DAILY_LIMIT_FREE: number` (= 3)
  - `isPersonCovered(personId: string): Promise<boolean>`
  - `getAiDailyLimit(personId: string): Promise<number>`
  - `getAiDailyLimitForUser(userId: string): Promise<number>` — resolves the `Person` by Clerk `userId`, returns its limit, or `AI_DAILY_LIMIT_FREE` if no person.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/__tests__/entitlements.test.ts`:

```typescript
import { db } from "@famlink/db";
import { describe, it, expect } from "vitest";
import {
  isPersonCovered,
  getAiDailyLimit,
  getAiDailyLimitForUser,
  AI_DAILY_LIMIT_COVERED,
  AI_DAILY_LIMIT_FREE
} from "../entitlements";
import { seedTestPerson, seedTestFamily } from "../../__tests__/helpers/db";

async function paidTier(tierKey: string, seatCount: number, status = "ACTIVE") {
  await db.pricingTier.create({
    data: { tierKey, displayName: tierKey, displayOrder: 1, stripePriceId: `price_${tierKey}` }
  });
  return { tierKey, seatCount, status };
}

async function subscribe(familyGroupId: string, tierKey: string, seatCount: number, status = "ACTIVE") {
  await db.familySubscription.create({ data: { familyGroupId, tierKey, seatCount, status } });
}

describe("isPersonCovered", () => {
  it("is false for a person with no memberships", async () => {
    const person = await seedTestPerson();
    expect(await isPersonCovered(person.id)).toBe(false);
  });

  it("is false for a member of a free-tier family", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, stripePriceId: null } });
    await subscribe(familyGroup.id, "FREE", 1);
    expect(await isPersonCovered(person.id)).toBe(false);
  });

  it("is true for a member of a paid ACTIVE family within seatCount", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5);
    expect(await isPersonCovered(person.id)).toBe(true);
  });

  it("is true for a paid TRIALING family", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5, "TRIALING");
    expect(await isPersonCovered(person.id)).toBe(true);
  });

  it("is false when the paid subscription is PAST_DUE", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5, "PAST_DUE");
    expect(await isPersonCovered(person.id)).toBe(false);
  });

  it("excludes members beyond seatCount (earliest-joined occupy the seats)", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id); // admin joins first
    await paidTier("SOLO", 1);
    await subscribe(familyGroup.id, "SOLO", 1);
    const late = await db.person.create({
      data: { firstName: "Late", lastName: "Joiner", ageGateLevel: "ADULT", userId: null }
    });
    await db.familyMember.create({
      data: { familyGroupId: familyGroup.id, personId: late.id, roles: [], permissions: [] }
    });
    expect(await isPersonCovered(admin.id)).toBe(true);
    expect(await isPersonCovered(late.id)).toBe(false);
  });

  it("OR-coverage: covered via a paid family even when also in a free family", async () => {
    const person = await seedTestPerson();
    const free = await seedTestFamily(person.id);
    const paid = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, stripePriceId: null } });
    await subscribe(free.familyGroup.id, "FREE", 1);
    await paidTier("PRO", 5);
    await subscribe(paid.familyGroup.id, "PRO", 5);
    expect(await isPersonCovered(person.id)).toBe(true);
  });
});

describe("getAiDailyLimit / getAiDailyLimitForUser", () => {
  it("returns the covered limit for a covered person", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5);
    expect(await getAiDailyLimit(person.id)).toBe(AI_DAILY_LIMIT_COVERED);
  });

  it("returns the free limit for an uncovered person", async () => {
    const person = await seedTestPerson();
    expect(await getAiDailyLimit(person.id)).toBe(AI_DAILY_LIMIT_FREE);
  });

  it("resolves by Clerk userId and falls back to free for unknown users", async () => {
    const person = await seedTestPerson({ userId: "clerk_cov" });
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5);
    expect(await getAiDailyLimitForUser("clerk_cov")).toBe(AI_DAILY_LIMIT_COVERED);
    expect(await getAiDailyLimitForUser("clerk_nobody")).toBe(AI_DAILY_LIMIT_FREE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/lib/__tests__/entitlements.test.ts`
Expected: FAIL — `Cannot find module '../entitlements'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/lib/entitlements.ts`:

```typescript
/**
 * AI entitlement resolver (P3-02 / W2).
 *
 * Coverage is derived live on every call — never materialized. A person is
 * "covered" iff they are an active (non-suspended) member of at least one family
 * whose subscription is entitling (ACTIVE | TRIALING) AND on a paid tier
 * (PricingTier.stripePriceId !== null), AND they fall within that family's
 * seatCount when active members are ordered by joinedAt ascending.
 */

import { db } from "@famlink/db";

export const AI_DAILY_LIMIT_COVERED = 20;
export const AI_DAILY_LIMIT_FREE = 3;

const ENTITLING_STATUSES = new Set(["ACTIVE", "TRIALING"]);

export async function isPersonCovered(personId: string): Promise<boolean> {
  const memberships = await db.familyMember.findMany({
    where: { personId, suspendedAt: null },
    select: { familyGroupId: true }
  });

  for (const { familyGroupId } of memberships) {
    const sub = await db.familySubscription.findUnique({
      where: { familyGroupId },
      select: {
        status: true,
        seatCount: true,
        pricingTier: { select: { stripePriceId: true } }
      }
    });
    if (!sub) continue;
    if (!ENTITLING_STATUSES.has(sub.status)) continue;
    if (sub.pricingTier.stripePriceId === null) continue; // free tier never covers

    const seated = await db.familyMember.findMany({
      where: { familyGroupId, suspendedAt: null },
      orderBy: { joinedAt: "asc" },
      take: sub.seatCount,
      select: { personId: true }
    });
    if (seated.some((m) => m.personId === personId)) return true;
  }

  return false;
}

export async function getAiDailyLimit(personId: string): Promise<number> {
  return (await isPersonCovered(personId)) ? AI_DAILY_LIMIT_COVERED : AI_DAILY_LIMIT_FREE;
}

export async function getAiDailyLimitForUser(userId: string): Promise<number> {
  const person = await db.person.findUnique({ where: { userId }, select: { id: true } });
  if (!person) return AI_DAILY_LIMIT_FREE;
  return getAiDailyLimit(person.id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/lib/__tests__/entitlements.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/entitlements.ts apps/api/src/lib/__tests__/entitlements.test.ts
git commit -m "feat: P3-02 per-person AI coverage resolver (entitlements.ts)"
```

---

### Task 2: Parameterize the rate limiter

**Files:**
- Modify: `apps/api/src/lib/aiRateLimit.ts`
- Test: `apps/api/src/lib/__tests__/aiRateLimit.test.ts`

**Interfaces:**
- Produces (changed signatures):
  - `checkAndIncrementAiRateLimit(userId: string, limit: number): Promise<RateLimitResult>`
  - `getRateLimitStatus(userId: string, limit: number): Promise<RateLimitResult>`

- [ ] **Step 1: Update the failing tests**

In `apps/api/src/lib/__tests__/aiRateLimit.test.ts`, pass an explicit limit to every call and add a free-tier case. Replace each existing call as follows (the limit is the 2nd argument):

```typescript
// checkAndIncrementAiRateLimit calls — pass 20 to preserve prior expectations:
const result = await checkAndIncrementAiRateLimit("user_alice", 20);   // expects remaining 19
const result = await checkAndIncrementAiRateLimit("user_bob", 20);     // pre-set 3 -> remaining 16
const result = await checkAndIncrementAiRateLimit("user_carol", 20);   // pre-set 20 -> blocked
// concurrent test:
checkAndIncrementAiRateLimit("user_concurrent", 20)                    // 30 calls -> 20 allowed
const result = await checkAndIncrementAiRateLimit("user_dave", 20);    // pre-set 19 -> remaining 0
await checkAndIncrementAiRateLimit("user_eve", 20);                    // key-format assertion
await checkAndIncrementAiRateLimit("user_frank", 20);                  // TTL assertions (both calls)

// getRateLimitStatus calls — pass 20:
const result = await getRateLimitStatus("user_new", 20);               // remaining 20
const result = await getRateLimitStatus("user_known", 20);            // pre-set 5 -> remaining 15
const result = await getRateLimitStatus("user_maxed", 20);            // pre-set 20 -> blocked
```

Then add this new test inside the `describe("checkAndIncrementAiRateLimit", ...)` block:

```typescript
it("blocks a free-tier user after their lower limit", async () => {
  const today = new Date().toISOString().split("T")[0];
  store.set(`ai:rate:user_free:${today}`, "3");

  const result = await checkAndIncrementAiRateLimit("user_free", 3);

  expect(result.allowed).toBe(false);
  expect(result.remaining).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run src/lib/__tests__/aiRateLimit.test.ts`
Expected: FAIL — the free-tier case still uses the hardcoded 20, so the limit-3 user is wrongly allowed (and TS may flag the extra argument).

- [ ] **Step 3: Apply the implementation**

In `apps/api/src/lib/aiRateLimit.ts`:

1. Delete the line `const DAILY_LIMIT = 20;` (keep `const TTL_SECONDS = 86400;`).
2. Change `checkAndIncrementAiRateLimit` to take `limit` and use it:

```typescript
export async function checkAndIncrementAiRateLimit(
  userId: string,
  limit: number
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const key = todayUtcKey(userId);
  const resetAt = nextUtcMidnight();

  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, TTL_SECONDS);
  }

  if (count > limit) {
    return { allowed: false, remaining: 0, resetAt };
  }

  return { allowed: true, remaining: limit - count, resetAt };
}
```

3. Change `getRateLimitStatus` to take `limit` and use it:

```typescript
export async function getRateLimitStatus(
  userId: string,
  limit: number
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const key = todayUtcKey(userId);
  const resetAt = nextUtcMidnight();

  const current = await redis.get(key);

  if (current === null) {
    return { allowed: true, remaining: limit, resetAt };
  }

  const count = parseInt(current, 10);
  const remaining = Math.max(0, limit - count);
  return { allowed: count < limit, remaining, resetAt };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run src/lib/__tests__/aiRateLimit.test.ts`
Expected: PASS (all prior cases + the new free-tier case).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/aiRateLimit.ts apps/api/src/lib/__tests__/aiRateLimit.test.ts
git commit -m "feat: P3-02 parameterize AI rate limiter with a per-call daily limit"
```

---

### Task 3: Wire coverage into the AI routes

**Files:**
- Modify: `apps/api/src/routes/ai.ts`
- Test: `apps/api/src/routes/__tests__/ai.test.ts`

**Interfaces:**
- Consumes: `getAiDailyLimit`, `getAiDailyLimitForUser` (Task 1); `checkAndIncrementAiRateLimit`, `getRateLimitStatus` (Task 2).

- [ ] **Step 1: Update the failing tests**

In `apps/api/src/routes/__tests__/ai.test.ts`:

Add an `entitlements` mock alongside the existing `aiRateLimit` mock (after the block ending at line 84):

```typescript
const mockGetAiDailyLimit = vi.fn();
const mockGetAiDailyLimitForUser = vi.fn();

vi.mock("../../lib/entitlements", () => ({
  getAiDailyLimit: (...args: unknown[]) => mockGetAiDailyLimit(...args),
  getAiDailyLimitForUser: (...args: unknown[]) => mockGetAiDailyLimitForUser(...args)
}));
```

In `beforeEach`, default the new mocks to the covered limit so existing tests are unaffected:

```typescript
mockGetAiDailyLimit.mockResolvedValue(20);
mockGetAiDailyLimitForUser.mockResolvedValue(20);
```

Add this test inside `describe("POST /api/v1/ai/chat", ...)`:

```typescript
it("passes the coverage-derived limit to the rate limiter", async () => {
  mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
  mockPersonFindUnique.mockResolvedValue(PERSON);
  mockFamilyMemberFindUnique.mockResolvedValue(MEMBERSHIP);
  mockGetAiDailyLimit.mockResolvedValue(3); // free-tier user
  mockCheckAndIncrement.mockResolvedValue(ALLOWED_RATE);

  const app = createApp();
  await request(app).post("/api/v1/ai/chat").send(VALID_BODY);

  expect(mockGetAiDailyLimit).toHaveBeenCalledWith("p1");
  expect(mockCheckAndIncrement).toHaveBeenCalledWith("clerk_user1", 3);
});
```

Add this test inside `describe("GET /api/v1/ai/status", ...)`:

```typescript
it("reflects the free-tier limit in usage math", async () => {
  mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
  mockGetAiDailyLimitForUser.mockResolvedValue(3);
  mockGetRateLimitStatus.mockResolvedValue({ allowed: true, remaining: 1, resetAt: new Date() });

  const app = createApp();
  const res = await request(app).get("/api/v1/ai/status");

  expect(mockGetRateLimitStatus).toHaveBeenCalledWith("clerk_user1", 3);
  expect(res.body.queriesRemaining).toBe(1);
  expect(res.body.queriesUsedToday).toBe(2); // 3 - 1
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run src/routes/__tests__/ai.test.ts`
Expected: FAIL — `mockGetAiDailyLimit`/`mockCheckAndIncrement` not called with the new args (route still passes no limit; status still uses literal 20).

- [ ] **Step 3: Apply the implementation**

In `apps/api/src/routes/ai.ts`:

1. Add the import after the `aiRateLimit` import (line 18):

```typescript
import { getAiDailyLimit, getAiDailyLimitForUser } from "../lib/entitlements";
```

2. Replace the rate-limit block (current lines 82–91) with:

```typescript
  // 4. Check rate limit against the person's coverage-derived daily allowance
  const limit = await getAiDailyLimit(person.id);
  const rateLimit = await checkAndIncrementAiRateLimit(userId, limit);
  if (!rateLimit.allowed) {
    res.status(429).json({
      error: "Daily AI limit reached",
      resetAt: rateLimit.resetAt,
      message: `You've reached your daily limit of ${limit} AI queries. It resets at midnight UTC.`
    });
    return;
  }
```

3. Replace the `/status` handler body (current lines 166–176) with:

```typescript
aiRouter.get("/status", async (req: Request, res: Response): Promise<void> => {
  const { userId } = authed(req);

  const limit = await getAiDailyLimitForUser(userId);
  const status = await getRateLimitStatus(userId, limit);

  res.json({
    queriesUsedToday: limit - status.remaining,
    queriesRemaining: status.remaining,
    resetAt: status.resetAt
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run src/routes/__tests__/ai.test.ts`
Expected: PASS (all prior cases + the two new ones).

- [ ] **Step 5: Run the full API suite + type-check**

Run: `cd apps/api && npx vitest run && npx tsc --noEmit`
Expected: All tests PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/ai.ts apps/api/src/routes/__tests__/ai.test.ts
git commit -m "feat: P3-02 gate AI allowance on per-person coverage in AI routes"
```

---

## Out of scope (follow-on W2b)

Per-family usage **attribution**, the near-limit **upsell** trigger, and **degrade-foreign-context-first** behavior (design §4) are deliberately excluded. They depend on per-(person × family) usage tracking and the notification surface, and warrant their own plan once this core lands. The web/mobile clients already read `GET /ai/status`; surfacing the free-vs-covered distinction in the UI is also part of W2b.
