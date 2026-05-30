# P3-01: Stripe Subscriptions — Design Spec

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Implement subscription billing for FamLink — N configurable tiers (including free), Stripe Checkout for initial purchase, Stripe Customer Portal for ongoing management, seat enforcement with pre-action confirmation, configurable trial periods with pre-billing warnings, and queued downgrade with grace period suspension.

**Architecture:** Stripe is the source of truth for subscription state. The database holds a local cache synced via webhooks. The API never calls Stripe at request time to check subscription status — all enforcement reads local DB state. Stripe is only called on demand for checkout session creation, portal session creation, and seat billing impact calculation.

**Tech stack:** `stripe` npm package (server-side), Prisma 7, Express API, Vitest, React/Next.js App Router, shadcn/ui

---

## 1. Data Model

Three new Prisma models. All follow existing project conventions (camelCase fields, `@@map` snake_case, `@map` for columns, Railway PostgreSQL).

### `PricingTier`

```prisma
model PricingTier {
  tierKey            String   @id @map("tier_key")
  stripePriceId      String?  @map("stripe_price_id")
  stripeSeatPriceId  String?  @map("stripe_seat_price_id")
  activeUserLimit    Int?     @map("active_user_limit")      // null = unlimited
  trialDays          Int?     @map("trial_days")             // null = no trial
  trialWarningDays   Int?     @map("trial_warning_days")     // days before trial end to warn
  downgradeGraceDays Int      @default(7) @map("downgrade_grace_days")
  displayName        String   @map("display_name")
  displayOrder       Int      @map("display_order")
  isActive           Boolean  @default(true) @map("is_active")
  createdAt          DateTime @default(now()) @map("created_at")

  familySubscriptions FamilySubscription[]

  @@map("pricing_tiers")
}
```

Notes:
- `stripePriceId` and `stripeSeatPriceId` are null for free tiers — no Stripe objects needed.
- `activeUserLimit` null means unlimited active users.
- `trialDays` null means no trial offered on this tier.
- `displayOrder` controls the order tiers appear on the pricing page.

### `Promotion`

```prisma
model Promotion {
  id               String    @id @default(cuid())
  stripeCouponId   String    @map("stripe_coupon_id")
  name             String
  startsAt         DateTime  @map("starts_at")
  endsAt           DateTime? @map("ends_at")              // null = indefinite
  eligibleTierKeys String[]  @map("eligible_tier_keys")
  isStackable      Boolean   @default(false) @map("is_stackable")
  createdAt        DateTime  @default(now()) @map("created_at")

  @@map("promotions")
}
```

### `FamilySubscription`

```prisma
model FamilySubscription {
  id                        String    @id @default(cuid())
  familyGroupId             String    @unique @map("family_group_id")
  stripeCustomerId          String?   @map("stripe_customer_id")
  stripeSubscriptionId      String?   @map("stripe_subscription_id")  // null for free tier
  tierKey                   String    @map("tier_key")
  seatCount                 Int       @default(1) @map("seat_count")
  grandfathered             Boolean   @default(false)
  priceLockedAt             DateTime? @map("price_locked_at")
  status                    String    @default("ACTIVE") @map("status")
  // status values: ACTIVE | TRIALING | PAST_DUE | CANCELED | SUSPENDED
  trialEndsAt               DateTime? @map("trial_ends_at")
  trialWarningSentAt        DateTime? @map("trial_warning_sent_at")
  pendingDowngradeTierKey   String?   @map("pending_downgrade_tier_key")
  pendingDowngradeSeatCount Int?      @map("pending_downgrade_seat_count")
  downgradeGraceEndsAt      DateTime? @map("downgrade_grace_ends_at")
  createdAt                 DateTime  @default(now()) @map("created_at")
  updatedAt                 DateTime  @updatedAt @map("updated_at")

  familyGroup FamilyGroup  @relation(fields: [familyGroupId], references: [id])
  pricingTier PricingTier  @relation(fields: [tierKey], references: [tierKey])

  @@map("family_subscriptions")
}
```

`FamilyGroup` model gains a `subscription FamilySubscription?` relation field.

`FamilyMember` model gains one field to support suspension:

```prisma
suspendedAt DateTime? @map("suspended_at")  // set by downgrade enforcement; null = not suspended
```

---

## 2. API Endpoints

All billing routes live under `/api/v1/billing`. All require Clerk auth except the webhook endpoint.

### `GET /api/v1/billing/tiers`

Returns all active pricing tiers for display. Public (no auth required — needed for the marketing/plans page).

**Response:**
```json
{
  "tiers": [
    {
      "tierKey": "FREE",
      "displayName": "Free",
      "activeUserLimit": 1,
      "stripePriceId": null,
      "trialDays": null,
      "displayOrder": 0,
      "isActive": true
    },
    {
      "tierKey": "BASE",
      "displayName": "Family",
      "activeUserLimit": 5,
      "stripePriceId": "price_xxx",
      "trialDays": 14,
      "displayOrder": 1,
      "isActive": true
    }
  ]
}
```

### `GET /api/v1/billing/subscription`

Returns the current family's subscription state. Family admin only.

**Response:**
```json
{
  "subscription": {
    "tierKey": "BASE",
    "seatCount": 3,
    "status": "TRIALING",
    "trialEndsAt": "2026-06-13T00:00:00Z",
    "pendingDowngrade": null,
    "grandfathered": false
  }
}
```

### `POST /api/v1/billing/checkout`

Creates a Stripe Checkout session for initial subscription. Family admin only.

**Request:**
```json
{
  "tierKey": "BASE",
  "seats": 1,
  "successUrl": "https://app.famlink.com/billing/success",
  "cancelUrl": "https://app.famlink.com/billing/plans"
}
```

**Response:**
```json
{ "checkoutUrl": "https://checkout.stripe.com/..." }
```

Implementation notes:
- Creates (or retrieves) a Stripe Customer for the family group.
- Creates a Checkout session with `mode: "subscription"`, attaching the base price and seat price (if applicable) as line items.
- If the tier has `trialDays`, sets `subscription_data.trial_period_days`.
- Applies any active `Promotion` via `discounts: [{ coupon: stripeCouponId }]`.
- Does NOT immediately update `family_subscriptions` — waits for `checkout.session.completed` webhook.

### `POST /api/v1/billing/portal`

Creates a Stripe Customer Portal session. Family admin only. Family must have a `stripeCustomerId`.

**Response:**
```json
{ "portalUrl": "https://billing.stripe.com/..." }
```

### `POST /api/v1/billing/seat-impact`

Calculates the billing impact of adding a seat before the admin confirms. Family admin only.

**Request:**
```json
{ "newSeatCount": 4 }
```

**Response:**
```json
{
  "currentSeats": 3,
  "newSeats": 4,
  "immediateCharge": 4.50,
  "recurringIncrease": 9.00,
  "currency": "usd"
}
```

Implementation: calls `stripe.invoices.retrieveUpcoming()` with modified subscription items to get the prorated amount. This is the only request-time Stripe API call in the system.

### `POST /api/v1/billing/webhook`

Stripe-signed webhook endpoint. Must use raw body (not JSON-parsed) for signature verification.

**Handled events:**

| Event | Action |
|---|---|
| `checkout.session.completed` | Create/update `family_subscriptions`; set trial dates if applicable; upsert `stripeCustomerId` |
| `customer.subscription.updated` | Sync `tierKey`, `seatCount`, `status`, `trialEndsAt`; detect downgrade → set `pendingDowngradeTierKey`, `pendingDowngradeSeatCount`, `downgradeGraceEndsAt`; notify admin if downgrade detected |
| `customer.subscription.deleted` | Set `status = CANCELED`; if a free tier exists, revert to it; notify admin |
| `invoice.payment_failed` | Set `status = PAST_DUE`; notify admin via email + in-app |
| `invoice.payment_succeeded` | Clear `PAST_DUE` status if set; set `status = ACTIVE` |

All other events: return `200` and ignore.

---

## 3. Enforcement Logic

### Seat expansion check

Called from the invite/activation flow in `apps/api/src/routes/persons.ts` and any route that elevates a passive person to active.

```typescript
// apps/api/src/lib/subscriptionEnforcement.ts

export async function checkSeatExpansion(
  familyGroupId: string,
  currentActiveCount: number
): Promise<{ allowed: boolean; requiresConfirmation: boolean }> {
  const sub = await db.familySubscription.findUnique({ where: { familyGroupId }, include: { pricingTier: true } });
  if (!sub) return { allowed: true, requiresConfirmation: false }; // no subscription record yet = free
  if (sub.pricingTier.activeUserLimit === null) return { allowed: true, requiresConfirmation: false }; // unlimited
  if (currentActiveCount < sub.seatCount) return { allowed: true, requiresConfirmation: false }; // under declared seats
  // at or over limit — requires confirmation + seat expansion
  return { allowed: true, requiresConfirmation: true };
}
```

The route that invites/activates a user:
1. Calls `checkSeatExpansion`.
2. If `requiresConfirmation`: returns `402` with billing impact (triggers frontend modal).
3. Frontend confirms → client re-submits with `{ confirmSeatExpansion: true }`.
4. API calls `stripe.subscriptions.update()` to increment quantity, then updates local `seatCount`, then proceeds.

### Daily enforcement cron (`apps/api/src/jobs/billingEnforcement.ts`)

Runs once per day. Two passes:

**Trial warning pass:**
```
SELECT * FROM family_subscriptions
WHERE trial_ends_at IS NOT NULL
  AND trial_warning_sent_at IS NULL
  AND trial_ends_at - NOW() <= (
    SELECT trial_warning_days * INTERVAL '1 day'
    FROM pricing_tiers
    WHERE tier_key = family_subscriptions.tier_key
  )
```
For each match: send email + in-app notification to family admin; stamp `trial_warning_sent_at`.

**Downgrade enforcement pass:**
```
SELECT * FROM family_subscriptions
WHERE downgrade_grace_ends_at IS NOT NULL
  AND downgrade_grace_ends_at < NOW()
```
For each match:
1. Count current active users in the family group.
2. If count > `pendingDowngradeSeatCount`: suspend the over-limit active users — specifically those with the most recent `FamilyMember.createdAt` (newest members first) until the count is at or below the new seat limit. Set `FamilyMember.suspendedAt = NOW()` on each suspended member.
3. Apply the downgrade: update `tierKey`, `seatCount`, clear `pendingDowngrade*` fields.
4. Notify admin of which accounts were suspended.

Suspension is reversible: admin upgrades or demotes the suspended user to passive → suspension lifts.

---

## 4. Frontend

### `/billing/plans` — Pricing page

Visible to family admins on the free tier or with no subscription. Fetches `GET /billing/tiers` on load. Renders N tier cards from API response (no hardcoded tier count or layout). Each card:
- Display name, active user limit (or "Unlimited"), price (or "Free")
- Trial callout if `trialDays` is set ("14-day free trial")
- Subscribe button → calls `POST /billing/checkout` → redirects to Stripe Checkout URL
- Free tier shows "Activate" button (no redirect — calls a direct activation endpoint)

### `/settings/billing` — Billing settings

Visible to family admins. Fetches `GET /billing/subscription` on load. Shows:
- Current tier name and seat count
- Status badge (Active / Trialing / Past Due / Suspended)
- Trial end date if `status = TRIALING`
- Pending downgrade notice if `pendingDowngradeTierKey` is set
- "Manage Subscription" button → calls `POST /billing/portal` → opens Stripe Customer Portal in new tab

### Seat expansion modal (`SeatExpansionModal`)

Triggered when the API returns `402` during invite/activation. Props: `{ currentSeats, newSeats, immediateCharge, recurringIncrease, currency }`.

```
Adding [Name] as an active member will increase your plan from
[N] to [N+1] seats.

Your next bill will include a prorated charge of $X.XX.
Going forward, your plan will increase by $X.XX/month.

[Cancel]  [Confirm & Add Seat]
```

On confirm: re-submits the original request with `confirmSeatExpansion: true`.

### Notification banners (in-app)

Rendered in the main app shell for the family admin:

- **Trial ending:** "Your free trial ends on [date]. Subscribe now to keep access." (shown when `trialWarningSentAt` is set and trial has not ended)
- **Downgrade pending:** "Your plan changes on [date]. Please demote or remove [N] active members before then to avoid suspension."
- **Past due:** "Your last payment failed. Update your payment method to restore full access."
- **Suspended users:** "Some family members have been suspended due to a plan change. Upgrade or demote them to restore access."

---

## 5. Seed Data

Add initial `pricing_tiers` rows to `packages/db/prisma/seed.ts` (Stripe Price IDs are placeholders for local dev — actual IDs configured via env vars in production):

```typescript
await db.pricingTier.createMany({
  data: [
    {
      tierKey: "FREE",
      displayName: "Free",
      activeUserLimit: 1,
      trialDays: null,
      trialWarningDays: null,
      downgradeGraceDays: 7,
      displayOrder: 0,
      isActive: true,
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
      isActive: true,
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
      isActive: true,
    },
  ],
  skipDuplicates: true,
});
```

---

## 6. Environment Variables

New env vars required in `apps/api/.env` and Railway:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BASE=price_...
STRIPE_PRICE_BASE_SEAT=price_...
STRIPE_PRICE_UNLIMITED=price_...
STRIPE_CUSTOMER_PORTAL_URL=https://billing.stripe.com/...   # optional: pre-configured portal URL
```

New env vars required in `apps/web/.env.local` and Vercel:

```
NEXT_PUBLIC_BILLING_SUCCESS_URL=https://app.famlink.com/billing/success
NEXT_PUBLIC_BILLING_CANCEL_URL=https://app.famlink.com/billing/plans
```

---

## 7. Testing

**API (Vitest):**
- `billing.test.ts` — `GET /billing/tiers` returns active tiers; `POST /billing/checkout` creates Checkout session (mock Stripe client); `POST /billing/portal` creates portal session; `POST /billing/seat-impact` returns billing impact (mock Stripe upcoming invoice).
- `billing.webhook.test.ts` — one test per handled webhook event: verify DB state after `checkout.session.completed`, `customer.subscription.updated` (including downgrade detection), `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`.
- `subscriptionEnforcement.test.ts` — `checkSeatExpansion` returns correct `requiresConfirmation` for under-limit, at-limit, over-limit, and unlimited tiers.
- `billingEnforcement.job.test.ts` — trial warning pass sends notification and stamps `trialWarningSentAt`; does not double-send; downgrade enforcement suspends correct users when grace period expires.

**Web (Vitest + jsdom):**
- `SeatExpansionModal.test.tsx` — renders billing impact; confirm calls callback; cancel dismisses.
- `PricingPage.test.tsx` — renders N tiers from mocked API response; free tier shows Activate; paid tiers show Subscribe.
- `BillingSettingsPage.test.tsx` — renders subscription status; Manage Subscription button calls portal endpoint.

---

## 8. Out of Scope

- Commerce / affiliate purchasing (Phase 3 Layer 3 — P3-05)
- FamLink staff moderation queue billing (separate internal tooling)
- CCPA / GDPR billing data handling (Phase 3+ compliance program)
- Mobile billing UI — web-only for this iteration; mobile links out to web billing pages
