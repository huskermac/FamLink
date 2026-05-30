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
