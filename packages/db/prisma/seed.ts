import { PrismaClient } from "../src/generated/client";

const prisma = new PrismaClient();

// ── Stable IDs ─────────────────────────────────────────────
const IDS = {
  // People
  sarah: "person_sarah",
  tom: "person_tom",
  emma: "person_emma",
  jack: "person_jack",
  margaret: "person_margaret",
  robert: "person_robert",
  dave: "person_dave",
  // Family & households
  family: "family_johnson",
  houseSarah: "household_sarah",
  houseGrandma: "household_grandma",
  houseDave: "household_dave",
  // Event
  thanksgiving: "event_thanksgiving"
} as const;

export const DEV_SEED_IDS = IDS;

async function main(): Promise<void> {
    // ── People ─────────────────────────────────────────────────
    const people: Array<{
      id: string;
      firstName: string;
      lastName: string;
      dob: string;
      userId: string | null;
      ageGateLevel: string;

    }> = [
      { id: IDS.sarah, firstName: "Sarah", lastName: "Johnson", dob: "1980-03-15", userId: "clerk_sarah_dev", ageGateLevel: "NONE" },
      { id: IDS.tom, firstName: "Tom", lastName: "Johnson", dob: "1978-11-02", userId: "clerk_tom_dev", ageGateLevel: "NONE" },
      { id: IDS.emma, firstName: "Emma", lastName: "Johnson", dob: "2015-07-22", userId: null, ageGateLevel: "MINOR" },
      { id: IDS.jack, firstName: "Jack", lastName: "Johnson", dob: "2013-04-10", userId: null, ageGateLevel: "MINOR" },
      { id: IDS.margaret, firstName: "Margaret", lastName: "Johnson", dob: "1950-06-08", userId: "clerk_margaret_dev", ageGateLevel: "NONE" },
      { id: IDS.robert, firstName: "Robert", lastName: "Johnson", dob: "1948-09-14", userId: "clerk_robert_dev", ageGateLevel: "NONE" },
      { id: IDS.dave, firstName: "Dave", lastName: "Johnson", dob: "1975-12-30", userId: null, ageGateLevel: "NONE" }
    ];
  
  for (const p of people) {
    await prisma.person.upsert({
      where: { id: p.id },
      update: {ageGateLevel: p.ageGateLevel},
      create: {
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        dateOfBirth: new Date(p.dob),
        userId: p.userId,
              }
    });
  }

  // ── Family group ───────────────────────────────────────────
  await prisma.familyGroup.upsert({
    where: { id: IDS.family },
    update: {},
    create: {
      id: IDS.family,
      name: "The Johnson Family",
      createdById: IDS.sarah,
      aiEnabled: true,
      defaultVisibility: "FAMILY"
    }
  });

  // ── Households ─────────────────────────────────────────────
  const households: Array<{ id: string; name: string }> = [
    { id: IDS.houseSarah, name: "Sarah & Tom's House" },
    { id: IDS.houseGrandma, name: "Grandma & Grandpa's House" },
    { id: IDS.houseDave, name: "Uncle Dave's Place" }
  ];

  for (const h of households) {
    await prisma.household.upsert({
      where: { id: h.id },
      update: {},
      create: { id: h.id, name: h.name, familyGroupId: IDS.family }
    });
  }

  // ── Family members ─────────────────────────────────────────
  const familyMembers: Array<{ personId: string; roles: string[] }> = [
    { personId: IDS.sarah, roles: ["ORGANIZER", "ADMIN"] },
    { personId: IDS.tom, roles: ["MEMBER"] },
    { personId: IDS.emma, roles: ["MEMBER"] },
    { personId: IDS.jack, roles: ["MEMBER"] },
    { personId: IDS.margaret, roles: ["MEMBER"] },
    { personId: IDS.robert, roles: ["MEMBER"] },
    { personId: IDS.dave, roles: ["MEMBER"] }
  ];

  for (const fm of familyMembers) {
    await prisma.familyMember.upsert({
      where: { familyGroupId_personId: { familyGroupId: IDS.family, personId: fm.personId } },
      update: {},
      create: { familyGroupId: IDS.family, personId: fm.personId, roles: fm.roles, permissions: [] }
    });
  }

  // ── Household members ──────────────────────────────────────
  const householdMembers: Array<{ householdId: string; personId: string }> = [
    { householdId: IDS.houseSarah, personId: IDS.sarah },
    { householdId: IDS.houseSarah, personId: IDS.tom },
    { householdId: IDS.houseSarah, personId: IDS.emma },
    { householdId: IDS.houseSarah, personId: IDS.jack },
    { householdId: IDS.houseGrandma, personId: IDS.margaret },
    { householdId: IDS.houseGrandma, personId: IDS.robert },
    { householdId: IDS.houseDave, personId: IDS.dave }
  ];

  for (const hm of householdMembers) {
    await prisma.householdMember.upsert({
      where: { householdId_personId: { householdId: hm.householdId, personId: hm.personId } },
      update: {},
      create: { householdId: hm.householdId, personId: hm.personId }
    });
  }

  // ── Relationships ──────────────────────────────────────────
  const relationships: Array<{ from: string; to: string; type: string }> = [
    { from: IDS.sarah, to: IDS.tom, type: "SPOUSE" },
    { from: IDS.tom, to: IDS.sarah, type: "SPOUSE" },
    { from: IDS.sarah, to: IDS.emma, type: "PARENT" },
    { from: IDS.emma, to: IDS.sarah, type: "CHILD" },
    { from: IDS.sarah, to: IDS.jack, type: "PARENT" },
    { from: IDS.jack, to: IDS.sarah, type: "CHILD" },
    { from: IDS.tom, to: IDS.emma, type: "PARENT" },
    { from: IDS.emma, to: IDS.tom, type: "CHILD" },
    { from: IDS.tom, to: IDS.jack, type: "PARENT" },
    { from: IDS.jack, to: IDS.tom, type: "CHILD" },
    { from: IDS.emma, to: IDS.jack, type: "SIBLING" },
    { from: IDS.jack, to: IDS.emma, type: "SIBLING" },
    { from: IDS.margaret, to: IDS.tom, type: "PARENT" },
    { from: IDS.tom, to: IDS.margaret, type: "CHILD" },
    { from: IDS.robert, to: IDS.tom, type: "PARENT" },
    { from: IDS.tom, to: IDS.robert, type: "CHILD" },
    { from: IDS.margaret, to: IDS.robert, type: "SPOUSE" },
    { from: IDS.robert, to: IDS.margaret, type: "SPOUSE" },
    { from: IDS.tom, to: IDS.dave, type: "SIBLING" },
    { from: IDS.dave, to: IDS.tom, type: "SIBLING" },
    { from: IDS.margaret, to: IDS.dave, type: "PARENT" },
    { from: IDS.dave, to: IDS.margaret, type: "CHILD" },
    { from: IDS.robert, to: IDS.dave, type: "PARENT" },
    { from: IDS.dave, to: IDS.robert, type: "CHILD" },
    { from: IDS.margaret, to: IDS.emma, type: "GRANDPARENT" },
    { from: IDS.emma, to: IDS.margaret, type: "GRANDCHILD" },
    { from: IDS.margaret, to: IDS.jack, type: "GRANDPARENT" },
    { from: IDS.jack, to: IDS.margaret, type: "GRANDCHILD" },
    { from: IDS.robert, to: IDS.emma, type: "GRANDPARENT" },
    { from: IDS.emma, to: IDS.robert, type: "GRANDCHILD" },
    { from: IDS.robert, to: IDS.jack, type: "GRANDPARENT" },
    { from: IDS.jack, to: IDS.robert, type: "GRANDCHILD" }
  ];

  for (const r of relationships) {
    await prisma.relationship.upsert({
      where: {
        fromPersonId_toPersonId_familyGroupId: {
          fromPersonId: r.from,
          toPersonId: r.to,
          familyGroupId: IDS.family
        }
      },
      update: {},
      create: { fromPersonId: r.from, toPersonId: r.to, type: r.type, familyGroupId: IDS.family }
    });
  }

  // ── Thanksgiving event ─────────────────────────────────────
  await prisma.event.upsert({
    where: { id: IDS.thanksgiving },
    update: {},
    create: {
      id: IDS.thanksgiving,
      familyGroupId: IDS.family,
      createdByPersonId: IDS.sarah,
      title: "Thanksgiving 2026",
      startAt: new Date("2026-11-26T17:00:00Z"),
      locationName: "Grandma & Grandpa's House",
      visibility: "FAMILY"
    }
  });

  // ── RSVPs ──────────────────────────────────────────────────
  const rsvps: Array<{
    personId: string;
    status: string;
    guestToken: string | null;
    respondedAt: Date | null;
  }> = [
    { personId: IDS.sarah, status: "YES", guestToken: null, respondedAt: new Date() },
    { personId: IDS.tom, status: "YES", guestToken: null, respondedAt: new Date() },
    { personId: IDS.margaret, status: "YES", guestToken: null, respondedAt: new Date() },
    { personId: IDS.robert, status: "YES", guestToken: null, respondedAt: new Date() },
    { personId: IDS.dave, status: "PENDING", guestToken: "dev-guest-token-dave", respondedAt: null }
  ];

  for (const r of rsvps) {
    await prisma.rSVP.upsert({
      where: { eventId_personId: { eventId: IDS.thanksgiving, personId: r.personId } },
      update: {},
      create: {
        eventId: IDS.thanksgiving,
        personId: r.personId,
        status: r.status,
        guestToken: r.guestToken,
        guestPhone: r.personId === IDS.dave ? "+15551234567" : null,
        respondedAt: r.respondedAt
      }
    });
  }

  // ── Potluck assignments ────────────────────────────────────
  const potluck: Array<{ personId: string; item: string; quantity: number }> = [
    { personId: IDS.sarah, item: "Pumpkin Pie", quantity: 2 },
    { personId: IDS.tom, item: "Turkey", quantity: 1 },
    { personId: IDS.margaret, item: "Mashed Potatoes", quantity: 1 },
    { personId: IDS.dave, item: "Rolls", quantity: 2 }
  ];

  for (const p of potluck) {
    const existing = await prisma.potluckAssignment.findFirst({
      where: { eventId: IDS.thanksgiving, personId: p.personId }
    });
    if (!existing) {
      await prisma.potluckAssignment.create({
        data: { eventId: IDS.thanksgiving, personId: p.personId, item: p.item, quantity: p.quantity }
      });
    }
  }

  // ── Notification preferences ───────────────────────────────
  const allChannels = ["EMAIL", "PUSH", "SMS"] as const;
  const allTypes = [
    "EVENT_INVITE",
    "RSVP_RECEIVED",
    "EVENT_REMINDER",
    "BIRTHDAY_REMINDER",
    "FAMILY_JOIN",
    "WEEKLY_DIGEST"
  ] as const;

  for (const channel of allChannels) {
    for (const notifType of allTypes) {
      await prisma.notificationPreference.upsert({
        where: { personId_channel_notifType: { personId: IDS.sarah, channel, notifType } },
        update: {},
        create: { personId: IDS.sarah, channel, notifType, enabled: true }
      });
    }
  }

  const margaretChannels = ["EMAIL", "PUSH"] as const;
  for (const channel of margaretChannels) {
    for (const notifType of allTypes) {
      await prisma.notificationPreference.upsert({
        where: { personId_channel_notifType: { personId: IDS.margaret, channel, notifType } },
        update: {},
        create: { personId: IDS.margaret, channel, notifType, enabled: true }
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log("✅ Seed complete — Johnson family loaded");
}

main()
  .catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

