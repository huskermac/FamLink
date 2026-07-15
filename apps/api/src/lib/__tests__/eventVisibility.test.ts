import { db } from "@famlink/db";
import { describe, it, expect } from "vitest";
import { seedTestPerson, seedTestFamily } from "../../__tests__/helpers/db";
import { canViewEvent, visibleEventsWhere } from "../eventVisibility";

describe("canViewEvent", () => {
  it("an ACTIVE event participant can view a PRIVATE event", async () => {
    const owner = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(owner.id);
    const ev = await db.event.create({
      data: {
        familyGroupId: familyGroup.id,
        createdByPersonId: owner.id,
        title: "P",
        startAt: new Date(),
        eventVisibility: "PRIVATE"
      }
    });
    const p = await seedTestPerson({ userId: null });
    await db.eventParticipant.create({
      data: { eventId: ev.id, personId: p.id, status: "ACTIVE" }
    });
    expect(await canViewEvent(ev, p.id, false)).toBe(true);
  });
});

async function crossFamilyFixture() {
  const adminA = await db.person.create({ data: { firstName: "Ada", lastName: "A" } });
  const bMember = await db.person.create({ data: { firstName: "Ben", lastName: "B" } });
  const famA = await db.familyGroup.create({ data: { name: "Alpha", createdById: adminA.id } });
  const famB = await db.familyGroup.create({ data: { name: "Beta", createdById: bMember.id } });
  await db.familyMember.create({ data: { familyGroupId: famA.id, personId: adminA.id, roles: ["ADMIN"] } });
  await db.familyMember.create({ data: { familyGroupId: famB.id, personId: bMember.id, roles: [] } });
  // household linked to BOTH families; Ben lives in it but is NOT a member of family A
  const household = await db.household.create({ data: { familyGroupId: famA.id, name: "Shared" } });
  await db.householdFamily.create({ data: { householdId: household.id, familyGroupId: famA.id } });
  await db.householdFamily.create({ data: { householdId: household.id, familyGroupId: famB.id } });
  await db.householdMember.create({ data: { householdId: household.id, personId: bMember.id } });
  // PRIVATE event in family A with a HOUSEHOLD-scope invitation to the shared household
  const event = await db.event.create({
    data: {
      familyGroupId: famA.id, createdByPersonId: adminA.id, title: "A-only planning",
      startAt: new Date(Date.now() + 86_400_000), eventVisibility: "PRIVATE"
    }
  });
  await db.eventInvitation.create({
    data: { eventId: event.id, householdId: household.id, scope: "HOUSEHOLD" }
  });
  return { adminA, bMember, famA, famB, household, event };
}

describe("household-scope visibility under M2M (spec §7 invariant 3)", () => {
  it("a resident who is NOT a member of the event's family cannot see the PRIVATE event", async () => {
    const f = await crossFamilyFixture();
    const visible = await canViewEvent(
      { id: f.event.id, eventVisibility: "PRIVATE", createdByPersonId: f.adminA.id, familyGroupId: f.famA.id },
      f.bMember.id,
      false
    );
    expect(visible).toBe(false);
  });

  it("a resident who IS a member of the event's family still sees it via the household invite", async () => {
    const f = await crossFamilyFixture();
    await db.familyMember.create({ data: { familyGroupId: f.famA.id, personId: f.bMember.id, roles: [] } });
    const visible = await canViewEvent(
      { id: f.event.id, eventVisibility: "PRIVATE", createdByPersonId: f.adminA.id, familyGroupId: f.famA.id },
      f.bMember.id,
      false
    );
    expect(visible).toBe(true);
  });

  it("visibleEventsWhere scoped to family A excludes the event for the cross-family resident", async () => {
    const f = await crossFamilyFixture();
    const where = await visibleEventsWhere(f.bMember.id, false, f.famA.id);
    const hits = await db.event.findMany({ where: { familyGroupId: f.famA.id, ...where } });
    expect(hits.map((e) => e.id)).not.toContain(f.event.id);
  });

  it("spec §7 invariant 2: a shared household with NO invitation grants no visibility at all", async () => {
    const f = await crossFamilyFixture();
    await db.eventInvitation.deleteMany({ where: { eventId: f.event.id } });
    const visible = await canViewEvent(
      { id: f.event.id, eventVisibility: "PRIVATE", createdByPersonId: f.adminA.id, familyGroupId: f.famA.id },
      f.bMember.id,
      false
    );
    expect(visible).toBe(false);
  });
});
