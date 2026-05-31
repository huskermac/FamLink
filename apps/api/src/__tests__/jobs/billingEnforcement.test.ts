import { db } from "@famlink/db";
import { runTrialWarningPass, runDowngradeEnforcementPass } from "../../jobs/billingEnforcement";
import { seedTestPerson, seedTestFamily } from "../helpers/db";

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

describe("runDowngradeEnforcementPass", () => {
  it("suspends newest-joined over-limit active members when grace period expires", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);

    // Create a second active family member (with userId)
    const secondPerson = await db.person.create({
      data: { firstName: "Second", lastName: "Member", ageGateLevel: "ADULT", userId: "user_second_enforce_test" }
    });
    await db.familyMember.create({
      data: {
        familyGroupId: familyGroup.id,
        personId: secondPerson.id,
        roles: ["MEMBER"],
        permissions: []
      }
    });

    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, activeUserLimit: 1 } });
    await db.familySubscription.create({
      data: {
        familyGroupId: familyGroup.id,
        tierKey: "BASE",
        seatCount: 1,
        pendingDowngradeTierKey: "BASE",
        pendingDowngradeSeatCount: 1,
        downgradeGraceEndsAt: new Date(Date.now() - 1000) // already expired
      }
    });

    await runDowngradeEnforcementPass();

    const secondMember = await db.familyMember.findFirst({
      where: { familyGroupId: familyGroup.id, personId: secondPerson.id }
    });
    expect(secondMember?.suspendedAt).not.toBeNull();

    // Admin (first member, oldest joinedAt) should NOT be suspended
    const adminMember = await db.familyMember.findFirst({
      where: { familyGroupId: familyGroup.id, personId: admin.id }
    });
    expect(adminMember?.suspendedAt).toBeNull();
  });
});
