import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { generateConsentToken } from "../../lib/linkRequest";
import { seedTestEvent, seedTestFamily } from "../../__tests__/helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

/**
 * P3-04 W1 PR-2 Task 12 — dedicated isolation regression pack. The per-task
 * suites (linkRequests.accept/create/household.test.ts, consent.page.test.ts,
 * events.household-invite.test.ts) already exercise these behaviors as a side
 * effect of testing their own routes. This file pins each named invariant
 * from the spec/council review EXPLICITLY, independent of any one task's
 * suite, so a future change that breaks isolation fails a test whose name
 * says exactly which invariant broke.
 */
describe("P3-04 W1 PR-2 isolation invariants", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  const clerkIdByPersonId = new Map<string, string>();
  let nextClerkId = 0;

  beforeEach(() => {
    mockGetAuth.mockReset();
    clerkIdByPersonId.clear();
    nextClerkId = 0;
  });

  async function seedPerson(
    clerkId: string | null | undefined,
    overrides?: Partial<{
      firstName: string;
      lastName: string;
      ageGateLevel: string;
      email: string | null;
      phone: string | null;
    }>
  ) {
    const person = await db.person.create({
      data: {
        firstName: overrides?.firstName ?? "Test",
        lastName: overrides?.lastName ?? "Person",
        ageGateLevel: overrides?.ageGateLevel ?? "ADULT",
        userId: clerkId ?? null,
        email: overrides?.email,
        phone: overrides?.phone
      }
    });
    if (clerkId) clerkIdByPersonId.set(person.id, clerkId);
    return person;
  }

  async function seedAuthedPerson(overrides?: Parameters<typeof seedPerson>[1]) {
    nextClerkId += 1;
    return seedPerson(`user_test_isolation_${nextClerkId}`, overrides);
  }

  function actingAs(personId: string) {
    const clerkId = clerkIdByPersonId.get(personId);
    if (!clerkId) throw new Error(`actingAs: no clerk id registered for person ${personId}`);
    mockGetAuth.mockReturnValue({ userId: clerkId });
    return request(app);
  }
  const asAdmin = actingAs;
  const asPerson = actingAs;

  async function seedAdminFamily() {
    const admin = await seedAuthedPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    return { admin, familyGroup };
  }

  async function seedMembershipRequest(overrides: {
    familyGroupId: string;
    targetPersonId: string;
    requestedByPersonId: string;
    direction?: "PULL" | "JOIN";
    carryHouseholdId?: string;
    expiresAt?: Date;
    status?: string;
    token?: string | null;
  }) {
    return db.linkRequest.create({
      data: {
        kind: "FAMILY_MEMBERSHIP",
        direction: overrides.direction ?? "PULL",
        familyGroupId: overrides.familyGroupId,
        targetPersonId: overrides.targetPersonId,
        carryHouseholdId: overrides.carryHouseholdId ?? null,
        requestedByPersonId: overrides.requestedByPersonId,
        status: overrides.status ?? "PENDING",
        consentChannel: "IN_APP",
        token: overrides.token ?? null,
        attestedAdult: false,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 30 * 86_400_000)
      }
    });
  }

  async function seedHousehold(opts?: { linkedFamilyGroupIds?: string[] }) {
    const household = await db.household.create({ data: { name: "Isolation House", country: "US" } });
    for (const familyGroupId of opts?.linkedFamilyGroupIds ?? []) {
      await db.householdFamily.create({ data: { householdId: household.id, familyGroupId } });
    }
    return household;
  }

  describe("inv1: the inbox carries names only — no foreign id, no roster, no token", () => {
    it("GET /link-requests/pending (FAMILY_MEMBERSHIP) never echoes the requesting admin's id, the carried household's roster, or the row's token", async () => {
      const { admin: reqAdmin, familyGroup: reqFamily } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Target", lastName: "Person" });

      // A household carried into the request — its NAME is disclosed by design (§ carry-in),
      // but its roster (resident ids/names) must never appear in the counterparty's inbox.
      const carriedHousehold = await seedHousehold({ linkedFamilyGroupIds: [reqFamily.id] });
      const hiddenResident = await seedPerson(null, { firstName: "RosterGhost", lastName: "Hidden" });
      await db.householdMember.create({ data: { householdId: carriedHousehold.id, personId: hiddenResident.id } });

      const linkRequest = await seedMembershipRequest({
        familyGroupId: reqFamily.id,
        targetPersonId: target.id,
        requestedByPersonId: reqAdmin.id,
        carryHouseholdId: carriedHousehold.id,
        token: generateConsentToken() // a row-level token that must never leak through the inbox
      });

      const res = await asPerson(target.id).get("/api/v1/link-requests/pending");
      expect(res.status).toBe(200);
      expect(res.body.requests.length).toBe(1);

      const json = JSON.stringify(res.body);
      expect(json).not.toContain(linkRequest.token);
      expect(json).not.toContain(reqAdmin.id);
      expect(json).not.toContain(reqFamily.id);
      expect(json).not.toContain(carriedHousehold.id);
      expect(json).not.toContain(hiddenResident.id);
      expect(json).not.toContain("RosterGhost");
      expect(Object.keys(res.body.requests[0]).sort()).toEqual(
        ["carryHouseholdName", "direction", "id", "kind", "notice", "requestingFamilyName", "targetName"].sort()
      );
    });

    it("GET /link-requests/pending (HOUSEHOLD_LINK) carries the target household's name only — never its roster or the initiating family's id", async () => {
      const { admin: reqAdmin, familyGroup: reqFamily } = await seedAdminFamily();
      const { admin: targetAdmin, familyGroup: targetFamily } = await seedAdminFamily();
      const household = await seedHousehold({ linkedFamilyGroupIds: [targetFamily.id] });
      const hiddenResident = await seedPerson(null, { firstName: "HouseholdGhost", lastName: "Hidden" });
      await db.householdMember.create({ data: { householdId: household.id, personId: hiddenResident.id } });

      await db.linkRequest.create({
        data: {
          kind: "HOUSEHOLD_LINK",
          direction: "JOIN",
          familyGroupId: reqFamily.id,
          targetHouseholdId: household.id,
          requestedByPersonId: reqAdmin.id,
          status: "PENDING",
          expiresAt: new Date(Date.now() + 30 * 86_400_000)
        }
      });

      const res = await asAdmin(targetAdmin.id).get("/api/v1/link-requests/pending");
      expect(res.status).toBe(200);
      expect(res.body.requests.length).toBe(1);

      const json = JSON.stringify(res.body);
      expect(json).not.toContain(reqFamily.id);
      expect(json).not.toContain(reqAdmin.id);
      expect(json).not.toContain(hiddenResident.id);
      expect(json).not.toContain("HouseholdGhost");
      expect(res.body.requests[0].targetHouseholdName).toBe(household.name);
    });
  });

  describe("inv1: the consent page carries names only — no foreign id, no roster, no token", () => {
    async function seedTokenRequest(opts: { familyGroupId: string; requestedByPersonId: string; email: string }) {
      const target = await db.person.create({
        data: { firstName: "Target", lastName: "Person", ageGateLevel: "ADULT", userId: null, email: opts.email }
      });
      const linkRequest = await db.linkRequest.create({
        data: {
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: opts.familyGroupId,
          targetPersonId: target.id,
          requestedByPersonId: opts.requestedByPersonId,
          status: "PENDING",
          token: generateConsentToken(),
          tokenChannel: "EMAIL",
          deliveredContact: opts.email,
          attestedAdult: true,
          expiresAt: new Date(Date.now() + 30 * 86_400_000)
        }
      });
      return { target, linkRequest };
    }

    it("GET /api/v1/consent/:token carries the family + target name only", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const { target, linkRequest } = await seedTokenRequest({
        familyGroupId: familyGroup.id,
        requestedByPersonId: admin.id,
        email: "iso.target@example.com"
      });

      const res = await request(app).get(`/api/v1/consent/${linkRequest.token}`);

      expect(res.status).toBe(200);
      const json = JSON.stringify(res.body);
      expect(json).not.toContain(linkRequest.token);
      expect(json).not.toContain(familyGroup.id);
      expect(json).not.toContain(admin.id);
      expect(json).not.toContain(target.id);
      expect(Object.keys(res.body).sort()).toEqual(["familyName", "notice", "status", "targetName"].sort());
    });
  });

  describe("inv4: the consent token never reaches the request log — path or Referer", () => {
    it("captures the real Morgan output and asserts [redacted], not a console spy", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await db.person.create({
        data: {
          firstName: "Logged",
          lastName: "Target",
          ageGateLevel: "ADULT",
          userId: null,
          email: "iso.log.target@example.com"
        }
      });
      const linkRequest = await db.linkRequest.create({
        data: {
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetPersonId: target.id,
          requestedByPersonId: admin.id,
          status: "PENDING",
          token: generateConsentToken(),
          tokenChannel: "EMAIL",
          deliveredContact: "iso.log.target@example.com",
          attestedAdult: true,
          expiresAt: new Date(Date.now() + 30 * 86_400_000)
        }
      });
      const token = linkRequest.token!;

      const writes: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
        writes.push(String(chunk));
        return true;
      });

      try {
        await request(app).get(`/api/v1/consent/${token}`);
        await request(app).post(`/api/v1/consent/${token}/accept`).set("Referer", `http://localhost:3000/consent/${token}`);
      } finally {
        stdoutSpy.mockRestore();
      }

      const logLines = writes.join("");
      expect(logLines).toContain("[redacted]");
      expect(logLines).not.toContain(token);
    });
  });

  describe("inv5: only a matrix counterparty may accept — a foreign caller is rejected before any write", () => {
    it("a foreign caller on a PULL membership request gets 403 and the row stays PENDING with no FamilyMember row written", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Target", lastName: "Membership" });
      const foreigner = await seedAuthedPerson({ firstName: "Foreign", lastName: "Caller" });
      const linkRequest = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: target.id,
        requestedByPersonId: admin.id
      });

      const res = await asPerson(foreigner.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`);

      expect(res.status).toBe(403);
      const row = await db.linkRequest.findUnique({ where: { id: linkRequest.id } });
      expect(row?.status).toBe("PENDING");
      const member = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: target.id } }
      });
      expect(member).toBeNull();
    });

    it("a foreign caller on a HOUSEHOLD_LINK request gets 403 and the row stays PENDING with no HouseholdFamily row written", async () => {
      const { admin: reqAdmin, familyGroup: reqFamily } = await seedAdminFamily();
      const { familyGroup: linkedFamily } = await seedAdminFamily();
      const household = await seedHousehold({ linkedFamilyGroupIds: [linkedFamily.id] });
      const foreigner = await seedAuthedPerson({ firstName: "Foreign2", lastName: "Household" });

      const createRes = await asAdmin(reqAdmin.id)
        .post("/api/v1/link-requests")
        .send({ kind: "HOUSEHOLD_LINK", direction: "JOIN", familyGroupId: reqFamily.id, targetHouseholdId: household.id });
      expect(createRes.status).toBe(201);

      const res = await asPerson(foreigner.id).post(`/api/v1/link-requests/${createRes.body.id}/accept`);

      expect(res.status).toBe(403);
      const row = await db.linkRequest.findUnique({ where: { id: createRes.body.id } });
      expect(row?.status).toBe("PENDING");
      const link = await db.householdFamily.findUnique({
        where: { householdId_familyGroupId: { householdId: household.id, familyGroupId: reqFamily.id } }
      });
      expect(link).toBeNull();
    });
  });

  describe("row-existence: no FamilyMember/HouseholdFamily row exists while a request is PENDING", () => {
    it("a PENDING FAMILY_MEMBERSHIP request creates no FamilyMember row for the target", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Pending", lastName: "Target" });
      await seedMembershipRequest({ familyGroupId: familyGroup.id, targetPersonId: target.id, requestedByPersonId: admin.id });

      const member = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: target.id } }
      });
      expect(member).toBeNull();
    });

    it("a PENDING HOUSEHOLD_LINK request creates no HouseholdFamily row for the initiating family", async () => {
      const { admin: reqAdmin, familyGroup: reqFamily } = await seedAdminFamily();
      const { familyGroup: linkedFamily } = await seedAdminFamily();
      const household = await seedHousehold({ linkedFamilyGroupIds: [linkedFamily.id] });

      const createRes = await asAdmin(reqAdmin.id)
        .post("/api/v1/link-requests")
        .send({ kind: "HOUSEHOLD_LINK", direction: "JOIN", familyGroupId: reqFamily.id, targetHouseholdId: household.id });
      expect(createRes.status).toBe(201);

      const link = await db.householdFamily.findUnique({
        where: { householdId_familyGroupId: { householdId: household.id, familyGroupId: reqFamily.id } }
      });
      expect(link).toBeNull();
    });
  });

  describe("escalation: the household-invite response carries no token and no foreign personId", () => {
    it("a mixed household expansion's invitations and skipped[] carry no guestToken/linkedPersonId/personId", async () => {
      const admin = await seedAuthedPerson({ firstName: "Organizer", lastName: "Admin" });
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Isolation Mixed Event" });
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

      const memberResident = await seedPerson(null, { firstName: "InFam", lastName: "Member" });
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: memberResident.id, roles: ["MEMBER"], permissions: [] }
      });
      const activeResident = await seedPerson("user_iso_active_001", { firstName: "ActiveAcct", lastName: "Cross" });
      const contactResident = await seedPerson(null, {
        firstName: "ContactOnly",
        lastName: "Cross",
        email: "iso.mixed@example.com"
      });
      const minorResident = await seedPerson(null, { firstName: "MinorNoConsent", lastName: "Cross", ageGateLevel: "TEEN" });

      const household = await seedHousehold();
      for (const r of [memberResident, activeResident, contactResident, minorResident]) {
        await db.householdMember.create({ data: { householdId: household.id, personId: r.id } });
      }
      await db.householdFamily.create({ data: { householdId: household.id, familyGroupId: familyGroup.id } });

      const res = await asAdmin(admin.id)
        .post(`/api/v1/events/${event.id}/invitations`)
        .send({ invitees: [{ kind: "household", householdId: household.id }] });

      expect(res.status).toBe(201);
      expect(res.body.invitations.length).toBe(3); // member + famlinkUser + guest; minor is skipped
      expect(res.body.skipped.length).toBe(1);

      const json = JSON.stringify(res.body);
      expect(json).not.toContain("guestToken");
      expect(json).not.toContain("linkedPersonId");
      expect(json).not.toContain(memberResident.id);
      expect(json).not.toContain(activeResident.id);
      expect(json).not.toContain(contactResident.id);
      expect(json).not.toContain(minorResident.id);
      expect(json).not.toContain("iso.mixed@example.com");

      for (const inv of res.body.invitations) {
        expect(Object.keys(inv).sort()).toEqual(["channel", "displayName", "status"]);
      }
      for (const s of res.body.skipped) {
        expect(Object.keys(s).sort()).toEqual(["displayName", "reason"]);
      }
    });
  });
});
