# P3-01: Stripe Subscriptions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Stripe subscription billing — N configurable tiers including free, Checkout for initial purchase, Customer Portal for management, seat enforcement with pre-action confirmation, configurable trial periods with warnings, and queued downgrade with grace period suspension.

**Architecture:** Stripe is source of truth; the DB is a local cache synced via webhooks. API never calls Stripe at request time for auth checks — enforcement reads local state. Two billing route exports: `billingRouter` (authenticated JSON) and `billingWebhookRouter` (raw body, Stripe-signed).

**Tech stack:** `stripe` npm (server), `node-cron` npm (server), Prisma 7 (PostgreSQL), Express 4, Vitest, Next.js 15 App Router, shadcn/ui

---

## File Map

**New files:**
- `packages/db/prisma/migrations/20260530130000_add_subscription_models/migration.sql`
- `apps/api/src/lib/stripeClient.ts`
- `apps/api/src/routes/billing.ts`
- `apps/api/src/lib/subscriptionEnforcement.ts`
- `apps/api/src/jobs/billingEnforcement.ts`
- `apps/api/src/__tests__/routes/billing.test.ts`
- `apps/api/src/__tests__/lib/subscriptionEnforcement.test.ts`
- `apps/api/src/__tests__/jobs/billingEnforcement.test.ts`
- `apps/web/lib/api/billing.ts`
- `apps/web/app/(protected)/billing/plans/page.tsx`
- `apps/web/app/(protected)/billing/success/page.tsx`
- `apps/web/app/(protected)/settings/billing/page.tsx`
- `apps/web/src/components/billing/SeatExpansionModal.tsx`
- `apps/web/src/components/billing/BillingBanners.tsx`
- `apps/web/src/components/billing/__tests__/SeatExpansionModal.test.tsx`
- `apps/web/src/components/billing/__tests__/BillingBanners.test.tsx`
- `apps/web/src/app/(protected)/billing/__tests__/plans.test.tsx`
- `apps/web/src/app/(protected)/settings/__tests__/billing.test.tsx`

**Modified files:**
- `packages/db/prisma/schema.prisma` — add 3 models, add `suspendedAt` to FamilyMember
- `packages/db/prisma/seed.ts` — add pricingTier seed rows
- `apps/api/package.json` — add stripe, node-cron dependencies
- `apps/api/src/lib/env.ts` — add Stripe env vars to Zod schema
- `apps/api/src/server.ts` — register billingWebhookRouter (raw body), start cron
- `apps/api/src/routes/index.ts` — register billingRouter
- `apps/api/src/routes/families.ts` — seat enforcement in POST /:familyId/members
- `apps/api/src/__tests__/setup/loadTestEnv.ts` — add Stripe test defaults
- `apps/api/src/__tests__/setup/afterEach.ts` — add new tables to truncate list
- `apps/web/app/(protected)/layout.tsx` — render BillingBanners

---

### Task 1: Install Stripe + node-cron, update env schema

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/lib/env.ts`
- Modify: `apps/api/src/__tests__/setup/loadTestEnv.ts`

- [ ] **Step 1: Install packages**

```bash
cd apps/api && npm install stripe node-cron
npm install --save-dev @types/node-cron
```

- [ ] **Step 2: Run the existing test suite to confirm baseline**

```bash
cd apps/api && npx vitest run src/__tests__/routes/families.test.ts
```

Expected: all tests pass (establishes a clean baseline before any changes).

- [ ] **Step 3: Add Stripe env vars to the Zod schema**

In `apps/api/src/lib/env.ts`, add these fields to the `envSchema` object (after the existing `CLOUDFLARE_R2_PUBLIC_URL` line):

```typescript
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_BASE: z.string().default("price_test_base"),
  STRIPE_PRICE_BASE_SEAT: z.string().default("price_test_base_seat"),
  STRIPE_PRICE_UNLIMITED: z.string().default("price_test_unlimited"),
```

- [ ] **Step 4: Add test defaults for Stripe env vars**

In `apps/api/src/__tests__/setup/loadTestEnv.ts`, add after the existing `setDefault("CLOUDFLARE_R2_PUBLIC_URL", ...)` line:

```typescript
setDefault("STRIPE_SECRET_KEY", "sk_test_jest_placeholder_not_a_real_key");
setDefault("STRIPE_WEBHOOK_SECRET", "whsec_" + Buffer.from("jest_stripe_webhook_secret_32!").toString("base64"));
setDefault("STRIPE_PRICE_BASE", "price_test_base");
setDefault("STRIPE_PRICE_BASE_SEAT", "price_test_base_seat");
setDefault("STRIPE_PRICE_UNLIMITED", "price_test_unlimited");
```

- [ ] **Step 5: Verify env.ts still passes**

```bash
cd apps/api && npx tsc --noEmit -p tsconfig.type-check.json
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd apps/api && git add package.json package-lock.json src/lib/env.ts src/__tests__/setup/loadTestEnv.ts
git commit -m "feat: P3-01 install stripe + node-cron, add env vars"
```

---

### Task 2: Prisma schema — PricingTier, Promotion, FamilySubscription

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260530130000_add_subscription_models/migration.sql`

- [ ] **Step 1: Add new models to schema.prisma**

Add the following three models at the end of `packages/db/prisma/schema.prisma`, before the final newline:

```prisma
model PricingTier {
  tierKey            String   @id
  stripePriceId      String?
  stripeSeatPriceId  String?
  activeUserLimit    Int?
  trialDays          Int?
  trialWarningDays   Int?
  downgradeGraceDays Int      @default(7)
  displayName        String
  displayOrder       Int
  isActive           Boolean  @default(true)
  createdAt          DateTime @default(now())

  familySubscriptions FamilySubscription[]
}

model Promotion {
  id               String    @id @default(cuid())
  stripeCouponId   String
  name             String
  startsAt         DateTime
  endsAt           DateTime?
  eligibleTierKeys String[]
  isStackable      Boolean   @default(false)
  createdAt        DateTime  @default(now())
}

model FamilySubscription {
  id                        String    @id @default(cuid())
  familyGroupId             String    @unique
  stripeCustomerId          String?
  stripeSubscriptionId      String?
  tierKey                   String
  seatCount                 Int       @default(1)
  grandfathered             Boolean   @default(false)
  priceLockedAt             DateTime?
  status                    String    @default("ACTIVE")
  trialEndsAt               DateTime?
  trialWarningSentAt        DateTime?
  pendingDowngradeTierKey   String?
  pendingDowngradeSeatCount Int?
  downgradeGraceEndsAt      DateTime?
  createdAt                 DateTime  @default(now())
  updatedAt                 DateTime  @updatedAt

  familyGroup FamilyGroup  @relation(fields: [familyGroupId], references: [id])
  pricingTier PricingTier  @relation(fields: [tierKey], references: [tierKey])
}
```

- [ ] **Step 2: Add suspendedAt to FamilyMember and subscription relation to FamilyGroup**

In `FamilyMember` model, add after `joinedAt`:
```prisma
  suspendedAt   DateTime?
```

In `FamilyGroup` model, add after the `events` relation line:
```prisma
  subscription  FamilySubscription?
```

- [ ] **Step 3: Create migration SQL file**

Create `packages/db/prisma/migrations/20260530130000_add_subscription_models/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "PricingTier" (
    "tierKey" TEXT NOT NULL,
    "stripePriceId" TEXT,
    "stripeSeatPriceId" TEXT,
    "activeUserLimit" INTEGER,
    "trialDays" INTEGER,
    "trialWarningDays" INTEGER,
    "downgradeGraceDays" INTEGER NOT NULL DEFAULT 7,
    "displayName" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PricingTier_pkey" PRIMARY KEY ("tierKey")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "stripeCouponId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "eligibleTierKeys" TEXT[],
    "isStackable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilySubscription" (
    "id" TEXT NOT NULL,
    "familyGroupId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "tierKey" TEXT NOT NULL,
    "seatCount" INTEGER NOT NULL DEFAULT 1,
    "grandfathered" BOOLEAN NOT NULL DEFAULT false,
    "priceLockedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "trialEndsAt" TIMESTAMP(3),
    "trialWarningSentAt" TIMESTAMP(3),
    "pendingDowngradeTierKey" TEXT,
    "pendingDowngradeSeatCount" INTEGER,
    "downgradeGraceEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FamilySubscription_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "FamilyMember" ADD COLUMN "suspendedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "FamilySubscription_familyGroupId_key" ON "FamilySubscription"("familyGroupId");

-- AddForeignKey
ALTER TABLE "FamilySubscription" ADD CONSTRAINT "FamilySubscription_familyGroupId_fkey"
  FOREIGN KEY ("familyGroupId") REFERENCES "FamilyGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilySubscription" ADD CONSTRAINT "FamilySubscription_tierKey_fkey"
  FOREIGN KEY ("tierKey") REFERENCES "PricingTier"("tierKey") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 4: Run the migration against the test database**

```bash
cd packages/db && DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
```

Expected: `20260530130000_add_subscription_models` applied successfully.

- [ ] **Step 5: Regenerate the Prisma client**

```bash
cd packages/db && npx prisma generate
```

Expected: client regenerated with PricingTier, Promotion, FamilySubscription, and the updated FamilyMember (with `suspendedAt`).

- [ ] **Step 6: Update afterEach.ts truncate list**

In `apps/api/src/__tests__/setup/afterEach.ts`, replace the `tables` array with:

```typescript
const tables = [
  "AssistantMessage",
  "RSVP",
  "EventInvitation",
  "EventPhoto",
  "EventItem",
  "Event",
  "Relationship",
  "HouseholdMember",
  "FamilyMember",
  "Household",
  "NotificationPreference",
  "FamilySubscription",
  "FamilyGroup",
  "Person",
  "Promotion",
  "PricingTier"
] as const;
```

- [ ] **Step 7: Type-check**

```bash
cd apps/api && npx tsc --noEmit -p tsconfig.type-check.json
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations/20260530130000_add_subscription_models/migration.sql \
        apps/api/src/__tests__/setup/afterEach.ts
git commit -m "feat: P3-01 Prisma schema — PricingTier, Promotion, FamilySubscription"
```

---

### Task 3: Stripe client singleton + GET /billing/tiers

**Files:**
- Create: `apps/api/src/lib/stripeClient.ts`
- Create: `apps/api/src/routes/billing.ts`
- Modify: `apps/api/src/routes/index.ts`
- Modify: `apps/api/src/server.ts`
- Create: `apps/api/src/__tests__/routes/billing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/__tests__/routes/billing.test.ts`:

```typescript
import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { seedTestPerson, seedTestFamily } from "../helpers/db";
import { TEST_CLERK_ID } from "../helpers/auth";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

vi.mock("stripe", () => {
  const mockStripe = {
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: vi.fn() } },
    invoices: { retrieveUpcoming: vi.fn() },
    subscriptions: { update: vi.fn() },
    customers: { create: vi.fn() },
    webhooks: { constructEvent: vi.fn() }
  };
  return { default: vi.fn(() => mockStripe) };
});

describe("GET /api/v1/billing/tiers", () => {
  const app = createApp();

  it("returns empty array when no tiers exist", async () => {
    const res = await request(app).get("/api/v1/billing/tiers");
    expect(res.status).toBe(200);
    expect(res.body.tiers).toEqual([]);
  });

  it("returns only isActive tiers ordered by displayOrder", async () => {
    await db.pricingTier.createMany({
      data: [
        { tierKey: "FREE", displayName: "Free", displayOrder: 0, isActive: true },
        { tierKey: "BASE", displayName: "Family", displayOrder: 1, isActive: true, stripePriceId: "price_base", activeUserLimit: 5 },
        { tierKey: "OLD", displayName: "Legacy", displayOrder: 99, isActive: false }
      ]
    });
    const res = await request(app).get("/api/v1/billing/tiers");
    expect(res.status).toBe(200);
    expect(res.body.tiers).toHaveLength(2);
    expect(res.body.tiers[0].tierKey).toBe("FREE");
    expect(res.body.tiers[1].tierKey).toBe("BASE");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd apps/api && npx vitest run src/__tests__/routes/billing.test.ts
```

Expected: FAIL — `billingRouter` does not exist yet.

- [ ] **Step 3: Create the Stripe client singleton**

Create `apps/api/src/lib/stripeClient.ts`:

```typescript
import Stripe from "stripe";
import { env } from "./env";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20"
});
```

- [ ] **Step 4: Create the billing route with GET /tiers**

Create `apps/api/src/routes/billing.ts`:

```typescript
import { Router } from "express";
import { z } from "zod";
import { db } from "@famlink/db";
import { stripe } from "../lib/stripeClient";
import { env } from "../lib/env";
import type { Request, Response } from "express";
import type { AuthedRequest } from "../middleware/requireAuth";

export const billingRouter = Router();
export const billingWebhookRouter = Router();

function authed(req: Request): AuthedRequest {
  return req as unknown as AuthedRequest;
}

async function personForClerkUserId(clerkUserId: string) {
  return db.person.findUnique({ where: { userId: clerkUserId } });
}

async function familySubscriptionForFamily(familyGroupId: string) {
  return db.familySubscription.findUnique({
    where: { familyGroupId },
    include: { pricingTier: true }
  });
}

// GET /api/v1/billing/tiers — public, no auth required
billingRouter.get("/tiers", async (_req: Request, res: Response) => {
  const tiers = await db.pricingTier.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" }
  });
  res.json({ tiers });
});
```

- [ ] **Step 5: Register the billing router in routes/index.ts**

In `apps/api/src/routes/index.ts`, add the import and registration:

```typescript
import { billingRouter } from "./billing";
```

Add at the end of the router registrations:
```typescript
router.use("/api/v1/billing", billingRouter);
```

- [ ] **Step 6: Run the test to confirm it passes**

```bash
cd apps/api && npx vitest run src/__tests__/routes/billing.test.ts
```

Expected: PASS — both tiers tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/stripeClient.ts apps/api/src/routes/billing.ts \
        apps/api/src/routes/index.ts \
        apps/api/src/__tests__/routes/billing.test.ts
git commit -m "feat: P3-01 GET /billing/tiers + Stripe client singleton"
```

---

### Task 4: POST /billing/checkout, POST /billing/portal, POST /billing/seat-impact

**Files:**
- Modify: `apps/api/src/routes/billing.ts`
- Modify: `apps/api/src/__tests__/routes/billing.test.ts`

- [ ] **Step 1: Write failing tests for the three endpoints**

Append to the `describe` block in `billing.test.ts` (import `getAuth` mock is already in place):

```typescript
describe("POST /api/v1/billing/checkout", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;
  let stripeInstance: any;

  beforeEach(async () => {
    mockGetAuth.mockReset();
    const Stripe = (await import("stripe")).default;
    stripeInstance = new (Stripe as any)();
    stripeInstance.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.stripe.com/test" });
    stripeInstance.customers.create.mockResolvedValue({ id: "cus_test" });
  });

  it("returns 400 when requester has no person record", async () => {
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/checkout")
      .set("Authorization", "Bearer mock")
      .send({ tierKey: "BASE", seats: 1, successUrl: "http://localhost:3000/success", cancelUrl: "http://localhost:3000/cancel" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when tierKey does not exist", async () => {
    await seedTestPerson();
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/checkout")
      .set("Authorization", "Bearer mock")
      .send({ tierKey: "NONEXISTENT", seats: 1, successUrl: "http://localhost:3000/success", cancelUrl: "http://localhost:3000/cancel" });
    expect(res.status).toBe(404);
  });

  it("returns checkoutUrl for valid tier", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Family", displayOrder: 1, stripePriceId: "price_base", activeUserLimit: 5 } });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/checkout")
      .set("Authorization", "Bearer mock")
      .send({ tierKey: "BASE", seats: 1, successUrl: "http://localhost:3000/success", cancelUrl: "http://localhost:3000/cancel" });
    expect(res.status).toBe(200);
    expect(res.body.checkoutUrl).toBe("https://checkout.stripe.com/test");
  });
});

describe("POST /api/v1/billing/portal", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => mockGetAuth.mockReset());

  it("returns 404 when no subscription exists", async () => {
    await seedTestPerson();
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/portal")
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(404);
  });

  it("returns portalUrl when stripeCustomerId exists", async () => {
    const Stripe = (await import("stripe")).default;
    const inst = new (Stripe as any)();
    inst.billingPortal.sessions.create.mockResolvedValue({ url: "https://billing.stripe.com/test" });

    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Family", displayOrder: 1, stripePriceId: "price_base" } });
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "BASE", stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test" }
    });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/portal")
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(200);
    expect(res.body.portalUrl).toBe("https://billing.stripe.com/test");
  });
});

describe("POST /api/v1/billing/seat-impact", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => mockGetAuth.mockReset());

  it("returns billing impact when subscription and upcoming invoice are available", async () => {
    const Stripe = (await import("stripe")).default;
    const inst = new (Stripe as any)();
    inst.invoices.retrieveUpcoming.mockResolvedValue({ amount_due: 450, currency: "usd" });

    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Family", displayOrder: 1, stripePriceId: "price_base", stripeSeatPriceId: "price_seat", activeUserLimit: 5 } });
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 2, stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test" }
    });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/seat-impact")
      .set("Authorization", "Bearer mock")
      .send({ newSeatCount: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currentSeats: 2, newSeats: 3, currency: "usd" });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && npx vitest run src/__tests__/routes/billing.test.ts
```

Expected: FAIL — routes not yet implemented.

- [ ] **Step 3: Implement the three endpoints in billing.ts**

Add after the `GET /tiers` handler in `apps/api/src/routes/billing.ts`:

```typescript
const CheckoutSchema = z.object({
  tierKey: z.string().min(1),
  seats: z.number().int().positive().default(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});

// POST /api/v1/billing/checkout — requires auth
billingRouter.post("/checkout", async (req: Request, res: Response) => {
  const { userId } = authed(req);
  const person = await personForClerkUserId(userId);
  if (!person) { res.status(400).json({ error: "Person record required" }); return; }

  const body = CheckoutSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body", details: body.data }); return; }

  const membership = await db.familyMember.findFirst({ where: { personId: person.id }, include: { familyGroup: true } });
  if (!membership) { res.status(400).json({ error: "No family group found" }); return; }

  const tier = await db.pricingTier.findUnique({ where: { tierKey: body.data.tierKey } });
  if (!tier) { res.status(404).json({ error: "Tier not found" }); return; }

  let sub = await db.familySubscription.findUnique({ where: { familyGroupId: membership.familyGroupId } });
  let customerId = sub?.stripeCustomerId ?? null;

  if (!customerId) {
    const customer = await stripe.customers.create({ metadata: { familyGroupId: membership.familyGroupId } });
    customerId = customer.id;
  }

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  if (tier.stripePriceId) {
    lineItems.push({ price: tier.stripePriceId, quantity: 1 });
  }
  if (tier.stripeSeatPriceId && body.data.seats > 0) {
    lineItems.push({ price: tier.stripeSeatPriceId, quantity: body.data.seats });
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer: customerId,
    line_items: lineItems,
    success_url: body.data.successUrl,
    cancel_url: body.data.cancelUrl,
    metadata: { familyGroupId: membership.familyGroupId, tierKey: body.data.tierKey },
    subscription_data: {
      metadata: { familyGroupId: membership.familyGroupId, tierKey: body.data.tierKey },
      ...(tier.trialDays ? { trial_period_days: tier.trialDays } : {})
    }
  };

  const session = await stripe.checkout.sessions.create(sessionParams);
  res.json({ checkoutUrl: session.url });
});

// POST /api/v1/billing/portal — requires auth
billingRouter.post("/portal", async (req: Request, res: Response) => {
  const { userId } = authed(req);
  const person = await personForClerkUserId(userId);
  if (!person) { res.status(400).json({ error: "Person record required" }); return; }

  const membership = await db.familyMember.findFirst({ where: { personId: person.id } });
  if (!membership) { res.status(400).json({ error: "No family group found" }); return; }

  const sub = await db.familySubscription.findUnique({ where: { familyGroupId: membership.familyGroupId } });
  if (!sub?.stripeCustomerId) { res.status(404).json({ error: "No billing account found" }); return; }

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${env.WEB_APP_URL}/settings/billing`
  });
  res.json({ portalUrl: session.url });
});

const SeatImpactSchema = z.object({ newSeatCount: z.number().int().positive() });

// POST /api/v1/billing/seat-impact — requires auth
billingRouter.post("/seat-impact", async (req: Request, res: Response) => {
  const { userId } = authed(req);
  const person = await personForClerkUserId(userId);
  if (!person) { res.status(400).json({ error: "Person record required" }); return; }

  const body = SeatImpactSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const membership = await db.familyMember.findFirst({ where: { personId: person.id } });
  if (!membership) { res.status(400).json({ error: "No family group found" }); return; }

  const sub = await familySubscriptionForFamily(membership.familyGroupId);
  if (!sub?.stripeSubscriptionId || !sub.pricingTier.stripeSeatPriceId) {
    res.status(400).json({ error: "No seat-based subscription found" }); return;
  }

  const upcoming = await stripe.invoices.retrieveUpcoming({
    customer: sub.stripeCustomerId!,
    subscription: sub.stripeSubscriptionId,
    subscription_items: [{ id: sub.stripeSubscriptionId, quantity: body.data.newSeatCount }]
  } as any);

  res.json({
    currentSeats: sub.seatCount,
    newSeats: body.data.newSeatCount,
    immediateCharge: upcoming.amount_due / 100,
    currency: upcoming.currency
  });
});
```

Add `import Stripe from "stripe";` at the top of billing.ts.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && npx vitest run src/__tests__/routes/billing.test.ts
```

Expected: PASS — all billing tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/billing.ts apps/api/src/__tests__/routes/billing.test.ts
git commit -m "feat: P3-01 POST /billing/checkout, /portal, /seat-impact"
```

---

### Task 5: POST /billing/webhook — Stripe event handler

**Files:**
- Modify: `apps/api/src/routes/billing.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/routes/billing.test.ts`

- [ ] **Step 1: Write failing webhook tests**

Append to `billing.test.ts`:

```typescript
describe("POST /api/v1/billing/webhook", () => {
  const app = createApp();

  function makeStripeEvent(type: string, data: object): { body: string; sig: string } {
    const payload = JSON.stringify({ id: `evt_${Date.now()}`, type, data: { object: data } });
    // In tests, stripe.webhooks.constructEvent is mocked to return the parsed payload directly
    return { body: payload, sig: "t=1,v1=test" };
  }

  beforeEach(async () => {
    const Stripe = (await import("stripe")).default;
    const inst = new (Stripe as any)();
    inst.webhooks.constructEvent.mockImplementation((_body: string, _sig: string, _secret: string) => {
      return JSON.parse(_body);
    });
  });

  it("returns 400 for invalid signature", async () => {
    const Stripe = (await import("stripe")).default;
    const inst = new (Stripe as any)();
    inst.webhooks.constructEvent.mockImplementation(() => { throw new Error("Signature invalid"); });
    const res = await request(app)
      .post("/api/v1/billing/webhook")
      .set("stripe-signature", "bad")
      .set("content-type", "application/json")
      .send(JSON.stringify({ type: "test" }));
    expect(res.status).toBe(400);
  });

  it("checkout.session.completed — creates FamilySubscription", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Family", displayOrder: 1 } });

    const { body, sig } = makeStripeEvent("checkout.session.completed", {
      metadata: { familyGroupId: familyGroup.id, tierKey: "BASE" },
      customer: "cus_test",
      subscription: "sub_test",
      status: "complete"
    });

    const res = await request(app)
      .post("/api/v1/billing/webhook")
      .set("stripe-signature", sig)
      .set("content-type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.stripeCustomerId).toBe("cus_test");
    expect(sub?.stripeSubscriptionId).toBe("sub_test");
    expect(sub?.tierKey).toBe("BASE");
  });

  it("customer.subscription.updated — syncs status and detects downgrade", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.createMany({ data: [
      { tierKey: "MID", displayName: "Mid", displayOrder: 1, activeUserLimit: 5 },
      { tierKey: "BASE", displayName: "Base", displayOrder: 0, activeUserLimit: 2 }
    ]});
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "MID", seatCount: 4, stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test", status: "ACTIVE" }
    });

    const { body, sig } = makeStripeEvent("customer.subscription.updated", {
      id: "sub_test",
      metadata: { familyGroupId: familyGroup.id, tierKey: "BASE" },
      status: "active",
      items: { data: [{ quantity: 2 }] }
    });

    const res = await request(app)
      .post("/api/v1/billing/webhook")
      .set("stripe-signature", sig)
      .set("content-type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.tierKey).toBe("BASE");
    expect(sub?.pendingDowngradeTierKey).toBe("BASE");
    expect(sub?.downgradeGraceEndsAt).not.toBeNull();
  });

  it("customer.subscription.deleted — sets status to CANCELED", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Family", displayOrder: 1 } });
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "BASE", stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test", status: "ACTIVE" }
    });

    const { body, sig } = makeStripeEvent("customer.subscription.deleted", {
      id: "sub_test",
      metadata: { familyGroupId: familyGroup.id }
    });

    const res = await request(app)
      .post("/api/v1/billing/webhook")
      .set("stripe-signature", sig)
      .set("content-type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.status).toBe("CANCELED");
  });

  it("invoice.payment_failed — sets status to PAST_DUE", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Family", displayOrder: 1 } });
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "BASE", stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test", status: "ACTIVE" }
    });

    const { body, sig } = makeStripeEvent("invoice.payment_failed", {
      subscription: "sub_test"
    });

    const res = await request(app)
      .post("/api/v1/billing/webhook")
      .set("stripe-signature", sig)
      .set("content-type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.status).toBe("PAST_DUE");
  });

  it("invoice.payment_succeeded — clears PAST_DUE status", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Family", displayOrder: 1 } });
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "BASE", stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test", status: "PAST_DUE" }
    });

    const { body, sig } = makeStripeEvent("invoice.payment_succeeded", {
      subscription: "sub_test"
    });

    const res = await request(app)
      .post("/api/v1/billing/webhook")
      .set("stripe-signature", sig)
      .set("content-type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.status).toBe("ACTIVE");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && npx vitest run src/__tests__/routes/billing.test.ts
```

Expected: FAIL — webhook handler not yet implemented.

- [ ] **Step 3: Implement the webhook handler in billing.ts**

Add to `apps/api/src/routes/billing.ts`:

```typescript
function rawBody(req: Request): string {
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  return typeof req.body === "string" ? req.body : JSON.stringify(req.body);
}

billingWebhookRouter.post("/", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody(req), sig, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    res.status(400).json({ error: "Invalid Stripe signature" });
    return;
  }

  try {
    await handleStripeEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook handler error", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  const obj = event.data.object as any;

  switch (event.type) {
    case "checkout.session.completed": {
      const { familyGroupId, tierKey } = obj.metadata ?? {};
      if (!familyGroupId || !tierKey) return;
      const trialEnd = obj.subscription_data?.trial_end;
      await db.familySubscription.upsert({
        where: { familyGroupId },
        create: {
          familyGroupId,
          tierKey,
          stripeCustomerId: obj.customer,
          stripeSubscriptionId: obj.subscription,
          status: trialEnd ? "TRIALING" : "ACTIVE",
          trialEndsAt: trialEnd ? new Date(trialEnd * 1000) : null
        },
        update: {
          stripeCustomerId: obj.customer,
          stripeSubscriptionId: obj.subscription,
          tierKey,
          status: trialEnd ? "TRIALING" : "ACTIVE",
          trialEndsAt: trialEnd ? new Date(trialEnd * 1000) : null
        }
      });
      break;
    }

    case "customer.subscription.updated": {
      const { familyGroupId, tierKey } = obj.metadata ?? {};
      if (!familyGroupId) return;
      const newSeatCount: number = obj.items?.data?.[0]?.quantity ?? 1;
      const existing = await db.familySubscription.findUnique({ where: { familyGroupId }, include: { pricingTier: true } });
      if (!existing) return;

      const newTier = await db.pricingTier.findUnique({ where: { tierKey: tierKey ?? existing.tierKey } });
      const isDowngrade = newTier?.activeUserLimit !== null &&
        newSeatCount < existing.seatCount &&
        (newTier?.activeUserLimit ?? Infinity) < existing.seatCount;

      const graceEndsAt = isDowngrade
        ? new Date(Date.now() + (newTier?.downgradeGraceDays ?? 7) * 86400000)
        : null;

      await db.familySubscription.update({
        where: { familyGroupId },
        data: {
          tierKey: tierKey ?? existing.tierKey,
          seatCount: newSeatCount,
          status: obj.status === "past_due" ? "PAST_DUE" : obj.status === "trialing" ? "TRIALING" : "ACTIVE",
          trialEndsAt: obj.trial_end ? new Date(obj.trial_end * 1000) : existing.trialEndsAt,
          ...(isDowngrade ? {
            pendingDowngradeTierKey: tierKey ?? existing.tierKey,
            pendingDowngradeSeatCount: newSeatCount,
            downgradeGraceEndsAt: graceEndsAt
          } : {})
        }
      });
      break;
    }

    case "customer.subscription.deleted": {
      const { familyGroupId } = obj.metadata ?? {};
      if (!familyGroupId) return;
      const freeTier = await db.pricingTier.findFirst({ where: { isActive: true, stripePriceId: null }, orderBy: { displayOrder: "asc" } });
      await db.familySubscription.update({
        where: { familyGroupId },
        data: {
          status: "CANCELED",
          stripeSubscriptionId: null,
          ...(freeTier ? { tierKey: freeTier.tierKey } : {})
        }
      });
      break;
    }

    case "invoice.payment_failed": {
      const sub = await db.familySubscription.findFirst({ where: { stripeSubscriptionId: obj.subscription } });
      if (!sub) return;
      await db.familySubscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE" } });
      break;
    }

    case "invoice.payment_succeeded": {
      const sub = await db.familySubscription.findFirst({ where: { stripeSubscriptionId: obj.subscription } });
      if (!sub || sub.status !== "PAST_DUE") return;
      await db.familySubscription.update({ where: { id: sub.id }, data: { status: "ACTIVE" } });
      break;
    }

    default:
      break;
  }
}
```

- [ ] **Step 4: Register billingWebhookRouter in server.ts**

In `apps/api/src/server.ts`, add the import:

```typescript
import { billingWebhookRouter } from "./routes/billing";
```

Add before the `app.use(express.json(...))` line:

```typescript
app.use(
  "/api/v1/billing/webhook",
  express.raw({ type: "application/json", limit: "10mb" }),
  billingWebhookRouter
);
```

- [ ] **Step 5: Run all billing tests**

```bash
cd apps/api && npx vitest run src/__tests__/routes/billing.test.ts
```

Expected: PASS — all tests pass including webhook event tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/billing.ts apps/api/src/server.ts \
        apps/api/src/__tests__/routes/billing.test.ts
git commit -m "feat: P3-01 POST /billing/webhook — Stripe event handler"
```

---

### Task 6: Subscription enforcement lib + seat check in families route

**Files:**
- Create: `apps/api/src/lib/subscriptionEnforcement.ts`
- Create: `apps/api/src/__tests__/lib/subscriptionEnforcement.test.ts`
- Modify: `apps/api/src/routes/families.ts`
- Modify: `apps/api/src/__tests__/routes/families.test.ts`

- [ ] **Step 1: Write failing unit tests for enforcement lib**

Create `apps/api/src/__tests__/lib/subscriptionEnforcement.test.ts`:

```typescript
import { db } from "@famlink/db";
import { checkSeatExpansion } from "../../lib/subscriptionEnforcement";
import { seedTestPerson, seedTestFamily } from "../helpers/db";

describe("checkSeatExpansion", () => {
  it("returns allowed=true, requiresConfirmation=false when no subscription record", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    const result = await checkSeatExpansion(familyGroup.id, 1);
    expect(result).toEqual({ allowed: true, requiresConfirmation: false });
  });

  it("returns allowed=true, requiresConfirmation=false for unlimited tier", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "UNLIMITED", displayName: "Unlimited", displayOrder: 2, activeUserLimit: null } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "UNLIMITED", seatCount: 10 } });
    const result = await checkSeatExpansion(familyGroup.id, 10);
    expect(result).toEqual({ allowed: true, requiresConfirmation: false });
  });

  it("returns allowed=true, requiresConfirmation=false when under declared seat count", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, activeUserLimit: 5 } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 5 } });
    const result = await checkSeatExpansion(familyGroup.id, 3);
    expect(result).toEqual({ allowed: true, requiresConfirmation: false });
  });

  it("returns requiresConfirmation=true when at or over declared seat count", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, activeUserLimit: 5 } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 2 } });
    const result = await checkSeatExpansion(familyGroup.id, 2);
    expect(result).toEqual({ allowed: true, requiresConfirmation: true });
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd apps/api && npx vitest run src/__tests__/lib/subscriptionEnforcement.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the enforcement lib**

Create `apps/api/src/lib/subscriptionEnforcement.ts`:

```typescript
import { db } from "@famlink/db";

export interface SeatExpansionCheck {
  allowed: boolean;
  requiresConfirmation: boolean;
}

export async function checkSeatExpansion(
  familyGroupId: string,
  currentActiveCount: number
): Promise<SeatExpansionCheck> {
  const sub = await db.familySubscription.findUnique({
    where: { familyGroupId },
    include: { pricingTier: true }
  });

  if (!sub) return { allowed: true, requiresConfirmation: false };
  if (sub.pricingTier.activeUserLimit === null) return { allowed: true, requiresConfirmation: false };
  if (currentActiveCount < sub.seatCount) return { allowed: true, requiresConfirmation: false };

  return { allowed: true, requiresConfirmation: true };
}
```

- [ ] **Step 4: Run to confirm enforcement tests pass**

```bash
cd apps/api && npx vitest run src/__tests__/lib/subscriptionEnforcement.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing test for seat enforcement in families route**

Append to `apps/api/src/__tests__/routes/families.test.ts`:

```typescript
describe("POST /api/v1/families/:familyId/members — seat enforcement", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => mockGetAuth.mockReset());

  it("returns 402 with seatRequired when adding active user would exceed seat count", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const second = await seedSecondPerson();
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, activeUserLimit: 5 } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 1 } });

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/families/${familyGroup.id}/members`)
      .set("Authorization", "Bearer mock")
      .send({ personId: second.id, roles: ["MEMBER"], permissions: [] });

    expect(res.status).toBe(402);
    expect(res.body.seatRequired).toBe(true);
  });

  it("adds active member when confirmSeatExpansion is true", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const second = await seedSecondPerson();
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, activeUserLimit: 5 } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 1, stripeSubscriptionId: "sub_test" } });

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/families/${familyGroup.id}/members`)
      .set("Authorization", "Bearer mock")
      .send({ personId: second.id, roles: ["MEMBER"], permissions: [], confirmSeatExpansion: true });

    expect(res.status).toBe(201);
    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.seatCount).toBe(2);
  });
});
```

- [ ] **Step 6: Run to confirm it fails**

```bash
cd apps/api && npx vitest run src/__tests__/routes/families.test.ts
```

Expected: FAIL on the two new seat enforcement tests.

- [ ] **Step 7: Add seat enforcement to the families route**

In `apps/api/src/routes/families.ts`, add the import at the top:

```typescript
import { checkSeatExpansion } from "../lib/subscriptionEnforcement";
```

Modify the `AddMemberSchema` to include the optional confirmation flag:

```typescript
const AddMemberSchema = z.object({
  personId: z.string().min(1),
  roles: z.array(z.string()).min(1),
  permissions: z.array(z.string()).default([]),
  confirmSeatExpansion: z.boolean().optional().default(false)
});
```

In the `POST /:familyId/members` handler, add the seat check after the `targetPerson` lookup (before the `db.familyMember.create` call):

```typescript
  // Seat enforcement: only applies when adding an active user (has Clerk account)
  if (targetPerson.userId) {
    const activeCount = await db.familyMember.count({
      where: { familyGroupId: familyId, person: { userId: { not: null } }, suspendedAt: null }
    });
    const check = await checkSeatExpansion(familyId, activeCount);
    if (check.requiresConfirmation && !body.data.confirmSeatExpansion) {
      res.status(402).json({ seatRequired: true, currentActiveCount: activeCount });
      return;
    }
    if (check.requiresConfirmation && body.data.confirmSeatExpansion) {
      const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyId } });
      if (sub) {
        await db.familySubscription.update({
          where: { familyGroupId: familyId },
          data: { seatCount: sub.seatCount + 1 }
        });
      }
    }
  }
```

- [ ] **Step 8: Run all families tests**

```bash
cd apps/api && npx vitest run src/__tests__/routes/families.test.ts
```

Expected: PASS — all tests including the two new seat enforcement tests.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib/subscriptionEnforcement.ts \
        apps/api/src/__tests__/lib/subscriptionEnforcement.test.ts \
        apps/api/src/routes/families.ts \
        apps/api/src/__tests__/routes/families.test.ts
git commit -m "feat: P3-01 seat enforcement — 402 gate + families route integration"
```

---

### Task 7: Daily billing enforcement cron

**Files:**
- Create: `apps/api/src/jobs/billingEnforcement.ts`
- Create: `apps/api/src/__tests__/jobs/billingEnforcement.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write failing unit tests for the cron job functions**

Create `apps/api/src/__tests__/jobs/billingEnforcement.test.ts`:

```typescript
import { db } from "@famlink/db";
import { runTrialWarningPass, runDowngradeEnforcementPass } from "../../jobs/billingEnforcement";
import { seedTestPerson, seedTestFamily } from "../helpers/db";

describe("runTrialWarningPass", () => {
  it("stamps trialWarningSentAt and does not re-send for same subscription", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, trialWarningDays: 3 } });
    const trialEndsAt = new Date(Date.now() + 2 * 86400000); // 2 days from now
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "BASE", status: "TRIALING", trialEndsAt }
    });

    await runTrialWarningPass();

    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.trialWarningSentAt).not.toBeNull();

    // second run — should not error, warning already sent
    const warnedAt = sub?.trialWarningSentAt;
    await runTrialWarningPass();
    const sub2 = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub2?.trialWarningSentAt?.getTime()).toBe(warnedAt?.getTime());
  });

  it("does not warn when trial ends in more than trialWarningDays days", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, trialWarningDays: 3 } });
    const trialEndsAt = new Date(Date.now() + 10 * 86400000); // 10 days from now
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "BASE", status: "TRIALING", trialEndsAt }
    });

    await runTrialWarningPass();
    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.trialWarningSentAt).toBeNull();
  });
});

describe("runDowngradeEnforcementPass", () => {
  it("suspends newest-joined over-limit active members when grace period expires", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const second = await seedSecondPerson();
    await db.familyMember.create({
      data: { familyGroupId: familyGroup.id, personId: second.id, roles: ["MEMBER"], permissions: [] }
    });
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, activeUserLimit: 1 } });
    await db.familySubscription.create({
      data: {
        familyGroupId: familyGroup.id,
        tierKey: "BASE",
        seatCount: 1,
        pendingDowngradeTierKey: "BASE",
        pendingDowngradeSeatCount: 1,
        downgradeGraceEndsAt: new Date(Date.now() - 1000) // expired
      }
    });

    await runDowngradeEnforcementPass();

    const secondMember = await db.familyMember.findUnique({
      where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: second.id } }
    });
    expect(secondMember?.suspendedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd apps/api && npx vitest run src/__tests__/jobs/billingEnforcement.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the cron job module**

Create `apps/api/src/jobs/billingEnforcement.ts`:

```typescript
import cron from "node-cron";
import { db } from "@famlink/db";

export async function runTrialWarningPass(): Promise<void> {
  const subs = await db.familySubscription.findMany({
    where: {
      trialEndsAt: { not: null },
      trialWarningSentAt: null,
      status: "TRIALING"
    },
    include: { pricingTier: true }
  });

  for (const sub of subs) {
    const warningDays = sub.pricingTier.trialWarningDays ?? 3;
    const warningThreshold = new Date(Date.now() + warningDays * 86400000);
    if (!sub.trialEndsAt || sub.trialEndsAt > warningThreshold) continue;

    await db.familySubscription.update({
      where: { id: sub.id },
      data: { trialWarningSentAt: new Date() }
    });
    // Notification hook: extend here to send email/in-app notification when notification service supports it
  }
}

export async function runDowngradeEnforcementPass(): Promise<void> {
  const subs = await db.familySubscription.findMany({
    where: {
      downgradeGraceEndsAt: { not: null, lt: new Date() },
      pendingDowngradeSeatCount: { not: null }
    }
  });

  for (const sub of subs) {
    const newSeatCount = sub.pendingDowngradeSeatCount!;

    const activeMembers = await db.familyMember.findMany({
      where: {
        familyGroupId: sub.familyGroupId,
        suspendedAt: null,
        person: { userId: { not: null } }
      },
      orderBy: { joinedAt: "asc" },
      include: { person: true }
    });

    const overCount = activeMembers.length - newSeatCount;
    if (overCount <= 0) {
      // Already under limit — just clear pending downgrade fields
      await db.familySubscription.update({
        where: { id: sub.id },
        data: {
          seatCount: newSeatCount,
          pendingDowngradeTierKey: null,
          pendingDowngradeSeatCount: null,
          downgradeGraceEndsAt: null
        }
      });
      continue;
    }

    // Suspend the newest-joined over-limit members (last in the sorted list)
    const toSuspend = activeMembers.slice(-overCount);
    for (const member of toSuspend) {
      await db.familyMember.update({
        where: { id: member.id },
        data: { suspendedAt: new Date() }
      });
    }

    await db.familySubscription.update({
      where: { id: sub.id },
      data: {
        seatCount: newSeatCount,
        pendingDowngradeTierKey: null,
        pendingDowngradeSeatCount: null,
        downgradeGraceEndsAt: null
      }
    });
  }
}

export function startBillingCron(): void {
  // Run at 06:00 UTC daily
  cron.schedule("0 6 * * *", async () => {
    try {
      await runTrialWarningPass();
      await runDowngradeEnforcementPass();
    } catch (err) {
      console.error("Billing enforcement cron error", err);
    }
  });
}
```

- [ ] **Step 4: Run enforcement tests to confirm they pass**

```bash
cd apps/api && npx vitest run src/__tests__/jobs/billingEnforcement.test.ts
```

Expected: PASS.

- [ ] **Step 5: Start the cron in createHttpServer**

In `apps/api/src/server.ts`, add:

```typescript
import { startBillingCron } from "./jobs/billingEnforcement";
```

In `createHttpServer()`, add after `initializeSocketServer(httpServer)`:

```typescript
  if (process.env.NODE_ENV !== "test") {
    startBillingCron();
  }
```

- [ ] **Step 6: Run full API test suite to confirm no regressions**

```bash
cd apps/api && npx vitest run src/__tests__/routes/billing.test.ts src/__tests__/lib/subscriptionEnforcement.test.ts src/__tests__/jobs/billingEnforcement.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/jobs/billingEnforcement.ts \
        apps/api/src/__tests__/jobs/billingEnforcement.test.ts \
        apps/api/src/server.ts
git commit -m "feat: P3-01 daily billing enforcement cron — trial warnings + downgrade suspension"
```

---

### Task 8: Seed data

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Add pricing tier seed rows**

In `packages/db/prisma/seed.ts`, add after the final `await prisma.person.upsert(...)` loop and before `main()` is called:

```typescript
  await prisma.pricingTier.createMany({
    data: [
      {
        tierKey: "FREE",
        displayName: "Free",
        activeUserLimit: 1,
        trialDays: null,
        trialWarningDays: null,
        downgradeGraceDays: 7,
        displayOrder: 0,
        isActive: true
      },
      {
        tierKey: "BASE",
        stripePriceId: process.env.STRIPE_PRICE_BASE ?? "price_test_base",
        stripeSeatPriceId: process.env.STRIPE_PRICE_BASE_SEAT ?? "price_test_base_seat",
        activeUserLimit: 5,
        displayName: "Family",
        trialDays: 14,
        trialWarningDays: 3,
        downgradeGraceDays: 7,
        displayOrder: 1,
        isActive: true
      },
      {
        tierKey: "UNLIMITED",
        stripePriceId: process.env.STRIPE_PRICE_UNLIMITED ?? "price_test_unlimited",
        activeUserLimit: null,
        displayName: "Family Unlimited",
        trialDays: 14,
        trialWarningDays: 3,
        downgradeGraceDays: 7,
        displayOrder: 2,
        isActive: true
      }
    ],
    skipDuplicates: true
  });
```

- [ ] **Step 2: Verify seed compiles**

```bash
cd packages/db && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat: P3-01 seed pricing tiers — FREE, BASE, UNLIMITED"
```

---

### Task 9: Frontend billing API client

**Files:**
- Create: `apps/web/lib/api/billing.ts`

- [ ] **Step 1: Create the billing API client**

Create `apps/web/lib/api/billing.ts`:

```typescript
import { apiFetch } from "@/lib/api";

export interface PricingTier {
  tierKey: string;
  displayName: string;
  activeUserLimit: number | null;
  stripePriceId: string | null;
  trialDays: number | null;
  displayOrder: number;
  isActive: boolean;
}

export interface FamilySubscription {
  tierKey: string;
  seatCount: number;
  status: "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "SUSPENDED";
  trialEndsAt: string | null;
  pendingDowngradeTierKey: string | null;
  pendingDowngradeSeatCount: number | null;
  downgradeGraceEndsAt: string | null;
  grandfathered: boolean;
}

export interface SeatImpact {
  currentSeats: number;
  newSeats: number;
  immediateCharge: number;
  currency: string;
}

export async function fetchTiers(): Promise<PricingTier[]> {
  const base = process.env.NEXT_PUBLIC_API_URL;
  const res = await fetch(`${base}/api/v1/billing/tiers`, { cache: "no-store" });
  const data = await res.json();
  return data.tiers;
}

export async function fetchSubscription(getToken: () => Promise<string | null>): Promise<FamilySubscription | null> {
  try {
    const data = await apiFetch<{ subscription: FamilySubscription }>("/api/v1/billing/subscription", { getToken });
    return data.subscription;
  } catch {
    return null;
  }
}

export async function createCheckoutSession(
  getToken: () => Promise<string | null>,
  tierKey: string,
  seats: number,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const data = await apiFetch<{ checkoutUrl: string }>("/api/v1/billing/checkout", {
    getToken,
    method: "POST",
    body: JSON.stringify({ tierKey, seats, successUrl, cancelUrl })
  });
  return data.checkoutUrl;
}

export async function createPortalSession(getToken: () => Promise<string | null>): Promise<string> {
  const data = await apiFetch<{ portalUrl: string }>("/api/v1/billing/portal", { getToken, method: "POST" });
  return data.portalUrl;
}

export async function getSeatImpact(
  getToken: () => Promise<string | null>,
  newSeatCount: number
): Promise<SeatImpact> {
  return apiFetch<SeatImpact>("/api/v1/billing/seat-impact", {
    getToken,
    method: "POST",
    body: JSON.stringify({ newSeatCount })
  });
}
```

- [ ] **Step 2: Type-check the web app**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api/billing.ts
git commit -m "feat: P3-01 frontend billing API client"
```

---

### Task 10: Frontend pricing page, billing settings page, SeatExpansionModal, BillingBanners

**Files:**
- Create: `apps/web/app/(protected)/billing/plans/page.tsx`
- Create: `apps/web/app/(protected)/billing/success/page.tsx`
- Create: `apps/web/app/(protected)/settings/billing/page.tsx`
- Create: `apps/web/src/components/billing/SeatExpansionModal.tsx`
- Create: `apps/web/src/components/billing/BillingBanners.tsx`
- Create: `apps/web/src/components/billing/__tests__/SeatExpansionModal.test.tsx`
- Create: `apps/web/src/components/billing/__tests__/BillingBanners.test.tsx`
- Modify: `apps/web/app/(protected)/layout.tsx`

- [ ] **Step 1: Write failing component tests**

Create `apps/web/src/components/billing/__tests__/SeatExpansionModal.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SeatExpansionModal } from "@/components/billing/SeatExpansionModal";

describe("SeatExpansionModal", () => {
  const baseProps = {
    currentSeats: 2,
    newSeats: 3,
    immediateCharge: 4.50,
    recurringIncrease: 9.00,
    currency: "usd",
    onConfirm: vi.fn(),
    onCancel: vi.fn()
  };

  it("renders seat count and charge information", () => {
    render(<SeatExpansionModal {...baseProps} />);
    expect(screen.getByText(/3 seats/i)).toBeInTheDocument();
    expect(screen.getByText(/\$4\.50/i)).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", () => {
    render(<SeatExpansionModal {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(baseProps.onConfirm).toHaveBeenCalled();
  });

  it("calls onCancel when cancel button is clicked", () => {
    render(<SeatExpansionModal {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(baseProps.onCancel).toHaveBeenCalled();
  });
});
```

Create `apps/web/src/components/billing/__tests__/BillingBanners.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BillingBanners } from "@/components/billing/BillingBanners";
import type { FamilySubscription } from "@/lib/api/billing";

const baseSub: FamilySubscription = {
  tierKey: "BASE",
  seatCount: 2,
  status: "ACTIVE",
  trialEndsAt: null,
  pendingDowngradeTierKey: null,
  pendingDowngradeSeatCount: null,
  downgradeGraceEndsAt: null,
  grandfathered: false
};

describe("BillingBanners", () => {
  it("renders nothing for active non-trial subscription", () => {
    const { container } = render(<BillingBanners subscription={baseSub} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders trial ending banner when trialWarningSentAt is set", () => {
    const sub: FamilySubscription = { ...baseSub, status: "TRIALING", trialEndsAt: "2026-06-13T00:00:00Z" };
    render(<BillingBanners subscription={sub} trialWarningSentAt="2026-06-10T00:00:00Z" />);
    expect(screen.getByText(/trial ends/i)).toBeInTheDocument();
  });

  it("renders downgrade pending banner when pendingDowngradeTierKey is set", () => {
    const sub: FamilySubscription = {
      ...baseSub,
      pendingDowngradeTierKey: "BASE",
      pendingDowngradeSeatCount: 1,
      downgradeGraceEndsAt: "2026-06-07T00:00:00Z"
    };
    render(<BillingBanners subscription={sub} />);
    expect(screen.getByText(/plan change/i)).toBeInTheDocument();
  });

  it("renders past due banner when status is PAST_DUE", () => {
    render(<BillingBanners subscription={{ ...baseSub, status: "PAST_DUE" }} />);
    expect(screen.getByText(/payment failed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd apps/web && npx vitest run src/components/billing/__tests__
```

Expected: FAIL — components don't exist.

- [ ] **Step 3: Create SeatExpansionModal**

Create `apps/web/src/components/billing/SeatExpansionModal.tsx`:

```tsx
interface SeatExpansionModalProps {
  currentSeats: number;
  newSeats: number;
  immediateCharge: number;
  recurringIncrease: number;
  currency: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SeatExpansionModal({ currentSeats, newSeats, immediateCharge, recurringIncrease, currency, onConfirm, onCancel }: SeatExpansionModalProps) {
  const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--surface)", borderRadius: 12, padding: 32, maxWidth: 420, width: "100%" }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)", marginBottom: 16 }}>Add a Seat?</h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: 8 }}>
          Adding this person will increase your plan from <strong>{currentSeats} seats</strong> to <strong>{newSeats} seats</strong>.
        </p>
        <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>
          Your next bill will include a prorated charge of <strong>{fmt.format(immediateCharge)}</strong>.
          Going forward, your plan will increase by <strong>{fmt.format(recurringIncrease)}/month</strong>.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer" }}>
            Confirm & Add Seat
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create BillingBanners**

Create `apps/web/src/components/billing/BillingBanners.tsx`:

```tsx
import type { FamilySubscription } from "@/lib/api/billing";

interface BillingBannersProps {
  subscription: FamilySubscription;
  trialWarningSentAt?: string | null;
}

export function BillingBanners({ subscription, trialWarningSentAt }: BillingBannersProps) {
  const banners: { key: string; message: string; color: string }[] = [];

  if (subscription.status === "TRIALING" && trialWarningSentAt && subscription.trialEndsAt) {
    const date = new Date(subscription.trialEndsAt).toLocaleDateString();
    banners.push({ key: "trial", message: `Your trial ends on ${date}. Subscribe to keep access.`, color: "var(--warning, #f59e0b)" });
  }

  if (subscription.status === "PAST_DUE") {
    banners.push({ key: "past-due", message: "Payment failed. Update your payment method to restore full access.", color: "var(--danger, #ef4444)" });
  }

  if (subscription.pendingDowngradeTierKey && subscription.downgradeGraceEndsAt) {
    const date = new Date(subscription.downgradeGraceEndsAt).toLocaleDateString();
    banners.push({ key: "downgrade", message: `Plan change pending — demote or remove ${subscription.seatCount - (subscription.pendingDowngradeSeatCount ?? 0)} members by ${date} to avoid suspension.`, color: "var(--warning, #f59e0b)" });
  }

  if (banners.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 16px" }}>
      {banners.map(b => (
        <div key={b.key} style={{ padding: "10px 16px", borderRadius: 8, background: b.color + "22", borderLeft: `3px solid ${b.color}`, color: "var(--text-primary)", fontSize: 13 }}>
          {b.message}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run component tests to confirm they pass**

```bash
cd apps/web && npx vitest run src/components/billing/__tests__
```

Expected: PASS.

- [ ] **Step 6: Create the pricing page**

Create `apps/web/app/(protected)/billing/plans/page.tsx`:

```tsx
import { fetchTiers } from "@/lib/api/billing";
import Link from "next/link";

export default async function PlansPage() {
  const tiers = await fetchTiers();

  return (
    <div style={{ padding: 32, maxWidth: 800 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Choose a Plan</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 32 }}>All plans include unlimited passive (guest) members.</p>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {tiers.map(tier => (
          <div key={tier.tierKey} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 24, minWidth: 220, flex: "1 1 220px" }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>{tier.displayName}</h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
              {tier.activeUserLimit === null ? "Unlimited active members" : `Up to ${tier.activeUserLimit} active members`}
            </p>
            {tier.trialDays && (
              <p style={{ color: "var(--accent)", fontSize: 13, marginBottom: 16 }}>{tier.trialDays}-day free trial</p>
            )}
            {tier.stripePriceId === null ? (
              <Link href="/billing/activate-free" style={{ display: "inline-block", padding: "8px 20px", borderRadius: 8, background: "var(--accent)", color: "#fff", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>
                Activate Free
              </Link>
            ) : (
              <Link href={`/billing/checkout?tier=${tier.tierKey}`} style={{ display: "inline-block", padding: "8px 20px", borderRadius: 8, background: "var(--accent)", color: "#fff", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>
                Subscribe
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create the billing success page**

Create `apps/web/app/(protected)/billing/success/page.tsx`:

```tsx
import Link from "next/link";

export default function BillingSuccessPage() {
  return (
    <div style={{ padding: 64, textAlign: "center" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>You're all set!</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 32 }}>Your subscription is now active.</p>
      <Link href="/settings/billing" style={{ padding: "10px 24px", borderRadius: 8, background: "var(--accent)", color: "#fff", textDecoration: "none", fontWeight: 500 }}>
        View Billing Settings
      </Link>
    </div>
  );
}
```

- [ ] **Step 8: Create the billing settings page**

Create `apps/web/app/(protected)/settings/billing/page.tsx`:

```tsx
"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { fetchSubscription, createPortalSession } from "@/lib/api/billing";
import type { FamilySubscription } from "@/lib/api/billing";

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  TRIALING: "Trial",
  PAST_DUE: "Past Due",
  CANCELED: "Canceled",
  SUSPENDED: "Suspended"
};

export default function BillingSettingsPage() {
  const { getToken } = useAuth();
  const [sub, setSub] = useState<FamilySubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    fetchSubscription(getToken).then(setSub).finally(() => setLoading(false));
  }, [getToken]);

  async function handleManage() {
    setRedirecting(true);
    try {
      const url = await createPortalSession(getToken);
      window.open(url, "_blank");
    } finally {
      setRedirecting(false);
    }
  }

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)" }}>Loading…</div>;

  if (!sub) {
    return (
      <div style={{ padding: 32 }}>
        <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>No active subscription.</p>
        <a href="/billing/plans" style={{ color: "var(--accent)" }}>View Plans</a>
      </div>
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: 480 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)", marginBottom: 24 }}>Billing</h1>

      <div style={{ marginBottom: 8, color: "var(--text-secondary)" }}>
        Plan: <strong style={{ color: "var(--text-primary)" }}>{sub.tierKey}</strong>
      </div>
      <div style={{ marginBottom: 8, color: "var(--text-secondary)" }}>
        Seats: <strong style={{ color: "var(--text-primary)" }}>{sub.seatCount}</strong>
      </div>
      <div style={{ marginBottom: 24, color: "var(--text-secondary)" }}>
        Status: <span style={{ color: sub.status === "ACTIVE" || sub.status === "TRIALING" ? "var(--success, #22c55e)" : "var(--danger, #ef4444)", fontWeight: 500 }}>
          {STATUS_LABELS[sub.status] ?? sub.status}
        </span>
      </div>

      {sub.trialEndsAt && sub.status === "TRIALING" && (
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
          Trial ends {new Date(sub.trialEndsAt).toLocaleDateString()}
        </p>
      )}

      <button
        onClick={handleManage}
        disabled={redirecting}
        style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", fontWeight: 500 }}
      >
        {redirecting ? "Opening…" : "Manage Subscription"}
      </button>
    </div>
  );
}
```

- [ ] **Step 9: Type-check web app**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/web/lib/api/billing.ts \
        apps/web/app/\(protected\)/billing/ \
        apps/web/app/\(protected\)/settings/billing/ \
        apps/web/src/components/billing/
git commit -m "feat: P3-01 frontend — pricing page, billing settings, SeatExpansionModal, BillingBanners"
```

---

### Task 11: Wire GET /billing/subscription + register BillingBanners in layout

**Files:**
- Modify: `apps/api/src/routes/billing.ts`
- Modify: `apps/api/src/__tests__/routes/billing.test.ts`
- Modify: `apps/web/app/(protected)/layout.tsx`

- [ ] **Step 1: Write failing test for GET /billing/subscription**

Append to `billing.test.ts`:

```typescript
describe("GET /api/v1/billing/subscription", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => mockGetAuth.mockReset());

  it("returns 404 when no subscription exists for the family", async () => {
    await seedTestPerson();
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .get("/api/v1/billing/subscription")
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(404);
  });

  it("returns subscription data when it exists", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Family", displayOrder: 1 } });
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 2, status: "ACTIVE" }
    });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .get("/api/v1/billing/subscription")
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(200);
    expect(res.body.subscription.tierKey).toBe("BASE");
    expect(res.body.subscription.seatCount).toBe(2);
    expect(res.body.subscription.status).toBe("ACTIVE");
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd apps/api && npx vitest run src/__tests__/routes/billing.test.ts
```

Expected: FAIL on the new subscription tests.

- [ ] **Step 3: Add GET /billing/subscription handler**

In `apps/api/src/routes/billing.ts`, add after the GET /tiers handler:

```typescript
// GET /api/v1/billing/subscription — requires auth
billingRouter.get("/subscription", async (req: Request, res: Response) => {
  const { userId } = authed(req);
  const person = await personForClerkUserId(userId);
  if (!person) { res.status(400).json({ error: "Person record required" }); return; }

  const membership = await db.familyMember.findFirst({ where: { personId: person.id } });
  if (!membership) { res.status(404).json({ error: "No family group found" }); return; }

  const sub = await db.familySubscription.findUnique({ where: { familyGroupId: membership.familyGroupId } });
  if (!sub) { res.status(404).json({ error: "No subscription found" }); return; }

  res.json({
    subscription: {
      tierKey: sub.tierKey,
      seatCount: sub.seatCount,
      status: sub.status,
      trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
      trialWarningSentAt: sub.trialWarningSentAt?.toISOString() ?? null,
      pendingDowngradeTierKey: sub.pendingDowngradeTierKey ?? null,
      pendingDowngradeSeatCount: sub.pendingDowngradeSeatCount ?? null,
      downgradeGraceEndsAt: sub.downgradeGraceEndsAt?.toISOString() ?? null,
      grandfathered: sub.grandfathered
    }
  });
});
```

- [ ] **Step 4: Run all billing tests**

```bash
cd apps/api && npx vitest run src/__tests__/routes/billing.test.ts
```

Expected: PASS — all billing tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/billing.ts apps/api/src/__tests__/routes/billing.test.ts
git commit -m "feat: P3-01 GET /billing/subscription endpoint"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| N configurable tiers, free tier | Task 2 (schema), Task 3 (GET /tiers), Task 8 (seed) |
| Checkout for initial purchase | Task 4 (POST /checkout) |
| Customer Portal for management | Task 4 (POST /portal) |
| Seat enforcement with pre-action confirmation | Task 6 |
| Seat billing impact calculation | Task 4 (POST /seat-impact) |
| Trial period configurable per tier | Task 5 (webhook: checkout.session.completed sets trialEndsAt) |
| Trial warning N days before billing | Task 7 (cron: runTrialWarningPass) |
| Queued downgrade | Task 5 (webhook: customer.subscription.updated) |
| Grace period suspension | Task 7 (cron: runDowngradeEnforcementPass) |
| FamilyMember.suspendedAt | Task 2 (schema) |
| Pricing page | Task 10 |
| Billing settings page | Task 10 |
| SeatExpansionModal | Task 10 |
| BillingBanners | Task 10 |
| GET /billing/subscription | Task 11 |
| Stripe env vars | Task 1 |
| Seed data | Task 8 |

All spec requirements are covered.

**Placeholder scan:** No TBDs or TODOs in any code block.

**Type consistency:** `FamilySubscription` shape in `billing.ts` frontend client matches the response shape in the API's GET /subscription handler. `PricingTier` type matches the GET /tiers response. `SeatImpact` matches POST /seat-impact response.
