import { db } from "@famlink/db";
import { describe, it, expect } from "vitest";
import {
  isPersonCovered,
  getAiDailyLimit,
  getAiDailyLimitForUser,
  AI_DAILY_LIMIT_COVERED,
  AI_DAILY_LIMIT_FREE
} from "../entitlements";
import { seedTestPerson, seedTestFamily } from "../../__tests__/helpers/db";

async function paidTier(tierKey: string, seatCount: number, status = "ACTIVE") {
  await db.pricingTier.create({
    data: { tierKey, displayName: tierKey, displayOrder: 1, stripePriceId: `price_${tierKey}` }
  });
  return { tierKey, seatCount, status };
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
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5);
    expect(await isPersonCovered(person.id)).toBe(true);
  });

  it("is true for a paid TRIALING family", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5, "TRIALING");
    expect(await isPersonCovered(person.id)).toBe(true);
  });

  it("is false when the paid subscription is PAST_DUE", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5, "PAST_DUE");
    expect(await isPersonCovered(person.id)).toBe(false);
  });

  it("excludes members beyond seatCount (earliest-joined occupy the seats)", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id); // admin joins first
    await paidTier("SOLO", 1);
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

  it("OR-coverage: covered via a paid family even when also in a free family", async () => {
    const person = await seedTestPerson();
    const free = await seedTestFamily(person.id);
    const paid = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "FREE", displayName: "Free", displayOrder: 0, stripePriceId: null } });
    await subscribe(free.familyGroup.id, "FREE", 1);
    await paidTier("PRO", 5);
    await subscribe(paid.familyGroup.id, "PRO", 5);
    expect(await isPersonCovered(person.id)).toBe(true);
  });
});

describe("getAiDailyLimit / getAiDailyLimitForUser", () => {
  it("returns the covered limit for a covered person", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await paidTier("PRO", 5);
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
    await paidTier("PRO", 5);
    await subscribe(familyGroup.id, "PRO", 5);
    expect(await getAiDailyLimitForUser("clerk_cov")).toBe(AI_DAILY_LIMIT_COVERED);
    expect(await getAiDailyLimitForUser("clerk_nobody")).toBe(AI_DAILY_LIMIT_FREE);
  });
});
