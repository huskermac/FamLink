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
