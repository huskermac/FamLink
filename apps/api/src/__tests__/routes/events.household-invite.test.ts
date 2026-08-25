import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { TEST_CLERK_ID, TEST_USER_2_CLERK_ID } from "../helpers/auth";
import { seedTestFamily, seedTestEvent, seedTestPerson, seedSecondPerson } from "../helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

// P3-04 W1 PR-2 Task 10: HOUSEHOLD-scope event-invite escalation grafted onto
// the W3a invite handler. `POST /:eventId/invitations` accepts
// `{ kind: "household", householdId }` and expands residents per §resident
// classification (member / famlinkUser / guest / skipped).
describe("POST /api/v1/events/:eventId/invitations — household escalation (P3-04 Task 10)", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => {
    mockGetAuth.mockReset();
  });

  async function seedResident(overrides: Partial<{
    firstName: string;
    lastName: string;
    userId: string | null;
    ageGateLevel: string;
    email: string | null;
    emailNormalized: string | null;
    phone: string | null;
  }>) {
    return db.person.create({
      data: {
        firstName: overrides.firstName ?? "Resident",
        lastName: overrides.lastName ?? "Person",
        ageGateLevel: overrides.ageGateLevel ?? "ADULT",
        userId: overrides.userId ?? null,
        email: overrides.email ?? null,
        emailNormalized: overrides.emailNormalized ?? null,
        phone: overrides.phone ?? null
      }
    });
  }

  async function linkHouseholdToFamily(householdId: string, familyGroupId: string) {
    await db.householdFamily.create({ data: { householdId, familyGroupId } });
  }

  async function addResidentToHousehold(householdId: string, personId: string) {
    await db.householdMember.create({ data: { householdId, personId } });
  }

  it("event-family member resident → an EventInvitation (MEMBER channel)", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Reunion" });
    await db.event.update({ where: { id: event.id }, data: { eventVisibility: "OPEN" } });

    const resident = await seedResident({ firstName: "InFamily" });
    await db.familyMember.create({
      data: { familyGroupId: familyGroup.id, personId: resident.id, roles: ["MEMBER"], permissions: [] }
    });

    const household = await db.household.create({ data: { name: "The House", country: "US" } });
    await addResidentToHousehold(household.id, resident.id);
    await linkHouseholdToFamily(household.id, familyGroup.id);

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/invitations`)
      .set("Authorization", "Bearer mock")
      .send({ invitees: [{ kind: "household", householdId: household.id }] });

    expect(res.status).toBe(201);
    expect(res.body.invitations).toHaveLength(1);
    expect(res.body.invitations[0].channel).toBe("MEMBER");
    expect(res.body.skipped).toEqual([]);

    const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id, personId: resident.id } });
    expect(inv).not.toBeNull();
    expect(inv?.scope).toBe("HOUSEHOLD");
  });

  it("non-member active resident (has an account) → a famlinkUser EventInvitation with linkedPersonId + role, NOT an EventParticipant", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Cross-Family Reunion" });
    await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

    // Cross-family resident: has an account (userId) but is NOT a member of the event's family.
    const resident = await seedResident({ firstName: "CrossActive", userId: "user_cross_active_001" });

    const household = await db.household.create({ data: { name: "Blended House", country: "US" } });
    await addResidentToHousehold(household.id, resident.id);
    await linkHouseholdToFamily(household.id, familyGroup.id);

    // requester is the event creator/owning-admin → canAdmin is true, so the
    // cross-family gate (triggered by this household expansion) passes.
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/invitations`)
      .set("Authorization", "Bearer mock")
      .send({ invitees: [{ kind: "household", householdId: household.id }] });

    expect(res.status).toBe(201);
    expect(res.body.invitations).toHaveLength(1);
    expect(res.body.invitations[0].channel).toBe("FAMLINK_USER");

    const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id, linkedPersonId: resident.id } });
    expect(inv).not.toBeNull();
    expect(inv?.role).toBe("PARTICIPANT");
    expect(inv?.guestToken).toBeTruthy();

    const participant = await db.eventParticipant.findUnique({
      where: { eventId_personId: { eventId: event.id, personId: resident.id } }
    });
    expect(participant).toBeNull(); // visibility only after accept — this route never grants directly
  });

  it("non-member contact-only resident (no account) → a guest EventInvitation", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Cross-Family Picnic" });
    await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

    const resident = await seedResident({
      firstName: "ContactOnly",
      email: "contactonly@example.com",
      emailNormalized: "contactonly@example.com"
    });

    const household = await db.household.create({ data: { name: "Guest House", country: "US" } });
    await addResidentToHousehold(household.id, resident.id);
    await linkHouseholdToFamily(household.id, familyGroup.id);

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/invitations`)
      .set("Authorization", "Bearer mock")
      .send({ invitees: [{ kind: "household", householdId: household.id }] });

    expect(res.status).toBe(201);
    expect(res.body.invitations).toHaveLength(1);
    expect(res.body.invitations[0].channel).toBe("GUEST");

    const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id, linkedPersonId: resident.id } });
    expect(inv).not.toBeNull();
    expect(inv?.guestToken).toBeTruthy();
    expect(inv?.guestEmail).toBe("contactonly@example.com");
  });

  it("passive minor non-member → skipped by display name only, reason MINOR_NON_MEMBER, no personId", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Cross-Family Party" });
    await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

    // A minor with a contact on file still gets skipped — minors never get a direct
    // token/guest invite; only guardian in-app consent applies (mirrors linkRequest.ts).
    const resident = await seedResident({
      firstName: "MinorKid",
      lastName: "NoConsent",
      ageGateLevel: "CHILD",
      email: "kid@example.com",
      emailNormalized: "kid@example.com"
    });

    const household = await db.household.create({ data: { name: "Minor House", country: "US" } });
    await addResidentToHousehold(household.id, resident.id);
    await linkHouseholdToFamily(household.id, familyGroup.id);

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/invitations`)
      .set("Authorization", "Bearer mock")
      .send({ invitees: [{ kind: "household", householdId: household.id }] });

    expect(res.status).toBe(201);
    expect(res.body.invitations).toHaveLength(0);
    expect(res.body.skipped).toEqual([{ displayName: "MinorKid NoConsent", reason: "MINOR_NON_MEMBER" }]);
    expect(res.body.skipped[0].personId).toBeUndefined();

    const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id, OR: [{ personId: resident.id }, { linkedPersonId: resident.id }] } });
    expect(inv).toBeNull();
  });

  it("passive non-member with no contact and no account → skipped, reason NO_CONTACT", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Cross-Family Cookout" });
    await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

    const resident = await seedResident({ firstName: "Ghost", lastName: "NoReach" });

    const household = await db.household.create({ data: { name: "Quiet House", country: "US" } });
    await addResidentToHousehold(household.id, resident.id);
    await linkHouseholdToFamily(household.id, familyGroup.id);

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/invitations`)
      .set("Authorization", "Bearer mock")
      .send({ invitees: [{ kind: "household", householdId: household.id }] });

    expect(res.status).toBe(201);
    expect(res.body.invitations).toHaveLength(0);
    expect(res.body.skipped).toEqual([{ displayName: "Ghost NoReach", reason: "NO_CONTACT" }]);
  });

  it("household-access gate: 403 when the organizer's family is not linked to the household", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Unlinked House Event" });
    await db.event.update({ where: { id: event.id }, data: { eventVisibility: "OPEN" } });

    // Household exists but has NO HouseholdFamily row linking it to this event's family.
    const household = await db.household.create({ data: { name: "Unlinked House", country: "US" } });
    const resident = await seedResident({ firstName: "Unreachable" });
    await addResidentToHousehold(household.id, resident.id);

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/invitations`)
      .set("Authorization", "Bearer mock")
      .send({ invitees: [{ kind: "household", householdId: household.id }] });

    expect(res.status).toBe(403);
    const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id } });
    expect(inv).toBeNull(); // fail-closed: no partial writes
  });

  it("event-admin gate: a household expansion that reaches a cross-family resident requires canAdmin", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    // Plain member (not admin, not creator) — canAdmin will resolve false.
    const plainMember = await seedSecondPerson();
    await db.familyMember.create({
      data: { familyGroupId: familyGroup.id, personId: plainMember.id, roles: ["MEMBER"], permissions: [] }
    });
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Member Invite Attempt" });
    await db.event.update({ where: { id: event.id }, data: { eventVisibility: "OPEN" } }); // OPEN: any member may invite

    // Cross-family resident with an account — expansion is NOT purely in-family.
    const resident = await seedResident({ firstName: "Foreign", userId: "user_foreign_001" });
    const household = await db.household.create({ data: { name: "Cross House", country: "US" } });
    await addResidentToHousehold(household.id, resident.id);
    await linkHouseholdToFamily(household.id, familyGroup.id);

    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/invitations`)
      .set("Authorization", "Bearer mock")
      .send({ invitees: [{ kind: "household", householdId: household.id }] });

    expect(res.status).toBe(403);
    const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id } });
    expect(inv).toBeNull();
  });

  it("response carries no guestToken, linkedPersonId, personId, email, or phone — for a mixed household expansion", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Mixed Expansion Event" });
    await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

    const memberResident = await seedResident({ firstName: "InFam" });
    await db.familyMember.create({
      data: { familyGroupId: familyGroup.id, personId: memberResident.id, roles: ["MEMBER"], permissions: [] }
    });
    const activeResident = await seedResident({ firstName: "ActiveAcct", userId: "user_mixed_active_001" });
    const contactResident = await seedResident({
      firstName: "ContactOnly2",
      email: "mixed@example.com",
      emailNormalized: "mixed@example.com",
      phone: "+15551234567"
    });
    const minorResident = await seedResident({ firstName: "MinorNoConsent", ageGateLevel: "TEEN" });

    const household = await db.household.create({ data: { name: "Mixed House", country: "US" } });
    for (const r of [memberResident, activeResident, contactResident, minorResident]) {
      await addResidentToHousehold(household.id, r.id);
    }
    await linkHouseholdToFamily(household.id, familyGroup.id);

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID }); // event creator → canAdmin true
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/invitations`)
      .set("Authorization", "Bearer mock")
      .send({ invitees: [{ kind: "household", householdId: household.id }] });

    expect(res.status).toBe(201);
    expect(res.body.invitations).toHaveLength(3); // member + famlinkUser + guest; minor is skipped
    expect(res.body.skipped).toHaveLength(1);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("guestToken");
    expect(serialized).not.toContain("linkedPersonId");
    expect(serialized).not.toContain(memberResident.id);
    expect(serialized).not.toContain(activeResident.id);
    expect(serialized).not.toContain(contactResident.id);
    expect(serialized).not.toContain(minorResident.id);
    expect(serialized).not.toContain("mixed@example.com");
    expect(serialized).not.toContain("+15551234567");
    // every invitation entry is the safe {displayName, channel, status} shape
    for (const inv of res.body.invitations) {
      expect(Object.keys(inv).sort()).toEqual(["channel", "displayName", "status"]);
    }
    for (const s of res.body.skipped) {
      expect(Object.keys(s).sort()).toEqual(["displayName", "reason"]);
    }
  });
});
