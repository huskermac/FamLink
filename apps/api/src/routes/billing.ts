import { Router } from "express";
import { z } from "zod";
import { getAuth } from "@clerk/express";
import { db, type FamilyMember, type Person } from "@famlink/db";
import { stripe } from "../lib/stripeClient";
import { env } from "../lib/env";
import { activeFamilyMembership, hasAdminRole } from "../lib/familyAccess";
import { asyncHandler } from "../middleware/asyncHandler";
import type { Request, Response } from "express";

export const billingRouter = Router();
// Registered in server.ts with express.raw() before express.json() — see Task 5
export const billingWebhookRouter = Router();

async function personForClerkUserId(clerkUserId: string) {
  return db.person.findUnique({ where: { userId: clerkUserId } });
}

async function familySubscriptionForFamily(familyGroupId: string) {
  return db.familySubscription.findUnique({
    where: { familyGroupId },
    include: { pricingTier: true }
  });
}

const FamilyScopeBodySchema = z.object({ familyGroupId: z.string().min(1).optional() });

interface BillingScope {
  person: Person;
  membership: FamilyMember;
}

/**
 * Resolve the requester and the target family for a billing operation.
 * - `familyGroupId` given → requester must be a member of that family.
 * - omitted → only valid when the requester belongs to exactly ONE family
 *   (never a silent findFirst pick for multi-family users).
 * Billing mutations additionally require the ADMIN role (decision 2026-06-10).
 * Writes the error response and returns null on failure.
 */
async function resolveBillingScope(
  req: Request,
  res: Response,
  familyGroupId: string | undefined,
  opts: { requireAdmin?: boolean } = {}
): Promise<BillingScope | null> {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return null; }
  const person = await personForClerkUserId(userId);
  if (!person) { res.status(400).json({ error: "Person record required" }); return null; }

  let membership: FamilyMember | null;
  if (familyGroupId) {
    membership = await activeFamilyMembership(familyGroupId, person.id);
    if (!membership) { res.status(403).json({ error: "Not a member of this family" }); return null; }
  } else {
    const memberships = await db.familyMember.findMany({ where: { personId: person.id, suspendedAt: null }, take: 2 });
    if (memberships.length === 0) { res.status(400).json({ error: "No family group found" }); return null; }
    if (memberships.length > 1) {
      res.status(400).json({ error: "familyGroupId is required when you belong to multiple families" });
      return null;
    }
    membership = memberships[0];
  }

  if (opts.requireAdmin && !hasAdminRole(membership)) {
    res.status(403).json({ error: "Only a family admin can manage billing" });
    return null;
  }

  return { person, membership };
}

// GET /api/v1/billing/tiers — public, no auth required
billingRouter.get("/tiers", asyncHandler(async (_req: Request, res: Response) => {
  const tiers = await db.pricingTier.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" }
  });
  res.json({ tiers });
}));

// GET /api/v1/billing/subscription?familyGroupId=...
// Readable by any member of the family (banners); mutations below are admin-only.
billingRouter.get("/subscription", asyncHandler(async (req: Request, res: Response) => {
  const q = z.object({ familyGroupId: z.string().min(1).optional() }).safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: "Invalid query" }); return; }

  const scope = await resolveBillingScope(req, res, q.data.familyGroupId);
  if (!scope) return;

  const sub = await db.familySubscription.findUnique({ where: { familyGroupId: scope.membership.familyGroupId } });
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
}));

const CheckoutSchema = FamilyScopeBodySchema.extend({
  tierKey: z.string().min(1),
  seats: z.number().int().positive().default(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});

// POST /api/v1/billing/checkout
billingRouter.post("/checkout", asyncHandler(async (req: Request, res: Response) => {
  const body = CheckoutSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const scope = await resolveBillingScope(req, res, body.data.familyGroupId, { requireAdmin: true });
  if (!scope) return;
  const { membership } = scope;

  const tier = await db.pricingTier.findUnique({ where: { tierKey: body.data.tierKey } });
  if (!tier) { res.status(404).json({ error: "Tier not found" }); return; }

  const sub = await db.familySubscription.findUnique({ where: { familyGroupId: membership.familyGroupId } });
  let customerId = sub?.stripeCustomerId ?? null;

  if (!customerId) {
    const customer = await stripe.customers.create({ metadata: { familyGroupId: membership.familyGroupId } });
    customerId = customer.id;
  }

  const lineItems: Array<{ price: string; quantity: number }> = [];
  if (tier.stripePriceId) {
    lineItems.push({ price: tier.stripePriceId, quantity: 1 });
  }
  // `seats` is the TOTAL active-user count; the base price covers
  // tier.includedSeats of them and only the overflow is billed.
  const billableSeats = Math.max(0, body.data.seats - tier.includedSeats);
  if (tier.stripeSeatPriceId && billableSeats > 0) {
    lineItems.push({ price: tier.stripeSeatPriceId, quantity: billableSeats });
  }

  const session = await stripe.checkout.sessions.create({
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
  });
  if (!session.url) { res.status(502).json({ error: "Stripe did not return a URL" }); return; }
  res.json({ checkoutUrl: session.url });
}));

// POST /api/v1/billing/portal
billingRouter.post("/portal", asyncHandler(async (req: Request, res: Response) => {
  const body = FamilyScopeBodySchema.safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const scope = await resolveBillingScope(req, res, body.data.familyGroupId, { requireAdmin: true });
  if (!scope) return;
  const { membership } = scope;

  const sub = await db.familySubscription.findUnique({ where: { familyGroupId: membership.familyGroupId } });
  if (!sub?.stripeCustomerId) { res.status(404).json({ error: "No billing account found" }); return; }

  const returnUrl = `${env.WEB_APP_URL}/settings/billing`;
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: returnUrl
  });
  if (!session.url) { res.status(502).json({ error: "Stripe did not return a URL" }); return; }
  res.json({ portalUrl: session.url });
}));

const SeatImpactSchema = FamilyScopeBodySchema.extend({ newSeatCount: z.number().int().positive() });

// POST /api/v1/billing/seat-impact
billingRouter.post("/seat-impact", asyncHandler(async (req: Request, res: Response) => {
  const body = SeatImpactSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const scope = await resolveBillingScope(req, res, body.data.familyGroupId, { requireAdmin: true });
  if (!scope) return;
  const { membership } = scope;

  const sub = await familySubscriptionForFamily(membership.familyGroupId);
  if (!sub?.stripeSubscriptionId || !sub.pricingTier.stripeSeatPriceId) {
    res.status(400).json({ error: "No seat-based subscription found" }); return;
  }

  // Seat counts are totals; only seats beyond the tier's included allowance
  // are billed on the per-seat price.
  const newBillable = Math.max(0, body.data.newSeatCount - sub.pricingTier.includedSeats);

  // Retrieve the Stripe subscription to find an existing seat item (absent
  // while the family is still within the included allowance).
  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  const seatItem = stripeSub.items.data.find(
    (item) => item.price?.id === sub.pricingTier.stripeSeatPriceId
  );
  const currentBillable = seatItem?.quantity ?? 0;

  if (newBillable === currentBillable) {
    res.json({
      currentSeats: sub.seatCount,
      newSeats: body.data.newSeatCount,
      immediateCharge: 0,
      recurringIncrease: 0,
      currency: stripeSub.currency
    });
    return;
  }

  const seatUnitAmount = seatItem?.price?.unit_amount
    ?? (await stripe.prices.retrieve(sub.pricingTier.stripeSeatPriceId)).unit_amount
    ?? 0;

  const upcoming = await stripe.invoices.createPreview({
    customer: sub.stripeCustomerId!,
    subscription: sub.stripeSubscriptionId,
    subscription_details: {
      items: [
        seatItem
          ? { id: seatItem.id, quantity: newBillable }
          : { price: sub.pricingTier.stripeSeatPriceId, quantity: newBillable }
      ]
    }
  });

  res.json({
    currentSeats: sub.seatCount,
    newSeats: body.data.newSeatCount,
    immediateCharge: upcoming.amount_due / 100,
    recurringIncrease: ((newBillable - currentBillable) * seatUnitAmount) / 100,
    currency: upcoming.currency
  });
}));

// POST /api/v1/billing/activate-free
billingRouter.post("/activate-free", asyncHandler(async (req: Request, res: Response) => {
  const body = FamilyScopeBodySchema.safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const scope = await resolveBillingScope(req, res, body.data.familyGroupId, { requireAdmin: true });
  if (!scope) return;
  const { membership } = scope;

  const freeTier = await db.pricingTier.findFirst({
    where: { isActive: true, stripePriceId: null },
    orderBy: { displayOrder: "asc" }
  });
  if (!freeTier) { res.status(404).json({ error: "Free tier not found" }); return; }

  // Stripe is the source of truth (decision 2026-06-10): cancel any live paid
  // subscription FIRST so the customer stops being charged; the
  // customer.subscription.deleted webhook is the confirmation path.
  const existing = await db.familySubscription.findUnique({
    where: { familyGroupId: membership.familyGroupId }
  });
  if (existing?.stripeSubscriptionId) {
    await stripe.subscriptions.cancel(existing.stripeSubscriptionId);
  }

  await db.familySubscription.upsert({
    where: { familyGroupId: membership.familyGroupId },
    create: {
      familyGroupId: membership.familyGroupId,
      tierKey: freeTier.tierKey,
      status: "ACTIVE",
      seatCount: 1
    },
    update: {
      tierKey: freeTier.tierKey,
      status: "ACTIVE",
      stripeSubscriptionId: null
    }
  });

  res.json({ activated: true });
}));

// --- Webhook handler ---

function rawBody(req: Request): string {
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  return typeof req.body === "string" ? req.body : JSON.stringify(req.body);
}

billingWebhookRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string;
  let event: ReturnType<typeof stripe.webhooks.constructEvent>;

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
}));

/**
 * Total seat allowance = the tier's included seats + the billed quantity on
 * the per-seat price item (absent while the family is within the allowance).
 */
function totalSeatsFromStripeItems(
  items: Array<{ price?: { id?: string | null } | null; quantity?: number }> | undefined,
  tier: { stripeSeatPriceId: string | null; includedSeats: number }
): number {
  const seatItem = (items ?? []).find((i) => i.price?.id === tier.stripeSeatPriceId);
  return (seatItem?.quantity ?? 0) + tier.includedSeats;
}

async function handleStripeEvent(event: ReturnType<typeof stripe.webhooks.constructEvent>): Promise<void> {
  const obj = event.data.object as any;

  switch (event.type) {
    case "checkout.session.completed": {
      const { familyGroupId, tierKey } = obj.metadata ?? {};
      if (!familyGroupId || !tierKey || !obj.subscription) return;

      // Fetch the subscription to get accurate trial status + seat quantity
      const stripeSub = await stripe.subscriptions.retrieve(obj.subscription as string);
      const status = stripeSub.status === "trialing" ? "TRIALING" : "ACTIVE";
      const trialEndsAt = stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null;

      const tier = await db.pricingTier.findUnique({ where: { tierKey } });
      const seatCount = tier
        ? totalSeatsFromStripeItems(stripeSub.items.data, tier)
        : 1;

      await db.familySubscription.upsert({
        where: { familyGroupId },
        create: {
          familyGroupId,
          tierKey,
          stripeCustomerId: obj.customer,
          stripeSubscriptionId: obj.subscription,
          status,
          trialEndsAt,
          seatCount
        },
        update: {
          stripeCustomerId: obj.customer,
          stripeSubscriptionId: obj.subscription,
          tierKey,
          status,
          trialEndsAt,
          seatCount
        }
      });
      break;
    }

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
      const isDowngrade = newTier !== null && newSeatCount < existing.seatCount;

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
      await db.familySubscription.updateMany({
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
      // Only clear PAST_DUE; TRIALING→ACTIVE is handled by customer.subscription.updated
      if (!sub || sub.status !== "PAST_DUE") return;
      await db.familySubscription.update({ where: { id: sub.id }, data: { status: "ACTIVE" } });
      break;
    }

    default:
      break;
  }
}
