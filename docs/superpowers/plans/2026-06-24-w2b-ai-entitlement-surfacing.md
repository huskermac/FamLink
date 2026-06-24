# W2b — AI Entitlement Surfacing, Foreign-Context Throttling & Upsell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish W2 — surface each person's real AI entitlement (free 3/day vs covered 20/day) in web **and** mobile, throttle "foreign" (unpaid) family contexts first to protect the paying relationship, and turn the free/foreign ceiling into an in-context "upgrade your family" CTA.

**Architecture:** W2-core (PR #1) resolves coverage server-side (`entitlements.ts`) and gates a per-user/day Redis limiter. W2b (1) adds a per-family coverage predicate, (2) makes the limiter context-aware with a second "foreign-aggregate" counter so usage in families that don't cover the person is capped first, (3) exposes `covered`/`dailyLimit`/`effectiveLimit`/`foreignContext` via `GET /ai/status` (membership-validated), and (4) surfaces all of it + an upgrade CTA on web and mobile. No new DB state; coverage stays read-time-derived.

**Tech Stack:** TypeScript, Express, Prisma (`@famlink/db`), Redis (ioredis), Next.js (web), React Native/Expo (mobile), React Query, Vitest + @testing-library/react, Jest + Expo preset (mobile), supertest.

## Scope (UPDATED 2026-06-24 — both previously-deferred items pulled IN by Steve)

All four design §4 mechanics are in scope: per-person attribution (already in data), no-spillover (already in core), free-vs-covered surfacing + upsell (web + mobile), and degrade-foreign-context-first.

### Design decisions & risks (resolved against council plan-gate round 1)
- **Protect-the-paying-relationship semantics (decided):** entitlement is ONE global per-person allowance (`dailyLimit`: 20 covered / 3 free) — this is the hard cap. A request in a family that does **not** cover the person ("foreign context") *also* draws a single per-person **foreign-aggregate** counter capped at `AI_DAILY_LIMIT_FOREIGN` (= `AI_DAILY_LIMIT_FREE` = 3). So foreign usage can consume **at most 3 of the 20**, and cannot exceed the per-person hard cap. Foreign usage *does* count against the global 20 (it must, to honor the per-person allowance) — "protect" means *bound the bleed to ≤3*, not *reserve a separate 20*. A free user has no paid context, so foreign cap == global cap (3): no behavior change. **Chosen:** aggregate foreign cap (not per-foreign-family) for a strong, simple protection guarantee.
- **`/status` isolation (BLOCKER fix):** `/status` validates the requester is an active member of `familyGroupId` before honoring it (parity with `/chat`); a non-member or unknown family id is **ignored** (status falls back to global, non-foreign). No cross-family data is derivable from the param.
- **Limiter atomicity:** individual `INCR`s are atomic. The limiter sets the key TTL on **every** increment (not only the first), closing the crash-between-INCR-and-EXPIRE gap. The only foreign-counter overcount case is when the **global** cap also rejects — i.e. the user is already blocked for the day — so the overcount is benign (it self-clears at the date-keyed TTL). Exact transactional counting (Lua) is deemed unnecessary for daily rate-limiting; noted as a future option if abuse appears.
- **N+1 cost (acknowledged):** `isPersonCovered` iterates the person's active memberships, ~2 queries per family. Acceptable given a person belongs to few families; if that assumption breaks, collapse to a single membership+subscription join. Called out for the executor, not blocking.
- **⚠️ Mobile upsell App Store risk (mitigated for beta):** linking to a **web** purchase to unlock a digital subscription may violate Apple Guideline 3.1.1 (IAP). The mobile CTA is gated behind `EXPO_PUBLIC_ENABLE_WEB_UPSELL` (**off by default**), so store builds ship without it unless explicitly enabled (e.g., internal/TestFlight). GA requires StoreKit/Play Billing — out of scope here by Steve's beta-first direction.

---

## Global Constraints

- **Test runner:** API/web = Vitest (`cd apps/<app> && npx vitest run <path>`). Mobile = Jest (`cd apps/mobile && npx jest <path>`).
- **Commit format:** `feat: P3-02 <short description>` (W2b is part of P3-02). Every commit must build (`tsc --noEmit` clean).
- **Entitlement is derived at read-time — never materialized.** No new DB columns or migrations.
- **Do NOT use `FamilySubscription.grandfathered`** as an entitlement lever.
- **Allowance constants live in `entitlements.ts`:** `AI_DAILY_LIMIT_COVERED = 20`, `AI_DAILY_LIMIT_FREE = 3`, `AI_DAILY_LIMIT_FOREIGN = 3`. Never hardcode these in routes or UI.
- **`/ai/status` shape (target):** `{ queriesUsedToday, queriesRemaining, dailyLimit, effectiveLimit, covered, foreignContext, resetAt }`; accepts optional, membership-validated `?familyGroupId=`.
- **Redis keys:** global `ai:rate:{userId}:{YYYY-MM-DD}` (existing); foreign `ai:rate:foreign:{userId}:{YYYY-MM-DD}` (new). Daily reset is by the date in the key; TTL (86400s, set every increment) is cleanup.
- **Copy:** plain ASCII in UI strings (no arrow glyphs).

---

## File Structure

**API** — `apps/api/src/lib/entitlements.ts` (+test), `apps/api/src/lib/aiRateLimit.ts` (+test), `apps/api/src/routes/ai.ts` (+test).
**Web** — `apps/web/lib/api/assistant.ts`, `apps/web/app/(protected)/assistant/page.tsx`, the badge + page tests.
**Mobile** — `apps/mobile/lib/config.ts`, `apps/mobile/hooks/useAiStatus.ts` (+test), `apps/mobile/app/(tabs)/assistant/index.tsx` (+test).

---

### Task 1: Per-family coverage predicate (`isPersonCoveredByFamily`)

**Files:**
- Modify: `apps/api/src/lib/entitlements.ts`
- Test: `apps/api/src/lib/__tests__/entitlements.test.ts`

**Interfaces:**
- Produces: `isPersonCoveredByFamily(personId, familyGroupId): Promise<boolean>` — entitling status (`ACTIVE`|`TRIALING`) AND paid (`stripePriceId !== null`) AND person is an active member within `seatCount` (order `joinedAt` asc, `id` asc).
- `isPersonCovered` refactored to OR the predicate over active memberships (behavior-preserving).

- [ ] **Step 1: Write the failing tests**

Append to `entitlements.test.ts` (add `isPersonCoveredByFamily` to imports):

```typescript
describe("isPersonCoveredByFamily", () => {
  it("is true for a paid family where the person is within seats", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5);
    expect(await isPersonCoveredByFamily(person.id, familyGroup.id)).toBe(true);
  });

  it("is false for a free-tier family", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, stripePriceId: null } });
    await subscribe(familyGroup.id, "FREE", 1);
    expect(await isPersonCoveredByFamily(person.id, familyGroup.id)).toBe(false);
  });

  it("is false for a PAST_DUE paid family", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5, "PAST_DUE");
    expect(await isPersonCoveredByFamily(person.id, familyGroup.id)).toBe(false);
  });

  it("is false for a member beyond seatCount (earliest-joined seated)", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    await paidTier("SOLO", 1);
    await subscribe(familyGroup.id, "SOLO", 1);
    const late = await db.person.create({ data: { firstName: "Late", lastName: "J", ageGateLevel: "ADULT", userId: null } });
    await db.familyMember.create({ data: { familyGroupId: familyGroup.id, personId: late.id, roles: [], permissions: [] } });
    expect(await isPersonCoveredByFamily(late.id, familyGroup.id)).toBe(false);
    expect(await isPersonCoveredByFamily(admin.id, familyGroup.id)).toBe(true);
  });

  it("is false for a suspended member of a paid family", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5);
    await db.familyMember.updateMany({
      where: { familyGroupId: familyGroup.id, personId: person.id },
      data: { suspendedAt: new Date() }
    });
    expect(await isPersonCoveredByFamily(person.id, familyGroup.id)).toBe(false);
  });

  it("is false for a family the person does not belong to", async () => {
    const person = await seedTestPerson();
    const other = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(other.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5);
    expect(await isPersonCoveredByFamily(person.id, familyGroup.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/lib/__tests__/entitlements.test.ts`
Expected: FAIL — `isPersonCoveredByFamily` not exported.

- [ ] **Step 3: Write minimal implementation**

In `entitlements.ts`, replace the `isPersonCovered` body (lines 18-49) with:

```typescript
export async function isPersonCoveredByFamily(
  personId: string,
  familyGroupId: string
): Promise<boolean> {
  const sub = await db.familySubscription.findUnique({
    where: { familyGroupId },
    select: { status: true, seatCount: true, pricingTier: { select: { stripePriceId: true } } }
  });
  if (!sub) return false;
  if (!ENTITLING_STATUSES.has(sub.status)) return false;
  if (sub.pricingTier.stripePriceId === null) return false; // free tier never covers

  const seated = await db.familyMember.findMany({
    where: { familyGroupId, suspendedAt: null },
    // `id` is a stable tiebreak so the seat boundary is deterministic when
    // two members share a joinedAt timestamp.
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    take: sub.seatCount,
    select: { personId: true }
  });
  return seated.some((m) => m.personId === personId);
}

// NOTE: O(memberships) — ~2 queries per family. Fine for the small number of
// families a person belongs to; collapse to one join if that ever grows.
export async function isPersonCovered(personId: string): Promise<boolean> {
  const memberships = await db.familyMember.findMany({
    where: { personId, suspendedAt: null },
    select: { familyGroupId: true }
  });
  for (const { familyGroupId } of memberships) {
    if (await isPersonCoveredByFamily(personId, familyGroupId)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/lib/__tests__/entitlements.test.ts`
Expected: PASS (existing `isPersonCovered` cases + new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/entitlements.ts apps/api/src/lib/__tests__/entitlements.test.ts
git commit -m "feat: P3-02 add isPersonCoveredByFamily predicate (refactor isPersonCovered)"
```

---

### Task 2: Context-aware entitlement resolver (`getAiEntitlementForUser`)

**Files:**
- Modify: `apps/api/src/lib/entitlements.ts`
- Test: `apps/api/src/lib/__tests__/entitlements.test.ts`

**Interfaces:**
- `interface AiEntitlement { covered: boolean; dailyLimit: number; foreignContext: boolean }`
- `getAiEntitlementForUser(userId, familyGroupId?): Promise<AiEntitlement>` — no person → `{ false, 3, !!familyGroupId }`.
- `getAiDailyLimitForUser(userId)` — unchanged signature; delegates.

- [ ] **Step 1: Write the failing tests**

Append to `entitlements.test.ts` (add `getAiEntitlementForUser`):

```typescript
describe("getAiEntitlementForUser", () => {
  it("covered, no family context: covered + 20 + not foreign", async () => {
    const person = await seedTestPerson({ userId: "clerk_ent_cov" });
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5);
    expect(await getAiEntitlementForUser("clerk_ent_cov")).toEqual({ covered: true, dailyLimit: AI_DAILY_LIMIT_COVERED, foreignContext: false });
  });

  it("covered, acting in a FREE family: covered + 20 + foreign true", async () => {
    const person = await seedTestPerson({ userId: "clerk_ent_mix" });
    const paid = await seedTestFamily(person.id);
    const free = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(paid.familyGroup.id, "PRO", 5);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, stripePriceId: null } });
    await subscribe(free.familyGroup.id, "FREE", 1);
    expect(await getAiEntitlementForUser("clerk_ent_mix", free.familyGroup.id)).toEqual({ covered: true, dailyLimit: AI_DAILY_LIMIT_COVERED, foreignContext: true });
  });

  it("uncovered, with a family: not covered + free + foreign", async () => {
    const person = await seedTestPerson({ userId: "clerk_ent_free" });
    const { familyGroup } = await seedTestFamily(person.id);
    expect(await getAiEntitlementForUser("clerk_ent_free", familyGroup.id)).toEqual({ covered: false, dailyLimit: AI_DAILY_LIMIT_FREE, foreignContext: true });
  });

  it("unknown user: not covered + free + not foreign (no family)", async () => {
    expect(await getAiEntitlementForUser("clerk_nobody")).toEqual({ covered: false, dailyLimit: AI_DAILY_LIMIT_FREE, foreignContext: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/lib/__tests__/entitlements.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Write minimal implementation**

In `entitlements.ts`, replace `getAiDailyLimitForUser` (lines 55-59) with:

```typescript
export interface AiEntitlement {
  covered: boolean;
  dailyLimit: number;
  foreignContext: boolean;
}

export async function getAiEntitlementForUser(
  userId: string,
  familyGroupId?: string
): Promise<AiEntitlement> {
  const person = await db.person.findUnique({ where: { userId }, select: { id: true } });
  if (!person) {
    return { covered: false, dailyLimit: AI_DAILY_LIMIT_FREE, foreignContext: !!familyGroupId };
  }
  const covered = await isPersonCovered(person.id);
  const dailyLimit = covered ? AI_DAILY_LIMIT_COVERED : AI_DAILY_LIMIT_FREE;
  const foreignContext = familyGroupId ? !(await isPersonCoveredByFamily(person.id, familyGroupId)) : false;
  return { covered, dailyLimit, foreignContext };
}

export async function getAiDailyLimitForUser(userId: string): Promise<number> {
  return (await getAiEntitlementForUser(userId)).dailyLimit;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/lib/__tests__/entitlements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/entitlements.ts apps/api/src/lib/__tests__/entitlements.test.ts
git commit -m "feat: P3-02 context-aware getAiEntitlementForUser (covered/limit/foreign)"
```

---

### Task 3: Context-aware rate limiter (global + foreign-aggregate)

**Files:**
- Modify: `apps/api/src/lib/aiRateLimit.ts`
- Test: `apps/api/src/lib/__tests__/aiRateLimit.test.ts`

**Interfaces:**
- `interface RateLimitContext { dailyLimit: number; foreign: boolean; foreignLimit: number }`
- `interface RateLimitResult { allowed: boolean; remaining: number; resetAt: Date; reason?: "global" | "foreign" }`
- `checkAndIncrementAiRateLimit(userId, ctx): Promise<RateLimitResult>`
- `getRateLimitStatus(userId, ctx): Promise<RateLimitResult>`

- [ ] **Step 1: Update the failing tests**

In `aiRateLimit.test.ts`:

1. Replace every `checkAndIncrementAiRateLimit(uid, 20)` with `checkAndIncrementAiRateLimit(uid, { dailyLimit: 20, foreign: false, foreignLimit: 3 })`, and likewise `getRateLimitStatus(uid, 20)` → `getRateLimitStatus(uid, { dailyLimit: 20, foreign: false, foreignLimit: 3 })`. The earlier free case uses `{ dailyLimit: 3, foreign: false, foreignLimit: 3 }`.

2. The existing "TTL" test now expects `expire` to be called on **every** increment (not just the first). Update its assertion to expect `expire(key, 86400)` on each call.

3. Add the foreign-context block:

```typescript
describe("foreign-context throttling", () => {
  const FOREIGN = { dailyLimit: 20, foreign: true, foreignLimit: 3 };

  it("blocks foreign requests after the foreign cap even with global remaining", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:foreign:user_fc:${today}`, "3");
    store.set(`ai:rate:user_fc:${today}`, "5");
    const result = await checkAndIncrementAiRateLimit("user_fc", FOREIGN);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("foreign");
  });

  it("blocks on global in a foreign context when global is exhausted", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_fg:${today}`, "20");
    const result = await checkAndIncrementAiRateLimit("user_fg", FOREIGN);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("global");
  });

  it("allows a foreign request and reports the tighter remaining", async () => {
    const result = await checkAndIncrementAiRateLimit("user_fok", FOREIGN);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2); // min(20-1, 3-1)
  });

  it("caps total foreign usage at foreignLimit across many calls (protect paying budget)", async () => {
    let last;
    for (let i = 0; i < 5; i++) last = await checkAndIncrementAiRateLimit("user_fcap", FOREIGN);
    expect(last?.allowed).toBe(false);
    expect(last?.reason).toBe("foreign");
    // global consumed at most foreignLimit, leaving >= dailyLimit - foreignLimit for paid context
    const today = new Date().toISOString().split("T")[0];
    expect(parseInt(store.get(`ai:rate:user_fcap:${today}`) ?? "0", 10)).toBeLessThanOrEqual(3);
  });

  it("status (read-only) reflects the foreign cap without incrementing", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:foreign:user_fs:${today}`, "2");
    store.set(`ai:rate:user_fs:${today}`, "4");
    const result = await getRateLimitStatus("user_fs", FOREIGN);
    expect(result.remaining).toBe(1); // min(20-4, 3-2)
    expect(store.get(`ai:rate:foreign:user_fs:${today}`)).toBe("2");
  });
});
```

> Reuse the existing mock-Redis `store` + `setRedisClient` harness in this file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run src/lib/__tests__/aiRateLimit.test.ts`
Expected: FAIL — TS errors on the context arg + foreign behavior missing.

- [ ] **Step 3: Apply the implementation**

Replace `aiRateLimit.ts` lines 27-100 (from `const TTL_SECONDS` through both functions) with:

```typescript
const TTL_SECONDS = 86400;

function todayUtcDate(): string {
  return new Date().toISOString().split("T")[0]; // YYYY-MM-DD UTC
}
function globalKey(userId: string): string {
  return `ai:rate:${userId}:${todayUtcDate()}`;
}
function foreignKey(userId: string): string {
  return `ai:rate:foreign:${userId}:${todayUtcDate()}`;
}

export interface RateLimitContext {
  /** Global per-person daily allowance (20 covered / 3 free) — the hard cap. */
  dailyLimit: number;
  /** True when the request is made in a family that does not cover this person. */
  foreign: boolean;
  /** Aggregate cap on foreign-context usage (bounds the bleed from the paying budget). */
  foreignLimit: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  reason?: "global" | "foreign";
}

function nextUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/**
 * Check + increment. Foreign-context requests check the foreign aggregate counter
 * FIRST, then the global counter. Daily reset is by the date in the key; the TTL
 * is set on EVERY increment (idempotent — closes the crash-between-INCR-and-EXPIRE
 * gap). The only foreign overcount is when the global cap also rejects (user already
 * blocked that day) — benign and self-clearing.
 */
export async function checkAndIncrementAiRateLimit(
  userId: string,
  ctx: RateLimitContext
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const resetAt = nextUtcMidnight();

  let foreignCount = 0;
  if (ctx.foreign) {
    const fKey = foreignKey(userId);
    foreignCount = await redis.incr(fKey);
    await redis.expire(fKey, TTL_SECONDS);
    if (foreignCount > ctx.foreignLimit) {
      return { allowed: false, remaining: 0, resetAt, reason: "foreign" };
    }
  }

  const gKey = globalKey(userId);
  const globalCount = await redis.incr(gKey);
  await redis.expire(gKey, TTL_SECONDS);
  if (globalCount > ctx.dailyLimit) {
    return { allowed: false, remaining: 0, resetAt, reason: "global" };
  }

  const globalRemaining = ctx.dailyLimit - globalCount;
  const remaining = ctx.foreign ? Math.min(globalRemaining, ctx.foreignLimit - foreignCount) : globalRemaining;
  return { allowed: true, remaining: Math.max(0, remaining), resetAt };
}

/** Read-only — does NOT increment. */
export async function getRateLimitStatus(
  userId: string,
  ctx: RateLimitContext
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const resetAt = nextUtcMidnight();

  const globalCount = parseInt((await redis.get(globalKey(userId))) ?? "0", 10);
  const globalRemaining = Math.max(0, ctx.dailyLimit - globalCount);

  let remaining = globalRemaining;
  if (ctx.foreign) {
    const foreignCount = parseInt((await redis.get(foreignKey(userId))) ?? "0", 10);
    remaining = Math.min(globalRemaining, Math.max(0, ctx.foreignLimit - foreignCount));
  }
  return { allowed: remaining > 0, remaining, resetAt };
}
```

(Keep lines 1-26 — the `getRedisClient`/`setRedisClient` block — unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run src/lib/__tests__/aiRateLimit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/aiRateLimit.ts apps/api/src/lib/__tests__/aiRateLimit.test.ts
git commit -m "feat: P3-02 context-aware AI limiter with foreign-aggregate throttle"
```

---

### Task 4: Wire foreign context into `POST /ai/chat`

**Files:**
- Modify: `apps/api/src/routes/ai.ts`
- Test: `apps/api/src/routes/__tests__/ai.test.ts`

**Interfaces:**
- Consumes: `getAiDailyLimit(personId)` (existing W2-core export), `isPersonCoveredByFamily` (Task 1), `AI_DAILY_LIMIT_FOREIGN` (entitlements); `checkAndIncrementAiRateLimit` (Task 3).

- [ ] **Step 1: Update the failing tests**

In `ai.test.ts`:

1. Replace the entitlements mock with:

```typescript
const mockGetAiDailyLimit = vi.fn();
const mockIsPersonCoveredByFamily = vi.fn();
const mockGetAiEntitlementForUser = vi.fn();

vi.mock("../../lib/entitlements", () => ({
  getAiDailyLimit: (...a: unknown[]) => mockGetAiDailyLimit(...a),
  isPersonCoveredByFamily: (...a: unknown[]) => mockIsPersonCoveredByFamily(...a),
  getAiEntitlementForUser: (...a: unknown[]) => mockGetAiEntitlementForUser(...a),
  AI_DAILY_LIMIT_FOREIGN: 3
}));
```

2. In `beforeEach`, default to a paid (non-foreign) covered context:

```typescript
mockGetAiDailyLimit.mockResolvedValue(20);
mockIsPersonCoveredByFamily.mockResolvedValue(true);
mockGetAiEntitlementForUser.mockResolvedValue({ covered: true, dailyLimit: 20, foreignContext: false });
```

3. Replace the prior limit assertion with a foreign-context case:

```typescript
it("passes a foreign context to the limiter when the family doesn't cover the person", async () => {
  mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
  mockPersonFindUnique.mockResolvedValue(PERSON);
  mockFamilyMemberFindUnique.mockResolvedValue(MEMBERSHIP);
  mockGetAiDailyLimit.mockResolvedValue(20);
  mockIsPersonCoveredByFamily.mockResolvedValue(false);
  mockCheckAndIncrement.mockResolvedValue(ALLOWED_RATE);

  const app = createApp();
  await request(app).post("/api/v1/ai/chat").send(VALID_BODY);

  expect(mockCheckAndIncrement).toHaveBeenCalledWith("clerk_user1", { dailyLimit: 20, foreign: true, foreignLimit: 3 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run src/routes/__tests__/ai.test.ts`
Expected: FAIL.

- [ ] **Step 3: Apply the implementation**

In `ai.ts`:

1. Replace the entitlements import (line 20) with:

```typescript
import { getAiDailyLimit, getAiEntitlementForUser, isPersonCoveredByFamily, AI_DAILY_LIMIT_FOREIGN } from "../lib/entitlements";
```

2. Replace the rate-limit block (lines 83-93) with:

```typescript
  // 4. Rate limit; throttle foreign (unpaid) family contexts first so they can't
  //    cannibalize the budget the paying family funds.
  const dailyLimit = await getAiDailyLimit(person.id);
  const paidContext = await isPersonCoveredByFamily(person.id, familyGroupId);
  const rateLimit = await checkAndIncrementAiRateLimit(userId, { dailyLimit, foreign: !paidContext, foreignLimit: AI_DAILY_LIMIT_FOREIGN });
  if (!rateLimit.allowed) {
    const message =
      rateLimit.reason === "foreign"
        ? "You've used your shared AI allowance for families that don't cover you. Ask an admin to upgrade this family for full access."
        : `You've reached your daily limit of ${dailyLimit} AI queries. It resets at midnight UTC.`;
    res.status(429).json({ error: "Daily AI limit reached", reason: rateLimit.reason, resetAt: rateLimit.resetAt, message });
    return;
  }
```

- [ ] **Step 4: Run tests + type-check**

Run: `cd apps/api && npx vitest run src/routes/__tests__/ai.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/ai.ts apps/api/src/routes/__tests__/ai.test.ts
git commit -m "feat: P3-02 throttle foreign-context AI usage in /chat"
```

---

### Task 5: Context-aware, membership-validated `GET /ai/status`

**Files:**
- Modify: `apps/api/src/routes/ai.ts`
- Test: `apps/api/src/routes/__tests__/ai.test.ts`

**Interfaces:**
- Consumes: `getAiEntitlementForUser` (Task 2), `getRateLimitStatus` (Task 3), `AI_DAILY_LIMIT_FOREIGN`, `activeFamilyMembership` (already imported, ai.ts:27), `db`.
- Produces: `GET /ai/status?familyGroupId=` → `{ queriesUsedToday, queriesRemaining, dailyLimit, effectiveLimit, covered, foreignContext, resetAt }`. The `familyGroupId` param is honored **only** if the requester is an active member; otherwise ignored.

- [ ] **Step 1: Update the failing tests**

Replace the `/status` describe's free-tier test with two cases:

```typescript
it("returns context-aware entitlement for a foreign covered context (member)", async () => {
  mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
  mockPersonFindUnique.mockResolvedValue(PERSON);
  mockFamilyMemberFindUnique.mockResolvedValue(MEMBERSHIP); // active member of fg1
  mockGetAiEntitlementForUser.mockResolvedValue({ covered: true, dailyLimit: 20, foreignContext: true });
  mockGetRateLimitStatus.mockResolvedValue({ allowed: true, remaining: 2, resetAt: new Date() });

  const app = createApp();
  const res = await request(app).get("/api/v1/ai/status?familyGroupId=fg1");

  expect(mockGetAiEntitlementForUser).toHaveBeenCalledWith("clerk_user1", "fg1");
  expect(mockGetRateLimitStatus).toHaveBeenCalledWith("clerk_user1", { dailyLimit: 20, foreign: true, foreignLimit: 3 });
  expect(res.body).toMatchObject({ covered: true, foreignContext: true, dailyLimit: 20, effectiveLimit: 3, queriesRemaining: 2, queriesUsedToday: 1 });
});

it("ignores familyGroupId when the requester is not a member (isolation)", async () => {
  mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
  mockPersonFindUnique.mockResolvedValue(PERSON);
  mockFamilyMemberFindUnique.mockResolvedValue(null); // NOT a member of the supplied family
  mockGetAiEntitlementForUser.mockResolvedValue({ covered: true, dailyLimit: 20, foreignContext: false });
  mockGetRateLimitStatus.mockResolvedValue({ allowed: true, remaining: 20, resetAt: new Date() });

  const app = createApp();
  await request(app).get("/api/v1/ai/status?familyGroupId=someone_elses_family");

  // family context dropped -> resolver called WITHOUT the family id
  expect(mockGetAiEntitlementForUser).toHaveBeenCalledWith("clerk_user1", undefined);
});
```

> If `activeFamilyMembership` is used directly (not the Prisma mock) in this file, mock it alongside the existing mocks following the file's pattern; `mockFamilyMemberFindUnique` stands in here for whatever membership lookup the file already mocks.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run src/routes/__tests__/ai.test.ts`
Expected: FAIL.

- [ ] **Step 3: Apply the implementation**

Replace the `/status` handler (lines 168-179) with:

```typescript
aiRouter.get("/status", async (req: Request, res: Response): Promise<void> => {
  const { userId } = authed(req);
  const rawFamilyGroupId = typeof req.query.familyGroupId === "string" ? req.query.familyGroupId : undefined;

  // Only honor a family context the requester actually belongs to (parity with /chat).
  let familyGroupId: string | undefined = undefined;
  if (rawFamilyGroupId) {
    const person = await db.person.findUnique({ where: { userId }, select: { id: true } });
    if (person && (await activeFamilyMembership(rawFamilyGroupId, person.id))) {
      familyGroupId = rawFamilyGroupId;
    }
  }

  const { covered, dailyLimit, foreignContext } = await getAiEntitlementForUser(userId, familyGroupId);
  const status = await getRateLimitStatus(userId, { dailyLimit, foreign: foreignContext, foreignLimit: AI_DAILY_LIMIT_FOREIGN });
  const effectiveLimit = foreignContext ? Math.min(dailyLimit, AI_DAILY_LIMIT_FOREIGN) : dailyLimit;

  res.json({
    queriesUsedToday: effectiveLimit - status.remaining,
    queriesRemaining: status.remaining,
    dailyLimit,
    effectiveLimit,
    covered,
    foreignContext,
    resetAt: status.resetAt
  });
});
```

- [ ] **Step 4: Full API suite + type-check**

Run: `cd apps/api && npx vitest run && npx tsc --noEmit`
Expected: all PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/ai.ts apps/api/src/routes/__tests__/ai.test.ts
git commit -m "feat: P3-02 membership-validated context-aware GET /ai/status"
```

---

### Task 6: Web — status client, badge, and page wiring (one building commit)

**Files:**
- Modify: `apps/web/lib/api/assistant.ts`
- Modify: `apps/web/app/(protected)/assistant/page.tsx`
- Test: `apps/web/src/components/assistant/__tests__/RateLimitBadge.test.tsx`

**Why one commit:** the client interface change and the page that consumes it must land together so every commit type-checks.

- [ ] **Step 1: Write the failing test**

Add to `RateLimitBadge.test.tsx`:

```typescript
it("respects an explicit total (free/foreign tier)", () => {
  render(<RateLimitBadge queriesRemaining={1} total={3} />);
  expect(screen.getByText(/1 \/ 3 queries left/)).toBeInTheDocument();
  expect(screen.getByLabelText("2 of 3 AI queries used today")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test (characterization)**

Run: `cd apps/web && npx vitest run src/components/assistant/__tests__/RateLimitBadge.test.tsx`
Expected: PASS — badge already honors `total`; locks the contract.

- [ ] **Step 3: Extend the client**

Replace `apps/web/lib/api/assistant.ts` lines 3-18 with:

```typescript
export interface AiStatus {
  queriesUsedToday: number;
  queriesRemaining: number;
  dailyLimit: number;
  effectiveLimit: number;
  covered: boolean;
  foreignContext: boolean;
  resetAt: string;
}

type GetToken = () => Promise<string | null>;

export async function getAiStatus(getToken: GetToken, familyGroupId?: string): Promise<AiStatus> {
  const token = await getToken();
  const qs = familyGroupId ? `?familyGroupId=${encodeURIComponent(familyGroupId)}` : "";
  const res = await fetch(`${API_BASE}/api/v1/ai/status${qs}`, { headers: { Authorization: `Bearer ${token ?? ""}` } });
  if (!res.ok) throw new Error("Failed to fetch AI status");
  return res.json() as Promise<AiStatus>;
}
```

- [ ] **Step 4: Wire the page**

In `apps/web/app/(protected)/assistant/page.tsx`:

1. Status query passes the family context (replace lines 37-42):

```typescript
  const statusQuery = useQuery({
    queryKey: ["aiStatus", familyId],
    queryFn: () => getAiStatus(getToken, familyId ?? undefined),
    enabled: !!familyId,
    refetchInterval: false
  });
```

2. Derive the effective limit (replace line 46):

```typescript
  const effectiveLimit = statusQuery.data?.effectiveLimit ?? 20;
  const queriesRemaining = statusQuery.data?.queriesRemaining ?? effectiveLimit;
```

3. Pass the real total to the badge (replace line 94):

```typescript
          <RateLimitBadge queriesRemaining={queriesRemaining} total={effectiveLimit} />
```

- [ ] **Step 5: Test + type-check**

Run: `cd apps/web && npx vitest run src/components/assistant/__tests__/RateLimitBadge.test.tsx && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/api/assistant.ts "apps/web/app/(protected)/assistant/page.tsx" apps/web/src/components/assistant/__tests__/RateLimitBadge.test.tsx
git commit -m "feat: P3-02 web AI status reflects real per-person effective limit"
```

---

### Task 7: Web upgrade CTA (free + foreign variants)

**Files:**
- Modify: `apps/web/app/(protected)/assistant/page.tsx`
- Test: `apps/web/src/app/(protected)/assistant/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `page.test.tsx`, following the file's existing `@/lib/api/assistant` mock, add (vary only the `getAiStatus` resolved value per case; statuses must include the new fields):

```typescript
it("shows the upgrade CTA for an uncovered (free) user", async () => {
  // getAiStatus -> { queriesUsedToday:1, queriesRemaining:2, dailyLimit:3, effectiveLimit:3, covered:false, foreignContext:true, resetAt }
  renderAssistantPage();
  expect(await screen.findByRole("link", { name: /upgrade/i })).toBeInTheDocument();
});

it("shows the CTA for a covered user acting in a foreign family", async () => {
  // getAiStatus -> { ...covered:true, foreignContext:true, effectiveLimit:3, dailyLimit:20 }
  renderAssistantPage();
  expect(await screen.findByRole("link", { name: /upgrade/i })).toBeInTheDocument();
});

it("hides the CTA for a covered user in a paid family", async () => {
  // getAiStatus -> { ...covered:true, foreignContext:false, effectiveLimit:20, dailyLimit:20 }
  renderAssistantPage();
  await screen.findByText(/Family Assistant/i);
  expect(screen.queryByRole("link", { name: /upgrade/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run "src/app/(protected)/assistant/__tests__/page.test.tsx"`
Expected: FAIL — no CTA.

- [ ] **Step 3: Apply the implementation**

In `page.tsx`:

1. Add import (after line 3): `import Link from "next/link";`

2. After the `effectiveLimit` derivation, add:

```typescript
  const showUpgrade = !!statusQuery.data && (!statusQuery.data.covered || statusQuery.data.foreignContext);
```

3. Insert directly above `<ChatInput .../>` (before line 128):

```typescript
      {showUpgrade && (
        <Link
          href="/settings/billing"
          className="text-sm rounded-lg px-3 py-2 text-center"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        >
          {queriesRemaining === 0
            ? `You've used your ${effectiveLimit} AI queries here today. Upgrade this family for 20/day.`
            : `${effectiveLimit} AI queries/day here. Upgrade this family for 20/day.`}
        </Link>
      )}
```

- [ ] **Step 4: Full web suite + type-check**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit`
Expected: all PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(protected)/assistant/page.tsx" "apps/web/src/app/(protected)/assistant/__tests__/page.test.tsx"
git commit -m "feat: P3-02 web upgrade CTA for free/foreign AI contexts"
```

---

### Task 8: Mobile config + `useAiStatus` hook

**Files:**
- Modify: `apps/mobile/lib/config.ts`
- Create: `apps/mobile/hooks/useAiStatus.ts`
- Test: `apps/mobile/__tests__/hooks/useAiStatus.test.ts`

**Interfaces:**
- `WEB_BASE: string`; `ENABLE_WEB_UPSELL: boolean` (off by default — IAP guard).
- `interface AiStatus { ... }` (same shape as web); `useAiStatus(familyId: string | null)`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/hooks/useAiStatus.test.ts` mirroring `__tests__/hooks/useFamily.test.ts`:

```typescript
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useAiStatus } from "../../hooks/useAiStatus";

const mockApiFetch = jest.fn();
jest.mock("../../lib/api", () => ({ useApiFetch: () => mockApiFetch }));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => mockApiFetch.mockReset());

it("fetches status for the given family", async () => {
  mockApiFetch.mockResolvedValue({ queriesRemaining: 2, effectiveLimit: 3, covered: false, foreignContext: true });
  const { result } = renderHook(() => useAiStatus("fg1"), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(mockApiFetch).toHaveBeenCalledWith("/api/v1/ai/status?familyGroupId=fg1");
  expect(result.current.data?.foreignContext).toBe(true);
});

it("is disabled and does not fetch when familyId is null", () => {
  const { result } = renderHook(() => useAiStatus(null), { wrapper });
  expect(result.current.fetchStatus).toBe("idle");
  expect(mockApiFetch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && npx jest __tests__/hooks/useAiStatus.test.ts`
Expected: FAIL — hook does not exist.

- [ ] **Step 3: Implement config + hook**

Append to `apps/mobile/lib/config.ts`:

```typescript
export const WEB_BASE = process.env.EXPO_PUBLIC_WEB_URL ?? "http://localhost:3000";
// Web-link upsell is OFF by default: shipping a web purchase link for a digital
// upgrade in a store build risks App Store rejection (IAP). Enable only for
// internal/TestFlight beta builds.
export const ENABLE_WEB_UPSELL = process.env.EXPO_PUBLIC_ENABLE_WEB_UPSELL === "true";
```

Create `apps/mobile/hooks/useAiStatus.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { useApiFetch } from "../lib/api";

export interface AiStatus {
  queriesUsedToday: number;
  queriesRemaining: number;
  dailyLimit: number;
  effectiveLimit: number;
  covered: boolean;
  foreignContext: boolean;
  resetAt: string;
}

export function useAiStatus(familyId: string | null) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["aiStatus", familyId],
    queryFn: () => apiFetch<AiStatus>(`/api/v1/ai/status?familyGroupId=${encodeURIComponent(familyId ?? "")}`),
    enabled: familyId !== null,
    refetchInterval: false
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && npx jest __tests__/hooks/useAiStatus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/config.ts apps/mobile/hooks/useAiStatus.ts apps/mobile/__tests__/hooks/useAiStatus.test.ts
git commit -m "feat: P3-02 mobile useAiStatus hook + WEB_BASE/ENABLE_WEB_UPSELL config"
```

---

### Task 9: Mobile assistant — usage badge + (flag-gated) upgrade CTA

**Files:**
- Modify: `apps/mobile/app/(tabs)/assistant/index.tsx`
- Test: `apps/mobile/__tests__/screens/assistant.test.tsx`

**Interfaces:**
- Consumes: `useAiStatus` (Task 8), `WEB_BASE` + `ENABLE_WEB_UPSELL` (Task 8), `Linking` (react-native).

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/screens/assistant.test.tsx`. Mock the hooks the screen uses (`useChat`, `useMyFamilies`, `useAiStatus`) and `Linking`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react-native";
import { Linking } from "react-native";
import AssistantScreen from "../../app/(tabs)/assistant/index";

jest.mock("@clerk/clerk-expo", () => ({ useAuth: () => ({ getToken: jest.fn() }) }));
jest.mock("@ai-sdk/react", () => ({ useChat: () => ({ messages: [], status: "ready", sendMessage: jest.fn() }) }));
jest.mock("../../hooks/useFamily", () => ({ useMyFamilies: () => ({ data: { memberships: [{ familyGroup: { id: "fg1", name: "Fam" } }] } }) }));

const mockUseAiStatus = jest.fn();
jest.mock("../../hooks/useAiStatus", () => ({ useAiStatus: () => mockUseAiStatus() }));
jest.mock("../../lib/config", () => ({ API_BASE: "http://x", WEB_BASE: "http://web", ENABLE_WEB_UPSELL: true }));

beforeEach(() => {
  mockUseAiStatus.mockReturnValue({ data: { queriesRemaining: 2, effectiveLimit: 3, covered: false, foreignContext: true } });
});

it("shows the usage badge", () => {
  render(<AssistantScreen />);
  expect(screen.getByText(/2 \/ 3 AI queries left today/)).toBeTruthy();
});

it("opens web billing when the upgrade CTA is pressed (flag on)", () => {
  const spy = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
  render(<AssistantScreen />);
  fireEvent.press(screen.getByText(/Upgrade this family/));
  expect(spy).toHaveBeenCalledWith("http://web/settings/billing");
});
```

> If the repo's mobile test setup differs (e.g., a shared render helper or expo-router mock), follow the existing screen-test pattern; the assertions above are the contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && npx jest __tests__/screens/assistant.test.tsx`
Expected: FAIL — no badge/CTA.

- [ ] **Step 3: Apply the implementation**

In `apps/mobile/app/(tabs)/assistant/index.tsx`:

1. Add imports:

```typescript
import { Linking } from "react-native";
import { useAiStatus } from "../../../hooks/useAiStatus";
import { WEB_BASE, ENABLE_WEB_UPSELL } from "../../../lib/config";
```

2. After the `familyId` line (line 17):

```typescript
  const aiStatus = useAiStatus(familyId);
  const showUpgrade = ENABLE_WEB_UPSELL && !!aiStatus.data && (!aiStatus.data.covered || aiStatus.data.foreignContext);
```

3. Insert above the input row (immediately before `<View className="flex-row items-center gap-3 px-4 py-3 border-t border-slate-800">`):

```typescript
      {aiStatus.data && (
        <View className="px-4 pt-2">
          <Text className="text-slate-400 text-xs">
            {aiStatus.data.queriesRemaining} / {aiStatus.data.effectiveLimit} AI queries left today
          </Text>
          {showUpgrade && (
            <Text className="text-indigo-400 text-xs mt-1" onPress={() => void Linking.openURL(`${WEB_BASE}/settings/billing`)}>
              Upgrade this family for 20/day
            </Text>
          )}
        </View>
      )}
```

- [ ] **Step 4: Type-check + mobile tests**

Run: `cd apps/mobile && npx tsc --noEmit && npx jest`
Expected: no type errors; all pass.

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/app/(tabs)/assistant/index.tsx" apps/mobile/__tests__/screens/assistant.test.tsx
git commit -m "feat: P3-02 mobile AI usage badge + flag-gated upgrade CTA"
```

---

## Self-Review

- **Spec coverage (design §4):** attribution = existing data; no-spillover = core; surfacing = Tasks 5–9; degrade-foreign-first = Tasks 1,3,4,5. ✓
- **Council round-1 dispositions folded in:** BLOCKER (/status auth) = Task 5 membership check; limiter TTL-on-every-incr = Task 3; protect-paying semantics = header + Task 3 test; N+1 = header + Task 1 note; mobile IAP = Task 8 flag, off by default; non-building intermediate = Tasks 6 merged; foreign concurrency/boundary tests = Tasks 1 & 3; ASCII copy = Tasks 7 & 9. (Rejected: the `getAiDailyLimit` "rename" BLOCKER — that export exists in W2-core and is already used by `/chat`.) ✓
- **Placeholder scan:** all code steps carry real code; UI-test arrange comments give exact mock values + point at existing mock helpers. ✓
- **Type consistency:** `RateLimitContext`/`RateLimitResult{reason}` identical across limiter/chat/status/tests; `AiEntitlement{covered,dailyLimit,foreignContext}` flows api→/status→web `AiStatus`→mobile `AiStatus`; `effectiveLimit`/`foreignContext`/`isPersonCoveredByFamily` names match end-to-end. ✓

## Appendix — council review trail

### Plan gate, round 1 (2026-06-24, Codex/GPT)
- **BLOCKER /status auth** → ACCEPTED, fixed (Task 5 membership validation).
- **BLOCKER getAiDailyLimit "rename"** → REJECTED: `getAiDailyLimit(personId)` is an existing W2-core export already imported by `/chat`; no break. (Same basis voids the related mock-migration MAJOR.)
- **MAJOR limiter atomicity (INCR+EXPIRE, two-counter)** → mitigated: TTL set on every increment; overcount only co-occurs with global block (benign). Lua noted as future option.
- **MAJOR protect-paying semantics** → clarified: foreign ≤ foreignLimit *of* the global hard cap, by design (header).
- **MAJOR N+1 in isPersonCovered** → acknowledged in code comment; acceptable at small family counts.
- **MAJOR mobile IAP** → mitigated: CTA behind `ENABLE_WEB_UPSELL`, off by default.
- **MINORs** → folded: foreign concurrency/cap test (Task 3), predicate boundary tests (Task 1), non-building intermediate commit removed (Task 6 merge), mobile null-not-called assertion (Task 8), mobile CTA test (Task 9), ASCII copy.
