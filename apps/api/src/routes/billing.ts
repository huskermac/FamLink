import { Router } from "express";
import { db } from "@famlink/db";
import type { Request, Response } from "express";

export const billingRouter = Router();
export const billingWebhookRouter = Router();

// GET /api/v1/billing/tiers — public, no auth required
billingRouter.get("/tiers", async (_req: Request, res: Response) => {
  const tiers = await db.pricingTier.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" }
  });
  res.json({ tiers });
});
