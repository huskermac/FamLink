import { Router } from "express";
import { z } from "zod";
import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import { stripe } from "../lib/stripeClient";
import { env } from "../lib/env";
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

// GET /api/v1/billing/tiers — public, no auth required
billingRouter.get("/tiers", async (_req: Request, res: Response) => {
  const tiers = await db.pricingTier.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" }
  });
  res.json({ tiers });
});

const CheckoutSchema = z.object({
  tierKey: z.string().min(1),
  seats: z.number().int().positive().default(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});

// POST /api/v1/billing/checkout
billingRouter.post("/checkout", async (req: Request, res: Response) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const person = await personForClerkUserId(userId);
  if (!person) { res.status(400).json({ error: "Person record required" }); return; }

  const body = CheckoutSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }

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

  const lineItems: Array<{ price: string; quantity: number }> = [];
  if (tier.stripePriceId) {
    lineItems.push({ price: tier.stripePriceId, quantity: 1 });
  }
  if (tier.stripeSeatPriceId && body.data.seats > 0) {
    lineItems.push({ price: tier.stripeSeatPriceId, quantity: body.data.seats });
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
});

// POST /api/v1/billing/portal
billingRouter.post("/portal", async (req: Request, res: Response) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const person = await personForClerkUserId(userId);
  if (!person) { res.status(400).json({ error: "Person record required" }); return; }

  const membership = await db.familyMember.findFirst({ where: { personId: person.id } });
  if (!membership) { res.status(400).json({ error: "No family group found" }); return; }

  const sub = await db.familySubscription.findUnique({ where: { familyGroupId: membership.familyGroupId } });
  if (!sub?.stripeCustomerId) { res.status(404).json({ error: "No billing account found" }); return; }

  const returnUrl = `${env.WEB_APP_URL}/settings/billing`;
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: returnUrl
  });
  if (!session.url) { res.status(502).json({ error: "Stripe did not return a URL" }); return; }
  res.json({ portalUrl: session.url });
});

const SeatImpactSchema = z.object({ newSeatCount: z.number().int().positive() });

// POST /api/v1/billing/seat-impact
billingRouter.post("/seat-impact", async (req: Request, res: Response) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
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

  // Retrieve the Stripe subscription to get the seat price item ID
  const stripeSub = await (stripe.subscriptions as any).retrieve(sub.stripeSubscriptionId);
  const seatItem = stripeSub.items?.data?.find(
    (item: any) => item.price?.id === sub.pricingTier.stripeSeatPriceId
  );
  if (!seatItem) {
    res.status(400).json({ error: "Seat price item not found on subscription" }); return;
  }

  const upcoming = await (stripe.invoices as any).retrieveUpcoming({
    customer: sub.stripeCustomerId!,
    subscription: sub.stripeSubscriptionId,
    subscription_items: [{ id: seatItem.id, quantity: body.data.newSeatCount }]
  });

  res.json({
    currentSeats: sub.seatCount,
    newSeats: body.data.newSeatCount,
    immediateCharge: upcoming.amount_due / 100,
    currency: upcoming.currency
  });
});

// --- Webhook handler ---

function rawBody(req: Request): string {
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  return typeof req.body === "string" ? req.body : JSON.stringify(req.body);
}

billingWebhookRouter.post("/", async (req: Request, res: Response) => {
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
});

async function handleStripeEvent(event: ReturnType<typeof stripe.webhooks.constructEvent>): Promise<void> {
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
