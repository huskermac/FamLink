import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { seedTestFamily } from "../../__tests__/helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

describe("accept/decline + inbox for /api/v1/link-requests", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  // Personid -> clerk userId lookup, populated by seedPerson below (mirrors the Task-4
  // create-test harness so the fixtures can assert on Person.id FK columns while the
  // auth mock keys off the Clerk user id).
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
      preferredName: string | null;
      ageGateLevel: string;
      email: string | null;
      phone: string | null;
      guardianPersonId: string | null;
      dateOfBirth: Date | null;
    }>
  ) {
    const person = await db.person.create({
      data: {
        firstName: overrides?.firstName ?? "Test",
        lastName: overrides?.lastName ?? "Person",
        preferredName: overrides?.preferredName,
        ageGateLevel: overrides?.ageGateLevel ?? "ADULT",
        userId: clerkId ?? null,
        email: overrides?.email,
        phone: overrides?.phone,
        guardianPersonId: overrides?.guardianPersonId,
        dateOfBirth: overrides?.dateOfBirth
      }
    });
    if (clerkId) clerkIdByPersonId.set(person.id, clerkId);
    return person;
  }

  /** Seed a person AND register a fresh unique clerk id for them, so they can authenticate. */
  async function seedAuthedPerson(
    overrides?: Parameters<typeof seedPerson>[1]
  ) {
    nextClerkId += 1;
    return seedPerson(`user_test_accept_${nextClerkId}`, overrides);
  }

  /** Authenticate as the given Person.id (must have been seeded with a clerk id). */
  function actingAs(personId: string) {
    const clerkId = clerkIdByPersonId.get(personId);
    if (!clerkId) throw new Error(`actingAs: no clerk id registered for person ${personId}`);
    mockGetAuth.mockReturnValue({ userId: clerkId });
    return request(app);
  }
  const asAdmin = actingAs;
  const asPerson = actingAs;

  async function seedAdminFamily() {
    nextClerkId += 1;
    const admin = await seedPerson(`user_test_admin_${nextClerkId}`);
    const { familyGroup } = await seedTestFamily(admin.id);
    return { admin, familyGroup };
  }

  /** Directly create a PENDING FAMILY_MEMBERSHIP LinkRequest row, bypassing the create route
   *  (already covered by Task 4's tests) so this suite can focus on accept/decline/inbox. */
  async function seedMembershipRequest(overrides: {
    familyGroupId: string;
    targetPersonId: string;
    requestedByPersonId: string;
    direction?: "PULL" | "JOIN";
    carryHouseholdId?: string;
    expiresAt?: Date;
    status?: string;
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
        attestedAdult: false,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 30 * 86_400_000)
      }
    });
  }

  describe("self-accept (PULL, active adult target)", () => {
    it("grants membership with the default MEMBER role", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Target", lastName: "Adult" });
      const linkRequest = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: target.id,
        requestedByPersonId: admin.id
      });

      const res = await asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ACCEPTED");
      expect(res.body.granted).toBe(true);

      const member = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: target.id } }
      });
      expect(member).not.toBeNull();
      expect(member?.roles).toEqual(["MEMBER"]);
    });

    it("the initiating admin cannot self-accept a PULL they created (403)", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Target", lastName: "Adult" });
      const linkRequest = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: target.id,
        requestedByPersonId: admin.id
      });

      const res = await asAdmin(admin.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`);

      expect(res.status).toBe(403);
      const row = await db.linkRequest.findUnique({ where: { id: linkRequest.id } });
      expect(row?.status).toBe("PENDING");
    });
  });

  describe("JOIN accept (role-derived authority)", () => {
    it("a JOIN admin is the counterparty and can accept", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const applicant = await seedAuthedPerson({ firstName: "Ap", lastName: "Plicant" });
      const linkRequest = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: applicant.id,
        requestedByPersonId: applicant.id,
        direction: "JOIN"
      });

      const res = await asAdmin(admin.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`);

      expect(res.status).toBe(200);
      expect(res.body.granted).toBe(true);
      const member = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: applicant.id } }
      });
      expect(member).not.toBeNull();
    });

    it("the applicant themselves cannot accept their own JOIN (403)", async () => {
      const { familyGroup } = await seedAdminFamily();
      const applicant = await seedAuthedPerson({ firstName: "Ap", lastName: "Plicant" });
      const linkRequest = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: applicant.id,
        requestedByPersonId: applicant.id,
        direction: "JOIN"
      });

      const res = await asPerson(applicant.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`);

      expect(res.status).toBe(403);
    });
  });

  describe("minor-guardian accept", () => {
    it("an ADULT non-suspended admin of the minor's family accepts and sets consentedByPersonId", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      // The minor already belongs to a family the guardian (admin) admins — this is the
      // in-family minor-guardian branch of canConsentMembership.
      const minor = await seedPerson(null, { firstName: "Minor", lastName: "Kid", ageGateLevel: "TEEN" });
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: minor.id, roles: [], permissions: [] }
      });
      const requestingAdmin = await seedAdminFamily();
      const linkRequest = await seedMembershipRequest({
        familyGroupId: requestingAdmin.familyGroup.id,
        targetPersonId: minor.id,
        requestedByPersonId: requestingAdmin.admin.id
      });

      const res = await asAdmin(admin.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`);

      expect(res.status).toBe(200);
      expect(res.body.granted).toBe(true);

      const row = await db.linkRequest.findUnique({ where: { id: linkRequest.id } });
      expect(row?.status).toBe("ACCEPTED");
      expect(row?.consentedByPersonId).toBe(admin.id);

      const member = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId: requestingAdmin.familyGroup.id, personId: minor.id } }
      });
      expect(member).not.toBeNull();
    });

    it("a family-less minor's guardianPersonId can accept", async () => {
      const guardian = await seedAuthedPerson({ firstName: "Guardian", lastName: "One" });
      const minor = await seedPerson(null, {
        firstName: "Minor",
        lastName: "Ward",
        ageGateLevel: "CHILD",
        guardianPersonId: guardian.id
      });
      const requestingAdmin = await seedAdminFamily();
      const linkRequest = await seedMembershipRequest({
        familyGroupId: requestingAdmin.familyGroup.id,
        targetPersonId: minor.id,
        requestedByPersonId: requestingAdmin.admin.id
      });

      const res = await asPerson(guardian.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`);

      expect(res.status).toBe(200);
      expect(res.body.granted).toBe(true);
    });
  });

  describe("concurrency", () => {
    it("two simultaneous accepts create exactly one membership", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Race", lastName: "Target" });
      const linkRequest = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: target.id,
        requestedByPersonId: admin.id
      });

      const [res1, res2] = await Promise.all([
        asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`),
        asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`)
      ]);

      expect([res1.status, res2.status]).toEqual([200, 200]);
      const grantedCount = [res1.body.granted, res2.body.granted].filter(Boolean).length;
      expect(grantedCount).toBe(1);

      const members = await db.familyMember.findMany({
        where: { familyGroupId: familyGroup.id, personId: target.id }
      });
      expect(members.length).toBe(1);
    });

    it("an accept-versus-decline race ends in one terminal state; a grant exists only if ACCEPTED won", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Race2", lastName: "Target" });
      const linkRequest = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: target.id,
        requestedByPersonId: admin.id
      });

      const [acceptRes, declineRes] = await Promise.all([
        asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`),
        asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/decline`)
      ]);

      expect([acceptRes.status, declineRes.status]).toEqual([200, 200]);

      const row = await db.linkRequest.findUnique({ where: { id: linkRequest.id } });
      expect(["ACCEPTED", "DECLINED"]).toContain(row?.status);

      const member = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: target.id } }
      });
      if (row?.status === "ACCEPTED") {
        expect(member).not.toBeNull();
      } else {
        expect(member).toBeNull();
      }
    });

    it("a repeat accept of an already-member target keeps the membership count at 1", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Repeat", lastName: "Target" });
      const linkRequest = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: target.id,
        requestedByPersonId: admin.id
      });

      const first = await asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`);
      expect(first.status).toBe(200);
      expect(first.body.granted).toBe(true);

      const second = await asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`);
      expect(second.status).toBe(200);
      expect(second.body.granted).toBe(false);

      const members = await db.familyMember.findMany({
        where: { familyGroupId: familyGroup.id, personId: target.id }
      });
      expect(members.length).toBe(1);
    });
  });

  describe("expiry", () => {
    it("an expired PENDING request is persisted EXPIRED and the accept returns 200/granted:false", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Expired", lastName: "Target" });
      const linkRequest = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: target.id,
        requestedByPersonId: admin.id,
        expiresAt: new Date(Date.now() - 1000)
      });

      const res = await asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`);

      expect(res.status).toBe(200);
      expect(res.body.granted).toBe(false);
      expect(res.body.status).toBe("EXPIRED");

      const row = await db.linkRequest.findUnique({ where: { id: linkRequest.id } });
      expect(row?.status).toBe("EXPIRED");
      const member = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: target.id } }
      });
      expect(member).toBeNull();
    });

    it("a foreign caller posting accept to an EXPIRED-but-unswept request gets 403 and the row stays PENDING", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Unswept", lastName: "Target" });
      const foreigner = await seedAuthedPerson({ firstName: "Foreign", lastName: "Caller" });
      const linkRequest = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: target.id,
        requestedByPersonId: admin.id,
        expiresAt: new Date(Date.now() - 1000)
      });

      const res = await asPerson(foreigner.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`);

      expect(res.status).toBe(403);
      const row = await db.linkRequest.findUnique({ where: { id: linkRequest.id } });
      expect(row?.status).toBe("PENDING");
    });
  });

  describe("already-resolved idempotency", () => {
    it("an authorized counterparty gets the current state on a re-accept of a DECLINED request", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Declined", lastName: "Target" });
      const linkRequest = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: target.id,
        requestedByPersonId: admin.id
      });
      const declineRes = await asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/decline`);
      expect(declineRes.status).toBe(200);
      expect(declineRes.body.status).toBe("DECLINED");

      const res = await asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("DECLINED");
      expect(res.body.granted).toBe(false);
    });

    it("any other (unauthorized) caller gets 403 on an already-resolved request", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Declined2", lastName: "Target" });
      const foreigner = await seedAuthedPerson({ firstName: "Foreign2", lastName: "Caller" });
      const linkRequest = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: target.id,
        requestedByPersonId: admin.id
      });
      await asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/decline`);

      const res = await asPerson(foreigner.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`);

      expect(res.status).toBe(403);
    });
  });

  describe("GET /pending inbox", () => {
    it("shows a family-less minor's guardian the request", async () => {
      const guardian = await seedAuthedPerson({ firstName: "Guardian", lastName: "Inbox" });
      const minor = await seedPerson(null, {
        firstName: "Minor",
        lastName: "Inbox",
        ageGateLevel: "CHILD",
        guardianPersonId: guardian.id
      });
      const requestingAdmin = await seedAdminFamily();
      await seedMembershipRequest({
        familyGroupId: requestingAdmin.familyGroup.id,
        targetPersonId: minor.id,
        requestedByPersonId: requestingAdmin.admin.id
      });

      const res = await asPerson(guardian.id).get("/api/v1/link-requests/pending");

      expect(res.status).toBe(200);
      expect(res.body.requests.length).toBe(1);
      expect(res.body.requests[0].targetName).toBe("Minor");
    });

    it("returns names only (no ids beyond the request id, no token) and is DB-scoped", async () => {
      const { admin: targetAdmin, familyGroup: targetFamily } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Self", lastName: "Target" });
      await seedMembershipRequest({
        familyGroupId: targetFamily.id,
        targetPersonId: target.id,
        requestedByPersonId: targetAdmin.id
      });

      // Foreign tenant's unrelated PENDING request must never appear for `target`.
      const { admin: foreignAdmin, familyGroup: foreignFamily } = await seedAdminFamily();
      const foreignTarget = await seedAuthedPerson({ firstName: "Foreign", lastName: "Unrelated" });
      const foreignRequest = await seedMembershipRequest({
        familyGroupId: foreignFamily.id,
        targetPersonId: foreignTarget.id,
        requestedByPersonId: foreignAdmin.id
      });

      const res = await asPerson(target.id).get("/api/v1/link-requests/pending");

      expect(res.status).toBe(200);
      expect(res.body.requests.length).toBe(1);
      const item = res.body.requests[0];
      expect(item).toEqual({
        id: expect.any(String),
        kind: "FAMILY_MEMBERSHIP",
        direction: "PULL",
        requestingFamilyName: expect.any(String),
        targetName: "Self",
        carryHouseholdName: null,
        notice: expect.any(String)
      });
      expect(item.token).toBeUndefined();
      expect(item.familyGroupId).toBeUndefined();
      expect(item.targetPersonId).toBeUndefined();

      // The foreign row is never mutated on read.
      const foreignRow = await db.linkRequest.findUnique({ where: { id: foreignRequest.id } });
      expect(foreignRow?.status).toBe("PENDING");
    });
  });
});
