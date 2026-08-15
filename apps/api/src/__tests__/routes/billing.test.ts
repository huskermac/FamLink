import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { getAuth } from "@clerk/express";
import { seedTestPerson, seedTestFamily, seedSecondPerson } from "../helpers/db";
import { TEST_CLERK_ID, TEST_USER_2_CLERK_ID } from "../helpers/auth";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

const mockStripe = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn() } },
  billingPortal: { sessions: { create: vi.fn() } },
  invoices: { createPreview: vi.fn() },
  prices: { retrieve: vi.fn() },
  subscriptions: { update: vi.fn(), retrieve: vi.fn(), cancel: vi.fn() },
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
    await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Family", displayOrder: 1, stripePriceId: "price_base", activeUserLimit: 5 } });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/checkout")
      .set("Authorization", "Bearer mock")
      .send({ tierKey: "BASE", seats: 1, successUrl: "http://localhost:3000/success", cancelUrl: "http://localhost:3000/cancel" });
    expect(res.status).toBe(200);
    expect(res.body.checkoutUrl).toBe("https://checkout.stripe.com/test");
  });

  it("bills only seats beyond the included allowance at checkout", async () => {
    const person = await seedTestPerson();
    await seedTestFamily(person.id);
    await db.pricingTier.create({
      data: { tierKey: "FAM12", displayName: "Family", displayOrder: 1, stripePriceId: "price_base", stripeSeatPriceId: "price_seat", includedSeats: 12, activeUserLimit: 50 }
    });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/checkout")
      .set("Authorization", "Bearer mock")
      .send({ tierKey: "FAM12", seats: 14, successUrl: "http://localhost:3000/s", cancelUrl: "http://localhost:3000/c" });
    expect(res.status).toBe(200);
    const args = mockStripe.checkout.sessions.create.mock.calls.at(-1)[0];
    expect(args.line_items).toEqual([
      { price: "price_base", quantity: 1 },
      { price: "price_seat", quantity: 2 } // 14 total - 12 included
    ]);
  });

  it("adds no seat line item when seats are within the included allowance", async () => {
    const person = await seedTestPerson();
    await seedTestFamily(person.id);
    await db.pricingTier.create({
      data: { tierKey: "FAM12", displayName: "Family", displayOrder: 1, stripePriceId: "price_base", stripeSeatPriceId: "price_seat", includedSeats: 12, activeUserLimit: 50 }
    });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/checkout")
      .set("Authorization", "Bearer mock")
      .send({ tierKey: "FAM12", seats: 5, successUrl: "http://localhost:3000/s", cancelUrl: "http://localhost:3000/c" });
    expect(res.status).toBe(200);
    const args = mockStripe.checkout.sessions.create.mock.calls.at(-1)[0];
    expect(args.line_items).toEqual([{ price: "price_base", quantity: 1 }]);
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

  it("returns billing impact — bills only seats beyond the included allowance", async () => {
    mockStripe.invoices.createPreview.mockResolvedValue({ amount_due: 450, currency: "usd" });
    // seatCount 2 = 1 included + 1 billed, so the seat item exists with qty 1
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: "si_test_seat", quantity: 1, price: { id: "price_seat", unit_amount: 300 } }] }
    });

    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Family", displayOrder: 1, stripePriceId: "price_base", stripeSeatPriceId: "price_seat", includedSeats: 1, activeUserLimit: 5 } });
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 2, stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test" }
    });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/seat-impact")
      .set("Authorization", "Bearer mock")
      .send({ newSeatCount: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currentSeats: 2, newSeats: 3, immediateCharge: 4.5, recurringIncrease: 3, currency: "usd" });
    expect(mockStripe.invoices.createPreview).toHaveBeenCalledWith({
      customer: "cus_test",
      subscription: "sub_test",
      subscription_details: { items: [{ id: "si_test_seat", quantity: 2 }] }
    });
  });

  it("adds the seat item by price when the family is still within the included allowance", async () => {
    mockStripe.invoices.createPreview.mockResolvedValue({ amount_due: 200, currency: "usd" });
    mockStripe.prices.retrieve.mockResolvedValue({ unit_amount: 200 });
    // seatCount 3 = all included, no seat item on the subscription yet
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [] } });

    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "FAM12", displayName: "Family", displayOrder: 1, stripePriceId: "price_base", stripeSeatPriceId: "price_seat", includedSeats: 3, activeUserLimit: 50 } });
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "FAM12", seatCount: 3, stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test" }
    });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/seat-impact")
      .set("Authorization", "Bearer mock")
      .send({ newSeatCount: 4 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currentSeats: 3, newSeats: 4, immediateCharge: 2, recurringIncrease: 2, currency: "usd" });
    expect(mockStripe.invoices.createPreview).toHaveBeenCalledWith({
      customer: "cus_test",
      subscription: "sub_test",
      subscription_details: { items: [{ price: "price_seat", quantity: 1 }] }
    });
  });

  it("reports zero impact when the new total is still within the included allowance", async () => {
    mockStripe.invoices.createPreview.mockClear();
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [] }, currency: "usd" });

    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "FAM12", displayName: "Family", displayOrder: 1, stripePriceId: "price_base", stripeSeatPriceId: "price_seat", includedSeats: 12, activeUserLimit: 50 } });
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "FAM12", seatCount: 12, stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test" }
    });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/seat-impact")
      .set("Authorization", "Bearer mock")
      .send({ newSeatCount: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currentSeats: 12, newSeats: 5, immediateCharge: 0, recurringIncrease: 0 });
    expect(mockStripe.invoices.createPreview).not.toHaveBeenCalled();
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

  it("customer.subscription.updated — syncs tier/seatCount/status and does NOT schedule a downgrade", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    // BASE carries a seat price so totalSeatsFromStripeItems can find the item.
    await db.pricingTier.createMany({ data: [
      { tierKey: "MID", displayName: "Mid", displayOrder: 1, includedSeats: 5, stripePriceId: "price_mid", stripeSeatPriceId: "price_seat" },
      { tierKey: "BASE", displayName: "Base", displayOrder: 0, includedSeats: 2, stripePriceId: "price_base", stripeSeatPriceId: "price_seat" }
    ]});
    // existing seatCount 6 > the incoming total (4) => OLD code detects a
    // downgrade and writes pendingDowngrade*; new code must NOT. That gap is the RED.
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "MID", seatCount: 6, stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test", status: "ACTIVE" }
    });

    const { body, sig } = makeStripeEvent("customer.subscription.updated", {
      id: "sub_test",
      metadata: { familyGroupId: familyGroup.id, tierKey: "BASE" },
      status: "active",
      items: { data: [{ price: { id: "price_seat" }, quantity: 2 }] }
    });

    const res = await request(app)
      .post("/api/v1/billing/webhook")
      .set("stripe-signature", sig)
      .set("content-type", "application/json")
      .send(body);

    expect(res.status).toBe(200);
    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.tierKey).toBe("BASE");
    expect(sub?.seatCount).toBe(4); // 2 billed + includedSeats 2 (BASE)
    expect(sub?.pendingDowngradeTierKey).toBeNull();
    expect(sub?.pendingDowngradeSeatCount).toBeNull();
    expect(sub?.downgradeGraceEndsAt).toBeNull();
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

  it("cancels the live Stripe subscription before switching to free (Stripe = SOT)", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.createMany({
      data: [
        { tierKey: "FREE", displayName: "Free", displayOrder: 0, isActive: true },
        { tierKey: "BASE", displayName: "Family", displayOrder: 1, stripePriceId: "price_base" }
      ]
    });
    await db.familySubscription.create({
      data: {
        familyGroupId: familyGroup.id,
        tierKey: "BASE",
        seatCount: 3,
        stripeCustomerId: "cus_live",
        stripeSubscriptionId: "sub_live"
      }
    });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/activate-free")
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(200);
    expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith("sub_live");
    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.tierKey).toBe("FREE");
    expect(sub?.stripeSubscriptionId).toBeNull();
  });

  it("returns 403 for a non-admin member", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const member = await seedSecondPerson();
    await db.familyMember.create({
      data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
    });
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, isActive: true } });
    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/activate-free")
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Only a family admin can manage billing");
  });
});

describe("billing family scoping", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => mockGetAuth.mockReset());

  it("requires explicit familyGroupId when the user belongs to multiple families", async () => {
    const person = await seedTestPerson();
    await seedTestFamily(person.id);
    await seedTestFamily(person.id); // second family
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .get("/api/v1/billing/subscription")
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("familyGroupId is required");
  });

  it("acts on the named family when familyGroupId is provided", async () => {
    const person = await seedTestPerson();
    const { familyGroup: famA } = await seedTestFamily(person.id);
    const { familyGroup: famB } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Family", displayOrder: 1 } });
    await db.familySubscription.create({
      data: { familyGroupId: famB.id, tierKey: "BASE", seatCount: 4, status: "ACTIVE" }
    });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });

    const resB = await request(app)
      .get(`/api/v1/billing/subscription?familyGroupId=${famB.id}`)
      .set("Authorization", "Bearer mock");
    expect(resB.status).toBe(200);
    expect(resB.body.subscription.seatCount).toBe(4);

    const resA = await request(app)
      .get(`/api/v1/billing/subscription?familyGroupId=${famA.id}`)
      .set("Authorization", "Bearer mock");
    expect(resA.status).toBe(404); // famA has no subscription — no silent fallback
  });

  it("rejects a familyGroupId the user is not a member of", async () => {
    await seedTestPerson(); // requester — not a member of the family below
    const owner = await seedSecondPerson();
    const { familyGroup } = await seedTestFamily(owner.id);
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/billing/checkout")
      .set("Authorization", "Bearer mock")
      .send({
        familyGroupId: familyGroup.id,
        tierKey: "BASE",
        seats: 1,
        successUrl: "http://localhost:3000/s",
        cancelUrl: "http://localhost:3000/c"
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Not a member of this family");
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

  it("GET /subscription returns null for the retired pendingDowngrade fields even when the row has values", async () => {
    const person = await seedTestPerson({ userId: "clerk_sub_pd" });
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, stripePriceId: "price_base" } });
    await db.familySubscription.create({
      data: {
        familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 3, status: "ACTIVE",
        pendingDowngradeTierKey: "BASE", pendingDowngradeSeatCount: 1, downgradeGraceEndsAt: new Date("2026-06-07T00:00:00Z")
      }
    });
    mockGetAuth.mockReturnValue({ userId: "clerk_sub_pd" });

    const res = await request(app).get(`/api/v1/billing/subscription?familyGroupId=${familyGroup.id}`);

    expect(res.status).toBe(200);
    expect(res.body.subscription.pendingDowngradeTierKey).toBeNull();
    expect(res.body.subscription.pendingDowngradeSeatCount).toBeNull();
    expect(res.body.subscription.downgradeGraceEndsAt).toBeNull();
  });
});
