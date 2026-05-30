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

  const upcoming = await (stripe.invoices as any).retrieveUpcoming({
    customer: sub.stripeCustomerId!,
    subscription: sub.stripeSubscriptionId,
    subscription_items: [{ id: sub.stripeSubscriptionId, quantity: body.data.newSeatCount }]
  });

  res.json({
    currentSeats: sub.seatCount,
    newSeats: body.data.newSeatCount,
    immediateCharge: upcoming.amount_due / 100,
    currency: upcoming.currency
  });
});
