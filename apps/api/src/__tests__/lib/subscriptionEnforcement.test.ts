import { db } from "@famlink/db";
import { checkSeatExpansion } from "../../lib/subscriptionEnforcement";
import { seedTestPerson, seedTestFamily } from "../helpers/db";

describe("checkSeatExpansion", () => {
  it("returns allowed=true, requiresConfirmation=false when no subscription record", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    const result = await checkSeatExpansion(familyGroup.id, 1);
    expect(result).toEqual({ allowed: true, requiresConfirmation: false });
  });

  it("returns allowed=true, requiresConfirmation=false for unlimited tier", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "UNLIMITED", displayName: "Unlimited", displayOrder: 2, activeUserLimit: null } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "UNLIMITED", seatCount: 10 } });
    const result = await checkSeatExpansion(familyGroup.id, 10);
    expect(result).toEqual({ allowed: true, requiresConfirmation: false });
  });

  it("returns allowed=true, requiresConfirmation=false when under declared seat count", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, activeUserLimit: 5 } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 5 } });
    const result = await checkSeatExpansion(familyGroup.id, 3);
    expect(result).toEqual({ allowed: true, requiresConfirmation: false });
  });

  it("returns requiresConfirmation=true when at or over declared seat count", async () => {
    const person = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(person.id);
    await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, activeUserLimit: 5 } });
    await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 2 } });
    const result = await checkSeatExpansion(familyGroup.id, 2);
    expect(result).toEqual({ allowed: true, requiresConfirmation: true });
  });
});
