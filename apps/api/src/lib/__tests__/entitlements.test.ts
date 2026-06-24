import { db } from "@famlink/db";
import { describe, it, expect } from "vitest";
import {
  isPersonCovered,
  isPersonCoveredByFamily,
  getAiDailyLimit,
  getAiDailyLimitForUser,
  AI_DAILY_LIMIT_COVERED,
  AI_DAILY_LIMIT_FREE
} from "../entitlements";
import { seedTestPerson, seedTestFamily } from "../../__tests__/helpers/db";

async function paidTier(tierKey: string) {
  await db.pricingTier.create({
    data: { tierKey, displayName: tierKey, displayOrder: 1, stripePriceId: `price_${tierKey}` }
  });
}

async function subscribe(familyGroupId: string, tierKey: string, seatCount: number, status = "ACTIVE") {
  await db.familySubscription.create({ data: { familyGroupId, tierKey, seatCount, status } });
}

describe("isPersonCovered", () => {
  it("is false for a person with no memberships", async () => {
    const person = await seedTestPerson();
    expect(await isPersonCovered(person.id)).toBe(false);
  });

  it("is false for a member of a free-tier family", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, stripePriceId: null } });
    await subscribe(familyGroup.id, "FREE", 1);
    expect(await isPersonCovered(person.id)).toBe(false);
  });

  it("is true for a member of a paid ACTIVE family within seatCount", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO");
    await subscribe(familyGroup.id, "PRO", 5);
    expect(await isPersonCovered(person.id)).toBe(true);
  });

  it("is true for a paid TRIALING family", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO");
    await subscribe(familyGroup.id, "PRO", 5, "TRIALING");
    expect(await isPersonCovered(person.id)).toBe(true);
  });

  it("is false when the paid subscription is PAST_DUE", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO");
    await subscribe(familyGroup.id, "PRO", 5, "PAST_DUE");
    expect(await isPersonCovered(person.id)).toBe(false);
  });

  it("excludes members beyond seatCount (earliest-joined occupy the seats)", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id); // admin joins first
    await paidTier("SOLO");
    await subscribe(familyGroup.id, "SOLO", 1);
    const late = await db.person.create({
      data: { firstName: "Late", lastName: "Joiner", ageGateLevel: "ADULT", userId: null }
    });
    await db.familyMember.create({
      data: { familyGroupId: familyGroup.id, personId: late.id, roles: [], permissions: [] }
    });
    expect(await isPersonCovered(admin.id)).toBe(true);
    expect(await isPersonCovered(late.id)).toBe(false);
  });

  it("is false for an ACTIVE subscription on a null-stripePriceId tier regardless of tier name", async () => {
    // Proves coverage keys on stripePriceId, not the tier name.
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "LEGACY", displayName: "Legacy", displayOrder: 3, stripePriceId: null } });
    await subscribe(familyGroup.id, "LEGACY", 5);
    expect(await isPersonCovered(person.id)).toBe(false);
  });

  it("skips a suspended early-joined member so the next active member is covered", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id); // admin joins first
    await paidTier("SOLO");
    await subscribe(familyGroup.id, "SOLO", 1);
    const next = await db.person.create({
      data: { firstName: "Next", lastName: "Member", ageGateLevel: "ADULT", userId: null }
    });
    await db.familyMember.create({
      data: { familyGroupId: familyGroup.id, personId: next.id, roles: [], permissions: [] }
    });
    // Suspend the admin — the single seat should fall to the next active member.
    await db.familyMember.update({
      where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: admin.id } },
      data: { suspendedAt: new Date() }
    });
    expect(await isPersonCovered(admin.id)).toBe(false);
    expect(await isPersonCovered(next.id)).toBe(true);
  });

  it("OR-coverage: covered via a paid family even when also in a free family", async () => {
    const person = await seedTestPerson();
    const free = await seedTestFamily(person.id);
    const paid = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, stripePriceId: null } });
    await subscribe(free.familyGroup.id, "FREE", 1);
    await paidTier("PRO");
    await subscribe(paid.familyGroup.id, "PRO", 5);
    expect(await isPersonCovered(person.id)).toBe(true);
  });
});

describe("isPersonCoveredByFamily", () => {
  it("is true for a paid family where the person is within seats", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5);
    expect(await isPersonCoveredByFamily(person.id, familyGroup.id)).toBe(true);
  });

  it("is false for a free-tier family", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, stripePriceId: null } });
    await subscribe(familyGroup.id, "FREE", 1);
    expect(await isPersonCoveredByFamily(person.id, familyGroup.id)).toBe(false);
  });

  it("is false for a PAST_DUE paid family", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5, "PAST_DUE");
    expect(await isPersonCoveredByFamily(person.id, familyGroup.id)).toBe(false);
  });

  it("is false for a member beyond seatCount (earliest-joined seated)", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    await paidTier("SOLO", 1);
    await subscribe(familyGroup.id, "SOLO", 1);
    const late = await db.person.create({ data: { firstName: "Late", lastName: "J", ageGateLevel: "ADULT", userId: null } });
    await db.familyMember.create({ data: { familyGroupId: familyGroup.id, personId: late.id, roles: [], permissions: [] } });
    expect(await isPersonCoveredByFamily(late.id, familyGroup.id)).toBe(false);
    expect(await isPersonCoveredByFamily(admin.id, familyGroup.id)).toBe(true);
  });

  it("is false for a suspended member of a paid family", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5);
    await db.familyMember.updateMany({
      where: { familyGroupId: familyGroup.id, personId: person.id },
      data: { suspendedAt: new Date() }
    });
    expect(await isPersonCoveredByFamily(person.id, familyGroup.id)).toBe(false);
  });

  it("is false for a family the person does not belong to", async () => {
    const person = await seedTestPerson();
    const other = await seedTestPerson({ userId: null });
    const { familyGroup } = await seedTestFamily(other.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5);
    expect(await isPersonCoveredByFamily(person.id, familyGroup.id)).toBe(false);
  });
});

describe("getAiDailyLimit / getAiDailyLimitForUser", () => {
  it("returns the covered limit for a covered person", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO");
    await subscribe(familyGroup.id, "PRO", 5);
    expect(await getAiDailyLimit(person.id)).toBe(AI_DAILY_LIMIT_COVERED);
  });

  it("returns the free limit for an uncovered person", async () => {
    const person = await seedTestPerson();
    expect(await getAiDailyLimit(person.id)).toBe(AI_DAILY_LIMIT_FREE);
  });

  it("resolves by Clerk userId and falls back to free for unknown users", async () => {
    const person = await seedTestPerson({ userId: "clerk_cov" });
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO");
    await subscribe(familyGroup.id, "PRO", 5);
    expect(await getAiDailyLimitForUser("clerk_cov")).toBe(AI_DAILY_LIMIT_COVERED);
    expect(await getAiDailyLimitForUser("clerk_nobody")).toBe(AI_DAILY_LIMIT_FREE);
  });
});
