import { db } from "@famlink/db";

describe("HouseholdFamily schema", () => {
  it("creating a household with a link and reading it back through both relations", async () => {
    const creator = await db.person.create({ data: { firstName: "Ann", lastName: "Admin" } });
    const family = await db.familyGroup.create({ data: { name: "Fam", createdById: creator.id } });
    const household = await db.household.create({
      data: {
        name: "Home",
        families: { create: { familyGroupId: family.id, linkedByPersonId: creator.id } }
      }
    });

    const viaHousehold = await db.household.findUnique({
      where: { id: household.id },
      include: { families: { include: { familyGroup: { select: { id: true, name: true } } } } }
    });
    expect(viaHousehold?.families).toHaveLength(1);
    expect(viaHousehold?.families[0]?.familyGroup.name).toBe("Fam");

    const viaFamily = await db.familyGroup.findUnique({
      where: { id: family.id },
      include: { householdLinks: true }
    });
    expect(viaFamily?.householdLinks.map((l) => l.householdId)).toEqual([household.id]);
  });

  it("duplicate link is rejected by the unique constraint", async () => {
    const creator = await db.person.create({ data: { firstName: "Ann", lastName: "Admin" } });
    const family = await db.familyGroup.create({ data: { name: "Fam", createdById: creator.id } });
    const household = await db.household.create({
      data: { name: "Home", families: { create: { familyGroupId: family.id } } }
    });
    await expect(
      db.householdFamily.create({ data: { householdId: household.id, familyGroupId: family.id } })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("audit entries append and read back newest-first", async () => {
    const creator = await db.person.create({ data: { firstName: "Ann", lastName: "Admin" } });
    const family = await db.familyGroup.create({ data: { name: "Fam", createdById: creator.id } });
    const household = await db.household.create({
      data: { name: "Home", families: { create: { familyGroupId: family.id } } }
    });
    await db.householdAuditEntry.create({
      data: {
        householdId: household.id, actorPersonId: creator.id, actorFamilyGroupId: family.id,
        action: "LINKED", createdAt: new Date(Date.now() - 60_000)
      }
    });
    await db.householdAuditEntry.create({
      data: {
        householdId: household.id, actorPersonId: creator.id, actorFamilyGroupId: family.id,
        action: "UPDATED", changes: { name: { from: "Home", to: "New Home" } }
      }
    });
    const rows = await db.householdAuditEntry.findMany({
      where: { householdId: household.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }] // stable secondary key — same ordering the audit route uses
    });
    expect(rows.map((r) => r.action)).toEqual(["UPDATED", "LINKED"]);
  });
});
