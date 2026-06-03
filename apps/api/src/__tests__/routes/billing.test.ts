import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { getAuth } from "@clerk/express";
import { seedTestPerson, seedTestFamily } from "../helpers/db";
import { TEST_CLERK_ID } from "../helpers/auth";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

const mockStripe = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn() } },
  billingPortal: { sessions: { create: vi.fn() } },
  invoices: { retrieveUpcoming: vi.fn() },
  subscriptions: { update: vi.fn(), retrieve: vi.fn() },
  customers: { create: vi.fn() },
  webhooks: { constructEvent: vi.fn() }
}));

vi.mock("stripe", () => {
  function MockStripe() { return mockStripe; }
  MockStripe.prototype = mockStripe;
  return { default: MockStripe };
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

describe("POST /api/v1/billing/checkout", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => {
    mockGetAuth.mockReset();
    mockStripe.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.stripe.com/test" });
    mockStripe.customers.create.mockResolvedValue({ id: "cus_test" });
  });

  it("returns 400 when requester has no person record", async () => {
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/checkout")
      .set("Authorization", "Bearer mock")
      .send({ tierKey: "BASE", seats: 1, successUrl: "http://localhost:3000/success", cancelUrl: "http://localhost:3000/cancel" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when tierKey does not exist", async () => {
    const person = await seedTestPerson();
    await seedTestFamily(person.id);
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
    const person = await seedTestPerson();
    await seedTestFamily(person.id);
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/portal")
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(404);
  });

  it("returns portalUrl when stripeCustomerId exists", async () => {
    mockStripe.billingPortal.sessions.create.mockResolvedValue({ url: "https://billing.stripe.com/test" });

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
    mockStripe.invoices.retrieveUpcoming.mockResolvedValue({ amount_due: 450, currency: "usd" });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: "si_test_seat", price: { id: "price_seat" } }] }
    });

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
    expect(res.body).toMatchObject({ currentSeats: 2, newSeats: 3, immediateCharge: 4.5, currency: "usd" });
  });
});

describe("POST /api/v1/billing/webhook", () => {
  const app = createApp();

  function makeStripeEvent(type: string, data: object): { body: string; sig: string } {
    const payload = JSON.stringify({ id: `evt_${Date.now()}`, type, data: { object: data } });
    return { body: payload, sig: "t=1,v1=test" };
  }

  beforeEach(() => {
    mockStripe.webhooks.constructEvent.mockImplementation((_body: string, _sig: string, _secret: string) => {
      return JSON.parse(_body);
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      status: "active",
      trial_end: null,
      items: { data: [] }
    });
  });

  it("returns 400 for invalid signature", async () => {
    mockStripe.webhooks.constructEvent.mockImplementation(() => { throw new Error("Signature invalid"); });
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

  it("checkout.session.completed — sets status TRIALING when subscription is in trial", async () => {
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      status: "trialing",
      trial_end: Math.floor(Date.now() / 1000) + 14 * 86400,
      items: { data: [] }
    });

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
    expect(sub?.status).toBe("TRIALING");
    expect(sub?.trialEndsAt).not.toBeNull();
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

describe("POST /api/v1/billing/activate-free", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => mockGetAuth.mockReset());

  it("returns 401 when unauthenticated", async () => {
    mockGetAuth.mockReturnValue({ userId: null });
    const res = await request(app)
      .post("/api/v1/billing/activate-free")
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(401);
  });

  it("returns 400 when no person record", async () => {
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/activate-free")
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Person record required");
  });

  it("returns 400 when no family group", async () => {
    await seedTestPerson();
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/activate-free")
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No family group found");
  });

  it("returns 404 when no free tier exists", async () => {
    const person = await seedTestPerson();
    await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "PAID", displayName: "Paid", displayOrder: 1, stripePriceId: "price_paid" } });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/activate-free")
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Free tier not found");
  });

  it("returns 200 and upserts subscription with free tier", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, isActive: true } });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/activate-free")
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(200);
    expect(res.body.activated).toBe(true);
    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.tierKey).toBe("FREE");
    expect(sub?.status).toBe("ACTIVE");
    expect(sub?.seatCount).toBe(1);
  });
});

describe("GET /api/v1/billing/subscription", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => mockGetAuth.mockReset());

  it("returns 404 when no subscription exists for the family", async () => {
    const person = await seedTestPerson();
    await seedTestFamily(person.id);
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
