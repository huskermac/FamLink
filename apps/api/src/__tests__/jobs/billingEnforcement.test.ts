import { db } from "@famlink/db";
import { vi } from "vitest";
import { seedTestPerson, seedTestFamily } from "../helpers/db";

const mockStripe = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn(), update: vi.fn() }
}));
vi.mock("stripe", () => {
  function MockStripe() { return mockStripe; }
  MockStripe.prototype = mockStripe;
  return { default: MockStripe };
});

import { runTrialWarningPass, runSeatReconciliationPass } from "../../jobs/billingEnforcement";

describe("runTrialWarningPass", () => {
  it("stamps trialWarningSentAt and does not re-send for same subscription", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, trialWarningDays: 3 } });
    const trialEndsAt = new Date(Date.now() + 2 * 86400000); // 2 days from now (within 3-day warning window)
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "BASE", status: "TRIALING", trialEndsAt }
    });

    await runTrialWarningPass();

    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.trialWarningSentAt).not.toBeNull();

    // Second run — should not update the timestamp again
    const firstWarnedAt = sub?.trialWarningSentAt;
    await runTrialWarningPass();
    const sub2 = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub2?.trialWarningSentAt?.getTime()).toBe(firstWarnedAt?.getTime());
  });

  it("does not warn when trial ends more than trialWarningDays away", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, trialWarningDays: 3 } });
    const trialEndsAt = new Date(Date.now() + 10 * 86400000); // 10 days from now (outside 3-day window)
    await db.familySubscription.create({
      data: { familyGroupId: familyGroup.id, tierKey: "BASE", status: "TRIALING", trialEndsAt }
    });

    await runTrialWarningPass();
    const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
    expect(sub?.trialWarningSentAt).toBeNull();
  });
});

describe("runSeatReconciliationPass", () => {
  beforeEach(() => {
    mockStripe.subscriptions.retrieve.mockReset();
    mockStripe.subscriptions.update.mockReset();
  });

  it("reconciles entitling families and skips free-tier and non-entitling (PAST_DUE) ones", async () => {
    // Entitling paid family, stale seatCount, 2 active members (admin + 1), no
    // stripeSubscriptionId => DB-only reconcile (no Stripe call).
    const admin = await seedTestPerson({ userId: "u_recon_admin" });
    const { familyGroup: paid } = await seedTestFamily(admin.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, includedSeats: 5, stripePriceId: "price_base", stripeSeatPriceId: "price_seat" } });
    await db.familySubscription.create({ data: { familyGroupId: paid.id, tierKey: "BASE", seatCount: 9, status: "ACTIVE" } });
    const m = await seedTestPerson({ userId: "u_recon_m" });
    await db.familyMember.create({ data: { familyGroupId: paid.id, personId: m.id, roles: [], permissions: [] } });

    // Free family — skipped (stripePriceId null).
    const freeAdmin = await seedTestPerson({ userId: "u_recon_free" });
    const { familyGroup: free } = await seedTestFamily(freeAdmin.id);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, stripePriceId: null } });
    await db.familySubscription.create({ data: { familyGroupId: free.id, tierKey: "FREE", seatCount: 7, status: "ACTIVE" } });

    // Non-entitling PAST_DUE paid family — skipped (status not entitling).
    const pdAdmin = await seedTestPerson({ userId: "u_recon_pd" });
    const { familyGroup: pd } = await seedTestFamily(pdAdmin.id);
    await db.familySubscription.create({ data: { familyGroupId: pd.id, tierKey: "BASE", seatCount: 8, status: "PAST_DUE" } });

    await runSeatReconciliationPass();

    expect((await db.familySubscription.findUnique({ where: { familyGroupId: paid.id } }))?.seatCount).toBe(2); // reconciled to headcount
    expect((await db.familySubscription.findUnique({ where: { familyGroupId: free.id } }))?.seatCount).toBe(7); // untouched
    expect((await db.familySubscription.findUnique({ where: { familyGroupId: pd.id } }))?.seatCount).toBe(8); // untouched
  });

  it("continues reconciling other families when one family's Stripe call throws", async () => {
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, includedSeats: 1, stripePriceId: "price_base", stripeSeatPriceId: "price_seat" } });

    // Two entitling families, each with a live Stripe subscription and 2 active
    // members (so each reaches the Stripe retrieve leg — desiredQty 1).
    for (const tag of ["x", "y"]) {
      const admin = await seedTestPerson({ userId: `u_iso_${tag}` });
      const { familyGroup } = await seedTestFamily(admin.id);
      await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 9, status: "ACTIVE", stripeCustomerId: `cus_${tag}`, stripeSubscriptionId: `sub_${tag}` } });
      const m = await seedTestPerson({ userId: `u_iso_${tag}2` });
      await db.familyMember.create({ data: { familyGroupId: familyGroup.id, personId: m.id, roles: [], permissions: [] } });
    }

    // Fail the FIRST reconciliation's Stripe call regardless of which family is
    // iterated first; the second must still run. Asserting retrieve ran twice is
    // order-independent and fails if the loop lacks its per-family try/catch
    // (an un-caught first rejection would abort before the second retrieve).
    mockStripe.subscriptions.retrieve
      .mockRejectedValueOnce(new Error("stripe boom"))
      .mockResolvedValue({ items: { data: [] } });
    mockStripe.subscriptions.update.mockResolvedValue({});

    await runSeatReconciliationPass();

    expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
  });
});
