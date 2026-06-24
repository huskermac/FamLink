# W2b — AI Entitlement Surfacing & Upsell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI usage UI tell the truth about a person's entitlement — show the real per-person daily limit (3 free / 20 covered), and turn the free-tier ceiling into a contextual "upgrade your family" conversion moment.

**Architecture:** W2-core (merged via PR #1) already resolves coverage server-side (`entitlements.ts`) and gates the limiter. W2b only *surfaces* that state: extend `GET /ai/status` to return `covered` + `dailyLimit`, fix the web badge that currently hardcodes "/20" (so free users see the wrong number today), and add an upgrade CTA for uncovered users. No new DB state; coverage stays read-time-derived.

**Tech Stack:** TypeScript, Express, Prisma (`@famlink/db`), Redis (ioredis), Next.js (App Router, web), React Query, Vitest + @testing-library/react, supertest.

## Scope decision (READ FIRST — two deliberate deferrals)

The W2 design (§4) lists four mechanics. This plan ships the two that carry clear, immediate value and **defers two on purpose**:

- ✅ **Per-person attribution** — *already done.* `AssistantMessage` persists `personId` + `familyGroupId` on every chat turn (schema.prisma:284-285; ai.ts:137-154). No new work; the data exists if analytics ever needs it.
- ✅ **Free-vs-covered surfacing + near-limit upsell** — this plan.
- ✅ **No spillover** — *already guaranteed* by the per-person core (a covered person's actions are covered; non-covered members get the free baseline). No work.
- ⛔ **"Degrade foreign/unpaid context first" (design §4b) — DEFERRED.** Rationale: it requires replacing the single per-user/day Redis counter with per-(person×family) sub-counters plus a consumption-ordering policy. It is also in tension with the per-person model the core actually shipped: entitlement is **one** allowance per person (OR-coverage), not a per-family pool — so there is no per-family "paying relationship" budget to protect. The scenario it optimizes (a covered person heavily using AI across both a paying and a non-paying family and hitting the cap) is rare and low-harm. YAGNI. Revisit only if real usage shows abuse. *If Steve wants it, it is its own plan (W2c).*
- ⛔ **Mobile surfacing/upsell — DEFERRED.** The mobile assistant screen has **no** AI-status UI today (no badge, no status fetch) and mobile has **no** billing/checkout surface. A mobile upsell→payment flow opens an app-store IAP-vs-web-checkout question that should not be rushed into this plan. Web is the conversion surface. *Mobile parity is a follow-on.*

---

## Global Constraints

- **Test runner:** Vitest. API tests: `cd apps/api && npx vitest run <path>`. Web tests: `cd apps/web && npx vitest run <path>`.
- **Commit format:** `feat: P3-02 <short description>` (W2b is part of P3-02).
- **Entitlement is derived at read-time — never materialized.** No new DB columns or migrations in this plan.
- **Do NOT use `FamilySubscription.grandfathered`** as an entitlement lever (Stripe legacy-pricing flag only).
- **Allowance constants live in `entitlements.ts`:** `AI_DAILY_LIMIT_COVERED = 20`, `AI_DAILY_LIMIT_FREE = 3`. Never hardcode these numbers in routes or UI — read them from the API.
- **`/ai/status` response shape (target):** `{ queriesUsedToday, queriesRemaining, dailyLimit, covered, resetAt }`.

---

## File Structure

- **Modify** `apps/api/src/lib/entitlements.ts` — add `getAiEntitlementForUser` (covered + dailyLimit in one resolve); refactor `getAiDailyLimitForUser` to delegate to it (keeps it DRY and its tests green).
- **Modify** `apps/api/src/lib/__tests__/entitlements.test.ts` — tests for the new resolver.
- **Modify** `apps/api/src/routes/ai.ts` — `/status` returns `covered` + `dailyLimit`.
- **Modify** `apps/api/src/routes/__tests__/ai.test.ts` — swap the `getAiDailyLimitForUser` mock for `getAiEntitlementForUser`; assert the new fields.
- **Modify** `apps/web/lib/api/assistant.ts` — extend the `AiStatus` interface.
- **Modify** `apps/web/src/components/assistant/__tests__/RateLimitBadge.test.tsx` — guard the explicit-`total` (free-tier) case.
- **Modify** `apps/web/app/(protected)/assistant/page.tsx` — pass the real `total` to the badge (fixes the "/20" bug) and render the upgrade CTA for uncovered users.
- **Modify** `apps/web/src/app/(protected)/assistant/__tests__/page.test.tsx` — badge-shows-real-limit + upsell visibility tests.

---

### Task 1: Combined entitlement resolver (`getAiEntitlementForUser`)

**Files:**
- Modify: `apps/api/src/lib/entitlements.ts`
- Test: `apps/api/src/lib/__tests__/entitlements.test.ts`

**Interfaces:**
- Consumes: `isPersonCovered`, `AI_DAILY_LIMIT_COVERED`, `AI_DAILY_LIMIT_FREE` (existing).
- Produces:
  - `interface AiEntitlement { covered: boolean; dailyLimit: number }`
  - `getAiEntitlementForUser(userId: string): Promise<AiEntitlement>` — one `Person` lookup by Clerk `userId`; `{ covered: false, dailyLimit: AI_DAILY_LIMIT_FREE }` if no person.
  - `getAiDailyLimitForUser(userId: string): Promise<number>` — unchanged signature; now delegates to `getAiEntitlementForUser`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/lib/__tests__/entitlements.test.ts` — extend the import to include `getAiEntitlementForUser`, then append this block at the end of the file:

```typescript
describe("getAiEntitlementForUser", () => {
  it("returns covered + the covered limit for a covered user", async () => {
    const person = await seedTestPerson({ userId: "clerk_ent_cov" });
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5);
    expect(await getAiEntitlementForUser("clerk_ent_cov")).toEqual({
      covered: true,
      dailyLimit: AI_DAILY_LIMIT_COVERED
    });
  });

  it("returns not-covered + the free limit for an uncovered user", async () => {
    await seedTestPerson({ userId: "clerk_ent_free" });
    expect(await getAiEntitlementForUser("clerk_ent_free")).toEqual({
      covered: false,
      dailyLimit: AI_DAILY_LIMIT_FREE
    });
  });

  it("returns not-covered + the free limit for an unknown user", async () => {
    expect(await getAiEntitlementForUser("clerk_ent_nobody")).toEqual({
      covered: false,
      dailyLimit: AI_DAILY_LIMIT_FREE
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/lib/__tests__/entitlements.test.ts`
Expected: FAIL — `getAiEntitlementForUser` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/lib/entitlements.ts`, add the interface + resolver and refactor `getAiDailyLimitForUser` to delegate. Replace the existing `getAiDailyLimitForUser` (lines 55-59) with:

```typescript
export interface AiEntitlement {
  covered: boolean;
  dailyLimit: number;
}

export async function getAiEntitlementForUser(userId: string): Promise<AiEntitlement> {
  const person = await db.person.findUnique({ where: { userId }, select: { id: true } });
  const covered = person ? await isPersonCovered(person.id) : false;
  return { covered, dailyLimit: covered ? AI_DAILY_LIMIT_COVERED : AI_DAILY_LIMIT_FREE };
}

export async function getAiDailyLimitForUser(userId: string): Promise<number> {
  return (await getAiEntitlementForUser(userId)).dailyLimit;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/lib/__tests__/entitlements.test.ts`
Expected: PASS (existing cases + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/entitlements.ts apps/api/src/lib/__tests__/entitlements.test.ts
git commit -m "feat: P3-02 add getAiEntitlementForUser (covered + dailyLimit resolver)"
```

---

### Task 2: `/ai/status` returns `covered` + `dailyLimit`

**Files:**
- Modify: `apps/api/src/routes/ai.ts`
- Test: `apps/api/src/routes/__tests__/ai.test.ts`

**Interfaces:**
- Consumes: `getAiEntitlementForUser` (Task 1); `getRateLimitStatus` (existing).
- Produces: `GET /api/v1/ai/status` → `{ queriesUsedToday, queriesRemaining, dailyLimit, covered, resetAt }`.

- [ ] **Step 1: Update the failing tests**

In `apps/api/src/routes/__tests__/ai.test.ts`:

1. In the `entitlements` mock, replace `getAiDailyLimitForUser` with `getAiEntitlementForUser`:

```typescript
const mockGetAiDailyLimit = vi.fn();
const mockGetAiEntitlementForUser = vi.fn();

vi.mock("../../lib/entitlements", () => ({
  getAiDailyLimit: (...args: unknown[]) => mockGetAiDailyLimit(...args),
  getAiEntitlementForUser: (...args: unknown[]) => mockGetAiEntitlementForUser(...args)
}));
```

2. In `beforeEach`, default the new mock to a covered entitlement (keeps existing `/status` tests' math at 20):

```typescript
mockGetAiDailyLimit.mockResolvedValue(20);
mockGetAiEntitlementForUser.mockResolvedValue({ covered: true, dailyLimit: 20 });
```

3. Replace the existing free-tier `/status` test (the one that called `mockGetAiDailyLimitForUser.mockResolvedValue(3)`) with:

```typescript
it("returns covered + dailyLimit and computes usage from the free limit", async () => {
  mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
  mockGetAiEntitlementForUser.mockResolvedValue({ covered: false, dailyLimit: 3 });
  mockGetRateLimitStatus.mockResolvedValue({ allowed: true, remaining: 1, resetAt: new Date() });

  const app = createApp();
  const res = await request(app).get("/api/v1/ai/status");

  expect(mockGetRateLimitStatus).toHaveBeenCalledWith("clerk_user1", 3);
  expect(res.body.covered).toBe(false);
  expect(res.body.dailyLimit).toBe(3);
  expect(res.body.queriesRemaining).toBe(1);
  expect(res.body.queriesUsedToday).toBe(2); // 3 - 1
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run src/routes/__tests__/ai.test.ts`
Expected: FAIL — `res.body.covered`/`res.body.dailyLimit` are undefined; `getAiEntitlementForUser` mock not called.

- [ ] **Step 3: Apply the implementation**

In `apps/api/src/routes/ai.ts`:

1. Change the entitlements import (line 20) from:

```typescript
import { getAiDailyLimit, getAiDailyLimitForUser } from "../lib/entitlements";
```

to:

```typescript
import { getAiDailyLimit, getAiEntitlementForUser } from "../lib/entitlements";
```

2. Replace the `/status` handler body (lines 168-179) with:

```typescript
aiRouter.get("/status", async (req: Request, res: Response): Promise<void> => {
  const { userId } = authed(req);

  const { covered, dailyLimit } = await getAiEntitlementForUser(userId);
  const status = await getRateLimitStatus(userId, dailyLimit);

  res.json({
    queriesUsedToday: dailyLimit - status.remaining,
    queriesRemaining: status.remaining,
    dailyLimit,
    covered,
    resetAt: status.resetAt
  });
});
```

- [ ] **Step 4: Run tests + type-check**

Run: `cd apps/api && npx vitest run src/routes/__tests__/ai.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors (the old `getAiDailyLimitForUser` import is gone from `ai.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/ai.ts apps/api/src/routes/__tests__/ai.test.ts
git commit -m "feat: P3-02 expose covered + dailyLimit in GET /ai/status"
```

---

### Task 3: Fix the web badge to show the real limit

**Files:**
- Modify: `apps/web/lib/api/assistant.ts`
- Modify: `apps/web/app/(protected)/assistant/page.tsx`
- Test: `apps/web/src/components/assistant/__tests__/RateLimitBadge.test.tsx`

**Why:** `RateLimitBadge` defaults `total = 20` and the page never passes `total`, so a free-tier user (3/day) currently sees "/20 queries left" — wrong. The badge already supports an explicit `total`; the page must pass it.

**Interfaces:**
- Consumes: the extended `AiStatus` (`dailyLimit`, `covered`).
- Produces: `AiStatus` with `dailyLimit: number` and `covered: boolean`.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/components/assistant/__tests__/RateLimitBadge.test.tsx`:

```typescript
it("respects an explicit total (free tier)", () => {
  render(<RateLimitBadge queriesRemaining={1} total={3} />);
  expect(screen.getByText(/1 \/ 3 queries left/)).toBeInTheDocument();
  expect(screen.getByLabelText("2 of 3 AI queries used today")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it passes (characterization)**

Run: `cd apps/web && npx vitest run src/components/assistant/__tests__/RateLimitBadge.test.tsx`
Expected: PASS — the badge component already honors `total`. This test *locks in* the contract the page must now use. (If it fails, the badge is broken and must be fixed before proceeding.)

- [ ] **Step 3: Extend the `AiStatus` interface**

In `apps/web/lib/api/assistant.ts`, replace the `AiStatus` interface (lines 3-7) with:

```typescript
export interface AiStatus {
  queriesUsedToday: number;
  queriesRemaining: number;
  dailyLimit: number;
  covered: boolean;
  resetAt: string;
}
```

- [ ] **Step 4: Pass the real total in the page**

In `apps/web/app/(protected)/assistant/page.tsx`:

1. Replace the `queriesRemaining` derivation (line 46) with:

```typescript
  const dailyLimit = statusQuery.data?.dailyLimit ?? 20;
  const queriesRemaining = statusQuery.data?.queriesRemaining ?? dailyLimit;
```

2. Replace the badge render (line 94) with:

```typescript
          <RateLimitBadge queriesRemaining={queriesRemaining} total={dailyLimit} />
```

- [ ] **Step 5: Type-check the web app**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/api/assistant.ts apps/web/app/(protected)/assistant/page.tsx apps/web/src/components/assistant/__tests__/RateLimitBadge.test.tsx
git commit -m "feat: P3-02 show the real per-person AI limit in the web badge"
```

---

### Task 4: Upgrade CTA for uncovered (free-tier) users

**Files:**
- Modify: `apps/web/app/(protected)/assistant/page.tsx`
- Test: `apps/web/src/app/(protected)/assistant/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `statusQuery.data.covered`, `dailyLimit`, `queriesRemaining` (Task 3); routes to the existing billing settings page `/settings/billing`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/app/(protected)/assistant/__tests__/page.test.tsx`, follow the file's existing `getAiStatus` mock setup and add two cases. The mocked status must include the new fields (`dailyLimit`, `covered`). Add:

```typescript
it("shows the upgrade CTA for an uncovered (free) user", async () => {
  // Arrange: mock getAiStatus to resolve an uncovered free-tier status
  // { queriesUsedToday: 1, queriesRemaining: 2, dailyLimit: 3, covered: false, resetAt: <iso> }
  renderAssistantPage();
  expect(await screen.findByRole("link", { name: /upgrade your family/i })).toBeInTheDocument();
});

it("hides the upgrade CTA for a covered user", async () => {
  // Arrange: mock getAiStatus to resolve a covered status
  // { queriesUsedToday: 0, queriesRemaining: 20, dailyLimit: 20, covered: true, resetAt: <iso> }
  renderAssistantPage();
  await screen.findByText(/Family Assistant/i); // page settled
  expect(screen.queryByRole("link", { name: /upgrade your family/i })).not.toBeInTheDocument();
});
```

> Note for the implementer: reuse the existing render helper and `getAiStatus` mock in this test file (it already mocks `@/lib/api/assistant`); just set the resolved value per case. Do not introduce a new mocking style.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run "src/app/(protected)/assistant/__tests__/page.test.tsx"`
Expected: FAIL — no upgrade link is rendered yet.

- [ ] **Step 3: Apply the implementation**

In `apps/web/app/(protected)/assistant/page.tsx`:

1. Add the import at the top (after line 3):

```typescript
import Link from "next/link";
```

2. Insert the CTA directly above the `<ChatInput .../>` element (before line 128):

```typescript
      {statusQuery.data && !statusQuery.data.covered && (
        <Link
          href="/settings/billing"
          className="text-sm rounded-lg px-3 py-2 text-center"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        >
          {queriesRemaining === 0
            ? `You've used all ${dailyLimit} free AI queries today — upgrade your family for 20/day →`
            : `Free plan: ${dailyLimit} AI queries/day — upgrade your family for 20/day →`}
        </Link>
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run "src/app/(protected)/assistant/__tests__/page.test.tsx"`
Expected: PASS (both new cases + existing page tests).

- [ ] **Step 5: Full web suite + type-check**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit`
Expected: all PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(protected)/assistant/page.tsx" "apps/web/src/app/(protected)/assistant/__tests__/page.test.tsx"
git commit -m "feat: P3-02 add free-tier upgrade CTA to the assistant page"
```

---

## Out of scope (documented above in "Scope decision")

- **Degrade-foreign-context-first** (design §4b) — deferred (YAGNI; tension with the per-person allowance model). Would be plan W2c.
- **Mobile surfacing + mobile upsell** — deferred (mobile has no status/billing UI; needs an IAP-vs-web-checkout decision). Follow-on.
- **Per-(person×family) usage analytics** — the `AssistantMessage` data already supports it; no consumer needs it yet.

## Self-Review

- **Spec coverage:** design §4 mechanics — attribution (already in data), no-spillover (already in core), free-vs-covered surfacing (Tasks 2-4), upsell (Task 4). Deferrals explicitly justified. ✓
- **Placeholder scan:** all code steps contain real code; the page-test arrange comments point at concrete mock values and the existing mock helper (no logic left unspecified). ✓
- **Type consistency:** `AiEntitlement { covered, dailyLimit }` (Task 1) flows to the `/status` payload (Task 2) → `AiStatus` (Task 3) → page consumption (Tasks 3-4). `getAiEntitlementForUser` named identically across api impl, api test mock, and route. ✓
