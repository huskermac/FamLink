import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { seedTestFamily } from "../../__tests__/helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

describe("HOUSEHOLD_LINK requests (PULL + JOIN)", () => {
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
    overrides?: Partial<{ firstName: string; lastName: string }>
  ) {
    const person = await db.person.create({
      data: {
        firstName: overrides?.firstName ?? "Test",
        lastName: overrides?.lastName ?? "Person",
        ageGateLevel: "ADULT",
        userId: clerkId ?? null
      }
    });
    if (clerkId) clerkIdByPersonId.set(person.id, clerkId);
    return person;
  }

  async function seedAuthedPerson(overrides?: Parameters<typeof seedPerson>[1]) {
    nextClerkId += 1;
    return seedPerson(`user_test_household_${nextClerkId}`, overrides);
  }

  function actingAs(personId: string) {
    const clerkId = clerkIdByPersonId.get(personId);
    if (!clerkId) throw new Error(`actingAs: no clerk id registered for person ${personId}`);
    mockGetAuth.mockReturnValue({ userId: clerkId });
    return request(app);
  }
  const asAdmin = actingAs;
  const asPerson = actingAs;

  /** Seed a family with a fresh authed admin. */
  async function seedAdminFamily() {
    const admin = await seedAuthedPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    return { admin, familyGroup };
  }

  /** Add `personId` to `familyGroupId` with the given roles (default: plain member, no ADMIN). */
  async function addMember(familyGroupId: string, personId: string, roles: string[] = []) {
    return db.familyMember.create({
      data: { familyGroupId, personId, roles, permissions: [] }
    });
  }

  /** Create a Household, optionally pre-linked to some families, with a resident who is a
   *  member of `visibleToFamilyGroupId` (so that family "sees" the household per §PULL precondition). */
  async function seedHousehold(opts?: { visibleToFamilyGroupId?: string; linkedFamilyGroupIds?: string[] }) {
    const household = await db.household.create({ data: { name: "Test House", country: "US" } });
    if (opts?.visibleToFamilyGroupId) {
      const resident = await seedPerson(null, { firstName: "Resident", lastName: "Person" });
      await addMember(opts.visibleToFamilyGroupId, resident.id);
      await db.householdMember.create({ data: { householdId: household.id, personId: resident.id } });
    }
    for (const familyGroupId of opts?.linkedFamilyGroupIds ?? []) {
      await db.householdFamily.create({ data: { householdId: household.id, familyGroupId } });
    }
    return household;
  }

  describe("create: requester authorization", () => {
    it("a non-admin-of-initiating-family requester gets 403 on PULL", async () => {
      const { familyGroup } = await seedAdminFamily();
      const member = await seedAuthedPerson({ firstName: "Plain", lastName: "Member" });
      await addMember(familyGroup.id, member.id); // no ADMIN role
      const household = await seedHousehold({ visibleToFamilyGroupId: familyGroup.id });

      const res = await asPerson(member.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "HOUSEHOLD_LINK",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetHouseholdId: household.id
        });

      expect(res.status).toBe(403);
    });

    it("a non-admin-of-initiating-family requester gets 403 on JOIN", async () => {
      const { familyGroup } = await seedAdminFamily();
      const member = await seedAuthedPerson({ firstName: "Plain2", lastName: "Member2" });
      await addMember(familyGroup.id, member.id); // no ADMIN role
      const { familyGroup: otherFamily } = await seedAdminFamily();
      const household = await seedHousehold({ linkedFamilyGroupIds: [otherFamily.id] });

      const res = await asPerson(member.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "HOUSEHOLD_LINK",
          direction: "JOIN",
          familyGroupId: familyGroup.id,
          targetHouseholdId: household.id
        });

      expect(res.status).toBe(403);
    });
  });

  describe("create: PULL visibility precondition", () => {
    it("PULL create needs the initiating family to see H through a resident-member, else 403", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      // Household with no resident overlap with `familyGroup` at all.
      const household = await db.household.create({ data: { name: "Invisible House", country: "US" } });

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "HOUSEHOLD_LINK",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetHouseholdId: household.id
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("HOUSEHOLD_NOT_VISIBLE");
    });

    it("PULL create succeeds once the initiating family sees H via a resident-member", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const household = await seedHousehold({ visibleToFamilyGroupId: familyGroup.id });

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "HOUSEHOLD_LINK",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetHouseholdId: household.id
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("PENDING");
      expect(res.body.targetHouseholdId).toBe(household.id);
    });

    it("JOIN create succeeds with NO visibility precondition", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const { familyGroup: linkedFamily } = await seedAdminFamily();
      // household is linked to `linkedFamily` only — `familyGroup` has no resident there.
      const household = await seedHousehold({ linkedFamilyGroupIds: [linkedFamily.id] });

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "HOUSEHOLD_LINK",
          direction: "JOIN",
          familyGroupId: familyGroup.id,
          targetHouseholdId: household.id
        });

      expect(res.status).toBe(201);
    });
  });

  describe("create: duplicate-pending rejection", () => {
    it("a second PENDING request for the same (family, household) is rejected (partial index)", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const { familyGroup: linkedFamily } = await seedAdminFamily();
      const household = await seedHousehold({ linkedFamilyGroupIds: [linkedFamily.id] });

      const first = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "HOUSEHOLD_LINK",
          direction: "JOIN",
          familyGroupId: familyGroup.id,
          targetHouseholdId: household.id
        });
      expect(first.status).toBe(201);

      const second = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "HOUSEHOLD_LINK",
          direction: "JOIN",
          familyGroupId: familyGroup.id,
          targetHouseholdId: household.id
        });

      expect(second.status).toBe(409);
      expect(second.body.error).toBe("REQUEST_ALREADY_PENDING");
    });
  });

  describe("accept: PULL", () => {
    it("creates the HouseholdFamily link and a LINKED audit entry attributed to the CONSENTER's linked family", async () => {
      const { admin: adminA, familyGroup: familyA } = await seedAdminFamily();
      const { admin: adminB, familyGroup: familyB } = await seedAdminFamily();
      const household = await seedHousehold({ visibleToFamilyGroupId: familyA.id, linkedFamilyGroupIds: [familyB.id] });

      const createRes = await asAdmin(adminA.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "HOUSEHOLD_LINK",
          direction: "PULL",
          familyGroupId: familyA.id,
          targetHouseholdId: household.id
        });
      expect(createRes.status).toBe(201);
      const requestId = createRes.body.id;

      const acceptRes = await asAdmin(adminB.id).post(`/api/v1/link-requests/${requestId}/accept`);

      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.granted).toBe(true);

      const link = await db.householdFamily.findUnique({
        where: { householdId_familyGroupId: { householdId: household.id, familyGroupId: familyA.id } }
      });
      expect(link).not.toBeNull();

      const auditEntries = await db.householdAuditEntry.findMany({
        where: { householdId: household.id, action: "LINKED" }
      });
      expect(auditEntries.length).toBe(1);
      expect(auditEntries[0].actorFamilyGroupId).toBe(familyB.id); // the consenter's family, NOT familyA
      expect(auditEntries[0].actorPersonId).toBe(adminB.id);
    });
  });

  describe("accept: JOIN (no visibility precondition on accept either)", () => {
    it("accept works even though the initiating family never had visibility of H", async () => {
      const { admin: adminA, familyGroup: familyA } = await seedAdminFamily();
      const { admin: adminB, familyGroup: familyB } = await seedAdminFamily();
      const household = await seedHousehold({ linkedFamilyGroupIds: [familyB.id] }); // A has no resident there

      const createRes = await asAdmin(adminA.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "HOUSEHOLD_LINK",
          direction: "JOIN",
          familyGroupId: familyA.id,
          targetHouseholdId: household.id
        });
      expect(createRes.status).toBe(201);

      const acceptRes = await asAdmin(adminB.id).post(`/api/v1/link-requests/${createRes.body.id}/accept`);

      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.granted).toBe(true);

      const link = await db.householdFamily.findUnique({
        where: { householdId_familyGroupId: { householdId: household.id, familyGroupId: familyA.id } }
      });
      expect(link).not.toBeNull();
    });
  });

  describe("accept: lost authority is re-checked in-tx", () => {
    it("a counterparty who unlinks their family before accept gets UNAUTHORIZED -> 403, request stays PENDING", async () => {
      const { admin: adminA, familyGroup: familyA } = await seedAdminFamily();
      const { admin: adminB, familyGroup: familyB } = await seedAdminFamily();
      const household = await seedHousehold({ linkedFamilyGroupIds: [familyB.id] });

      const createRes = await asAdmin(adminA.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "HOUSEHOLD_LINK",
          direction: "JOIN",
          familyGroupId: familyA.id,
          targetHouseholdId: household.id
        });
      expect(createRes.status).toBe(201);

      // B unlinks from the household BEFORE accepting — loses consent authority.
      await db.householdFamily.delete({
        where: { householdId_familyGroupId: { householdId: household.id, familyGroupId: familyB.id } }
      });

      const acceptRes = await asAdmin(adminB.id).post(`/api/v1/link-requests/${createRes.body.id}/accept`);

      expect(acceptRes.status).toBe(403);
      const row = await db.linkRequest.findUnique({ where: { id: createRes.body.id } });
      expect(row?.status).toBe("PENDING");
    });
  });

  describe("accept: dual authority", () => {
    it("an admin of BOTH the initiating family and a family linked to H can accept", async () => {
      const { admin: adminA, familyGroup: familyA } = await seedAdminFamily();
      const { familyGroup: familyB } = await seedAdminFamily();
      // adminA is ALSO an admin of familyB, which is linked to the household.
      await addMember(familyB.id, adminA.id, ["ADMIN"]);
      const household = await seedHousehold({ linkedFamilyGroupIds: [familyB.id] });

      const createRes = await asAdmin(adminA.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "HOUSEHOLD_LINK",
          direction: "JOIN",
          familyGroupId: familyA.id,
          targetHouseholdId: household.id
        });
      expect(createRes.status).toBe(201);

      const acceptRes = await asAdmin(adminA.id).post(`/api/v1/link-requests/${createRes.body.id}/accept`);

      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.granted).toBe(true);
    });
  });

  describe("accept: idempotency", () => {
    it("a double-accept is idempotent (one link, second call returns granted:false)", async () => {
      const { admin: adminA, familyGroup: familyA } = await seedAdminFamily();
      const { admin: adminB, familyGroup: familyB } = await seedAdminFamily();
      const household = await seedHousehold({ linkedFamilyGroupIds: [familyB.id] });

      const createRes = await asAdmin(adminA.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "HOUSEHOLD_LINK",
          direction: "JOIN",
          familyGroupId: familyA.id,
          targetHouseholdId: household.id
        });

      const first = await asAdmin(adminB.id).post(`/api/v1/link-requests/${createRes.body.id}/accept`);
      expect(first.status).toBe(200);
      expect(first.body.granted).toBe(true);

      const second = await asAdmin(adminB.id).post(`/api/v1/link-requests/${createRes.body.id}/accept`);
      expect(second.status).toBe(200);
      expect(second.body.granted).toBe(false);

      const links = await db.householdFamily.findMany({
        where: { householdId: household.id, familyGroupId: familyA.id }
      });
      expect(links.length).toBe(1);

      const auditEntries = await db.householdAuditEntry.findMany({
        where: { householdId: household.id, action: "LINKED" }
      });
      expect(auditEntries.length).toBe(1);
    });
  });

  describe("GET /pending: household inbox widening", () => {
    it("shows a PENDING household request to an admin of a family linked to the target household", async () => {
      const { admin: adminA, familyGroup: familyA } = await seedAdminFamily();
      const { admin: adminB, familyGroup: familyB } = await seedAdminFamily();
      const household = await seedHousehold({ linkedFamilyGroupIds: [familyB.id] });

      await asAdmin(adminA.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "HOUSEHOLD_LINK",
          direction: "JOIN",
          familyGroupId: familyA.id,
          targetHouseholdId: household.id
        });

      const res = await asAdmin(adminB.id).get("/api/v1/link-requests/pending");

      expect(res.status).toBe(200);
      expect(res.body.requests.length).toBe(1);
      expect(res.body.requests[0].kind).toBe("HOUSEHOLD_LINK");
      expect(res.body.requests[0].targetHouseholdName).toBe(household.name);
      expect(res.body.requests[0].familyGroupId).toBeUndefined();
      expect(res.body.requests[0].targetHouseholdId).toBeUndefined();
    });
  });
});
