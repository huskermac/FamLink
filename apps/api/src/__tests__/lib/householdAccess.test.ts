import { db } from "@famlink/db";
import { householdViewer, householdAdmin, linkedFamilies } from "../../lib/householdAccess";

async function fixture() {
  const adminA = await db.person.create({ data: { firstName: "Ada", lastName: "A" } });
  const memberA = await db.person.create({ data: { firstName: "Mia", lastName: "A" } });
  const adminB = await db.person.create({ data: { firstName: "Bob", lastName: "B" } });
  const outsider = await db.person.create({ data: { firstName: "Out", lastName: "Sider" } });
  const famA = await db.familyGroup.create({ data: { name: "Alpha", createdById: adminA.id } });
  const famB = await db.familyGroup.create({ data: { name: "Beta", createdById: adminB.id } });
  await db.familyMember.create({ data: { familyGroupId: famA.id, personId: adminA.id, roles: ["ADMIN"] } });
  await db.familyMember.create({ data: { familyGroupId: famA.id, personId: memberA.id, roles: [] } });
  await db.familyMember.create({ data: { familyGroupId: famB.id, personId: adminB.id, roles: ["ADMIN"] } });
  const household = await db.household.create({
    data: { name: "Shared Home", families: { create: { familyGroupId: famA.id } } }
  });
  await db.householdFamily.create({ data: { householdId: household.id, familyGroupId: famB.id } });
  return { adminA, memberA, adminB, outsider, famA, famB, household };
}

describe("householdAccess", () => {
  it("viewer: member of ANY linked family; not outsiders", async () => {
    const f = await fixture();
    expect(await householdViewer(f.household.id, f.memberA.id)).toBe(true);
    expect(await householdViewer(f.household.id, f.adminB.id)).toBe(true);
    expect(await householdViewer(f.household.id, f.outsider.id)).toBe(false);
  });

  it("admin: admin of ANY linked family; plain members are not admins", async () => {
    const f = await fixture();
    expect(await householdAdmin(f.household.id, f.adminA.id)).toBe(true);
    expect(await householdAdmin(f.household.id, f.adminB.id)).toBe(true);
    expect(await householdAdmin(f.household.id, f.memberA.id)).toBe(false);
    expect(await householdAdmin(f.household.id, f.outsider.id)).toBe(false);
  });

  it("suspended membership grants nothing", async () => {
    const f = await fixture();
    await db.familyMember.update({
      where: { familyGroupId_personId: { familyGroupId: f.famB.id, personId: f.adminB.id } },
      data: { suspendedAt: new Date() }
    });
    expect(await householdViewer(f.household.id, f.adminB.id)).toBe(false);
    expect(await householdAdmin(f.household.id, f.adminB.id)).toBe(false);
  });

  it("linkedFamilies: every linked family's NAME; ids only for the viewer's own families", async () => {
    const f = await fixture();
    const forMemberA = await linkedFamilies(f.household.id, f.memberA.id);
    expect(forMemberA.map((x) => x.name).sort()).toEqual(["Alpha", "Beta"]);
    const alpha = forMemberA.find((x) => x.name === "Alpha");
    const beta = forMemberA.find((x) => x.name === "Beta");
    expect(alpha?.id).toBe(f.famA.id);          // memberA belongs to Alpha → id present
    expect(beta?.id).toBeUndefined();           // memberA is NOT in Beta → no foreign family id (invariant 1)
    expect(Object.keys(beta ?? {})).toEqual(["name"]);
  });
});
