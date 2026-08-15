import { db } from "@famlink/db";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { seedTestFamily, seedTestPerson } from "../helpers/db";

const mockStripe = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn(), update: vi.fn() }
}));
vi.mock("stripe", () => {
  function MockStripe() { return mockStripe; }
  MockStripe.prototype = mockStripe;
  return { default: MockStripe };
});

import { reconcileSeats, billingImpactForAdd } from "../../lib/subscriptionEnforcement";

async function paidSub(seatCount: number, opts?: { includedSeats?: number; status?: string; stripeSub?: string | null }) {
  const person = await seedTestPerson({ userId: `u_${Math.random()}` });
  const { familyGroup } = await seedTestFamily(person.id);
  await db.pricingTier.create({
    data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, includedSeats: opts?.includedSeats ?? 1, stripePriceId: "price_base", stripeSeatPriceId: "price_seat" }
  });
  await db.familySubscription.create({
    data: {
      familyGroupId: familyGroup.id, tierKey: "BASE", seatCount,
      status: opts?.status ?? "ACTIVE",
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: opts?.stripeSub === undefined ? "sub_test" : opts.stripeSub
    }
  });
  return { familyGroupId: familyGroup.id, adminPersonId: person.id };
}

async function addActiveMember(familyGroupId: string, i: number) {
  const p = await seedTestPerson({ userId: `m_${familyGroupId}_${i}` });
  await db.familyMember.create({ data: { familyGroupId, personId: p.id, roles: [], permissions: [] } });
  return p;
}

describe("reconcileSeats", () => {
  beforeEach(() => {
    mockStripe.subscriptions.retrieve.mockReset();
    mockStripe.subscriptions.update.mockReset();
  });

  it("no-ops for a family with no subscription", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await reconcileSeats(familyGroup.id);
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("no-ops for a free-tier subscription", async () => {
    const person = await seedTestPerson({ userId: "u_free" });
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, stripePriceId: null } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "FREE", seatCount: 1, status: "ACTIVE" } });
    await reconcileSeats(familyGroup.id);
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("no-ops for a PAST_DUE subscription", async () => {
    const { familyGroupId } = await paidSub(1, { status: "PAST_DUE" });
    await reconcileSeats(familyGroupId);
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("sets seatCount to the active headcount and bills seats above includedSeats", async () => {
    // admin + 2 added = 3 active; includedSeats 1 => desiredQty 2
    const { familyGroupId } = await paidSub(1, { includedSeats: 1 });
    await addActiveMember(familyGroupId, 1);
    await addActiveMember(familyGroupId, 2);
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [] } });
    mockStripe.subscriptions.update.mockResolvedValue({});

    await reconcileSeats(familyGroupId);

    const sub = await db.familySubscription.findUnique({ where: { familyGroupId } });
    expect(sub?.seatCount).toBe(3);
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_test", {
      items: [{ price: "price_seat", quantity: 2 }],
      proration_behavior: "create_prorations"
    });
  });

  it("updates the existing seat item by id when one is present", async () => {
    const { familyGroupId } = await paidSub(5, { includedSeats: 1 }); // stale seatCount 5
    await addActiveMember(familyGroupId, 1); // admin + 1 = 2 active => desiredQty 1
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [{ id: "si_1", price: { id: "price_seat" }, quantity: 4 }] } });
    mockStripe.subscriptions.update.mockResolvedValue({});

    await reconcileSeats(familyGroupId);

    const sub = await db.familySubscription.findUnique({ where: { familyGroupId } });
    expect(sub?.seatCount).toBe(2);
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_test", {
      items: [{ id: "si_1", quantity: 1 }],
      proration_behavior: "create_prorations"
    });
  });

  it("deletes the seat item when headcount drops to within includedSeats", async () => {
    const { familyGroupId } = await paidSub(3, { includedSeats: 2 }); // admin only = 1 active => desiredQty 0
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [{ id: "si_1", price: { id: "price_seat" }, quantity: 1 }] } });
    mockStripe.subscriptions.update.mockResolvedValue({});

    await reconcileSeats(familyGroupId);

    const sub = await db.familySubscription.findUnique({ where: { familyGroupId } });
    expect(sub?.seatCount).toBe(1);
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_test", {
      items: [{ id: "si_1", deleted: true }],
      proration_behavior: "create_prorations"
    });
  });

  it("is idempotent — a second run makes no Stripe WRITE when quantity already matches", async () => {
    // NOTE: reconcile always calls subscriptions.retrieve; idempotency means no
    // subscriptions.update (write), not zero Stripe API calls.
    const { familyGroupId } = await paidSub(2, { includedSeats: 1 }); // admin + 1 = 2 active => desiredQty 1
    await addActiveMember(familyGroupId, 1);
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [{ id: "si_1", price: { id: "price_seat" }, quantity: 1 }] } });
    mockStripe.subscriptions.update.mockResolvedValue({});
    await reconcileSeats(familyGroupId);
    mockStripe.subscriptions.update.mockClear();
    await reconcileSeats(familyGroupId); // seatCount already 2, Stripe qty already 1
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("removes a stray quantity-0 seat item when desiredQty is 0", async () => {
    // admin only = 1 active; includedSeats 2 => desiredQty 0. A quantity-0 seat
    // item is still present and must be deleted (not skipped by the equality guard).
    const { familyGroupId } = await paidSub(1, { includedSeats: 2 });
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [{ id: "si_1", price: { id: "price_seat" }, quantity: 0 }] } });
    mockStripe.subscriptions.update.mockResolvedValue({});
    await reconcileSeats(familyGroupId);
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_test", {
      items: [{ id: "si_1", deleted: true }],
      proration_behavior: "create_prorations"
    });
  });

  it("does not count passive (userId==null) or suspended members", async () => {
    const { familyGroupId } = await paidSub(1, { includedSeats: 1 });
    // passive member (no userId)
    const passive = await db.person.create({ data: { firstName: "P", lastName: "Q", ageGateLevel: "ADULT", userId: null } });
    await db.familyMember.create({ data: { familyGroupId, personId: passive.id, roles: [], permissions: [] } });
    // suspended active member
    const susp = await addActiveMember(familyGroupId, 9);
    await db.familyMember.update({ where: { familyGroupId_personId: { familyGroupId, personId: susp.id } }, data: { suspendedAt: new Date() } });
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [] } });
    await reconcileSeats(familyGroupId);
    const sub = await db.familySubscription.findUnique({ where: { familyGroupId } });
    expect(sub?.seatCount).toBe(1); // admin only
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled(); // desiredQty 0, no seat item
  });

  it("updates seatCount to headcount but makes NO Stripe call when the tier has no per-seat price", async () => {
    // Paid + live subscription, but stripeSeatPriceId is null: reconcile writes
    // seatCount (headcount) then early-returns before any Stripe call, even when
    // headcount is over the included allowance.
    const person = await seedTestPerson({ userId: "u_noseat_recon" });
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "NOSEAT", displayName: "No Seat", displayOrder: 1, includedSeats: 1, stripePriceId: "price_ns" } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "NOSEAT", seatCount: 9, status: "ACTIVE", stripeCustomerId: "cus", stripeSubscriptionId: "sub_ns" } });
    await addActiveMember(familyGroup.id, 1); // admin + 1 = 2 active, over includedSeats 1

    await reconcileSeats(familyGroup.id);

    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.seatCount).toBe(2);
    expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe("billingImpactForAdd", () => {
  it("willBill=true with a note once the next active member exceeds includedSeats", async () => {
    // includedSeats 2, admin + 1 = 2 active; adding one more => 3 > 2 => bills.
    const { familyGroupId } = await paidSub(2, { includedSeats: 2 });
    await addActiveMember(familyGroupId, 1);
    const impact = await billingImpactForAdd(familyGroupId);
    expect(impact.willBill).toBe(true);
    expect(impact.note).toBe("This will be reflected on your next invoice.");
  });

  it("willBill=false with no note while the next member stays within includedSeats", async () => {
    // includedSeats 5, admin only = 1 active; adding one more => 2 <= 5 => no bill.
    const { familyGroupId } = await paidSub(1, { includedSeats: 5 });
    const impact = await billingImpactForAdd(familyGroupId);
    expect(impact.willBill).toBe(false);
    expect(impact.note).toBeNull();
  });

  it("willBill=false for a free tier", async () => {
    const person = await seedTestPerson({ userId: "u_bi_free" });
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, stripePriceId: null } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "FREE", seatCount: 1, status: "ACTIVE" } });
    const impact = await billingImpactForAdd(familyGroup.id);
    expect(impact.willBill).toBe(false);
    expect(impact.note).toBeNull();
  });

  it("willBill=false for a paid tier with no per-seat price (reconcile can't bill overflow)", async () => {
    const person = await seedTestPerson({ userId: "u_bi_noseat" });
    const { familyGroup } = await seedTestFamily(person.id);
    // Paid tier, live sub, but stripeSeatPriceId is null => overflow can't be billed.
    await db.pricingTier.create({ data: { tierKey: "NOSEAT", displayName: "No Seat", displayOrder: 1, includedSeats: 1, stripePriceId: "price_ns" } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "NOSEAT", seatCount: 1, status: "ACTIVE", stripeCustomerId: "cus", stripeSubscriptionId: "sub_ns" } });
    const m = await seedTestPerson({ userId: "u_bi_noseat_m" });
    await db.familyMember.create({ data: { familyGroupId: familyGroup.id, personId: m.id, roles: [], permissions: [] } });
    // 2 active, includedSeats 1 => would exceed, but no seat price => no bill.
    const impact = await billingImpactForAdd(familyGroup.id);
    expect(impact.willBill).toBe(false);
    expect(impact.note).toBeNull();
  });
});
