import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { TEST_CLERK_ID, TEST_USER_2_CLERK_ID } from "../helpers/auth";
import { seedSecondPerson, seedTestFamily, seedTestPerson } from "../helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

/** Household linked to exactly ONE family (dual-write parity with families.ts household creation). */
async function seedHousehold(familyGroupId: string, name = "Main House") {
  const household = await db.household.create({ data: { familyGroupId, name, country: "US" } });
  await db.householdFamily.create({ data: { householdId: household.id, familyGroupId } });
  return household;
}

/** Admin (TEST_CLERK_ID) owns the family; second person is a plain MEMBER. */
async function seedFamilyWithMember() {
  const admin = await seedTestPerson();
  const { familyGroup } = await seedTestFamily(admin.id);
  const member = await seedSecondPerson();
  await db.familyMember.create({
    data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
  });
  return { admin, member, familyGroup };
}

async function seedPerson(userId: string, firstName: string, lastName: string) {
  return db.person.create({ data: { firstName, lastName, ageGateLevel: "ADULT", userId } });
}

/**
 * Two families (famA, famB) both linked to one household. adminA/adminB are ADMIN of their
 * own family; memberA/memberB are plain MEMBERs; outsider belongs to neither family.
 */
async function twoFamilyFixture() {
  const adminA = await seedPerson(TEST_CLERK_ID, "Ada", "A");
  const { familyGroup: famA } = await seedTestFamily(adminA.id);
  const memberA = await seedPerson("user_test_member_a", "Mia", "A");
  await db.familyMember.create({
    data: { familyGroupId: famA.id, personId: memberA.id, roles: [], permissions: [] }
  });

  const adminB = await seedPerson(TEST_USER_2_CLERK_ID, "Bob", "B");
  const { familyGroup: famB } = await seedTestFamily(adminB.id);
  const memberB = await seedPerson("user_test_member_b", "Meg", "B");
  await db.familyMember.create({
    data: { familyGroupId: famB.id, personId: memberB.id, roles: [], permissions: [] }
  });

  const outsider = await seedPerson("user_test_outsider", "Out", "Sider");

  const household = await db.household.create({
    data: { familyGroupId: famA.id, name: "Shared Home", country: "US" }
  });
  await db.householdFamily.create({
    data: { householdId: household.id, familyGroupId: famA.id, linkedByPersonId: adminA.id }
  });
  await db.householdFamily.create({
    data: { householdId: household.id, familyGroupId: famB.id, linkedByPersonId: adminB.id }
  });

  return { adminA, memberA, famA, adminB, memberB, famB, outsider, household };
}

/** Single family, single link — used for the min-1 / destroy scenarios. */
async function oneFamilyFixture() {
  const adminA = await seedPerson(TEST_CLERK_ID, "Ada", "A");
  const { familyGroup: famA } = await seedTestFamily(adminA.id);
  const household = await db.household.create({
    data: { familyGroupId: famA.id, name: "Solo House", country: "US" }
  });
  await db.householdFamily.create({
    data: { householdId: household.id, familyGroupId: famA.id, linkedByPersonId: adminA.id }
  });
  return { adminA, famA, household };
}

describe("households routes", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => mockGetAuth.mockReset());

  describe("PUT /api/v1/households/:householdId", () => {
    it("admin updates household fields", async () => {
      const { familyGroup } = await seedFamilyWithMember();
      const household = await seedHousehold(familyGroup.id);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/households/${household.id}`)
        .set("Authorization", "Bearer mock")
        .send({ name: "Lake House", city: "Lincoln", state: "NE" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Lake House");
      expect(res.body.city).toBe("Lincoln");
      expect(res.body.state).toBe("NE");
      expect(res.body.familyGroupId).toBeUndefined();

      const entries = await db.householdAuditEntry.findMany({ where: { householdId: household.id } });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("UPDATED");
      expect(entries[0].changes).toMatchObject({
        name: { from: "Main House", to: "Lake House" },
        city: { to: "Lincoln" },
        state: { to: "NE" }
      });
    });

    it("non-admin member gets 403", async () => {
      const { familyGroup } = await seedFamilyWithMember();
      const household = await seedHousehold(familyGroup.id);

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/households/${household.id}`)
        .set("Authorization", "Bearer mock")
        .send({ name: "Hijacked" });

      expect(res.status).toBe(403);
    });

    it("404 for unknown household", async () => {
      await seedTestPerson();
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .put("/api/v1/households/nope")
        .set("Authorization", "Bearer mock")
        .send({ name: "X" });
      expect(res.status).toBe(404);
    });

    it("PUT by second family's admin succeeds and writes an UPDATED audit entry with a field diff", async () => {
      const f = await twoFamilyFixture();

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID }); // adminB
      const res = await request(app)
        .put(`/api/v1/households/${f.household.id}`)
        .set("Authorization", "Bearer mock")
        .send({ name: "Renamed by B" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Renamed by B");

      const entries = await db.householdAuditEntry.findMany({ where: { householdId: f.household.id } });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("UPDATED");
      expect(entries[0].actorPersonId).toBe(f.adminB.id);
      expect(entries[0].actorFamilyGroupId).toBe(f.famB.id);
      expect(entries[0].changes).toMatchObject({ name: { from: "Shared Home", to: "Renamed by B" } });

      const updated = await db.household.findUnique({ where: { id: f.household.id } });
      expect(updated?.name).toBe("Renamed by B");
    });

    it("PUT by a plain member is 403", async () => {
      const f = await twoFamilyFixture();

      mockGetAuth.mockReturnValue({ userId: "user_test_member_a" }); // memberA
      const res = await request(app)
        .put(`/api/v1/households/${f.household.id}`)
        .set("Authorization", "Bearer mock")
        .send({ name: "Hijacked by member" });

      expect(res.status).toBe(403);
      const entries = await db.householdAuditEntry.findMany({ where: { householdId: f.household.id } });
      expect(entries).toHaveLength(0);
      const unchanged = await db.household.findUnique({ where: { id: f.household.id } });
      expect(unchanged?.name).toBe("Shared Home");
    });

    it("no-op guard: identical values write no audit entry and do not advance updatedAt", async () => {
      const { familyGroup } = await seedFamilyWithMember();
      const household = await seedHousehold(familyGroup.id);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/households/${household.id}`)
        .set("Authorization", "Bearer mock")
        .send({ name: "Main House" }); // identical to seeded value

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Main House");

      const entries = await db.householdAuditEntry.findMany({ where: { householdId: household.id } });
      expect(entries).toHaveLength(0);
      const row = await db.household.findUnique({ where: { id: household.id } });
      expect(row?.updatedAt.getTime()).toBe(household.updatedAt.getTime());
    });
  });

  describe("GET /api/v1/households/:householdId", () => {
    it("GET household returns linkedFamilies names and members to a member of the second family", async () => {
      const f = await twoFamilyFixture();
      await db.householdMember.create({ data: { householdId: f.household.id, personId: f.memberA.id, role: "RESIDENT" } });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID }); // adminB, second family
      const res = await request(app)
        .get(`/api/v1/households/${f.household.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      const names = res.body.linkedFamilies.map((x: { name: string }) => x.name).sort();
      expect(names).toEqual(["Test Family", "Test Family"]); // both seedTestFamily default names

      const own = res.body.linkedFamilies.find((x: { id?: string }) => x.id === f.famB.id);
      expect(own).toBeDefined();
      const foreign = res.body.linkedFamilies.filter((x: { id?: string }) => x.id === undefined);
      expect(foreign).toHaveLength(1); // famA is foreign to adminB

      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0]).toMatchObject({
        personId: f.memberA.id,
        role: "RESIDENT",
        displayName: "Mia A"
      });
    });

    it("GET household is 403 for a non-member of every linked family", async () => {
      const f = await twoFamilyFixture();

      mockGetAuth.mockReturnValue({ userId: "user_test_outsider" });
      const res = await request(app)
        .get(`/api/v1/households/${f.household.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(403);
    });

    it("404 for unknown household", async () => {
      await seedTestPerson();
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get("/api/v1/households/nope")
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(404);
    });

    it("invariant-1 leak regression: response contains EXACTLY the whitelisted keys", async () => {
      const f = await twoFamilyFixture();
      await db.householdMember.create({ data: { householdId: f.household.id, personId: f.memberA.id, role: "RESIDENT" } });

      mockGetAuth.mockReturnValue({ userId: "user_test_member_a" }); // memberA — cross-family viewer relative to famB
      const res = await request(app)
        .get(`/api/v1/households/${f.household.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          "city",
          "country",
          "createdAt",
          "id",
          "linkedFamilies",
          "members",
          "name",
          "state",
          "street",
          "updatedAt",
          "zip"
        ].sort()
      );

      for (const fam of res.body.linkedFamilies as Array<Record<string, unknown>>) {
        if (fam.id !== undefined) {
          expect(Object.keys(fam).sort()).toEqual(["id", "name"]);
        } else {
          expect(Object.keys(fam)).toEqual(["name"]);
        }
      }

      for (const member of res.body.members as Array<Record<string, unknown>>) {
        expect(Object.keys(member).sort()).toEqual(
          ["displayName", "id", "joinedAt", "personId", "role"].sort()
        );
      }
    });
  });

  describe("POST /api/v1/households/:householdId/members", () => {
    it("admin adds a family member to the household", async () => {
      const { member, familyGroup } = await seedFamilyWithMember();
      const household = await seedHousehold(familyGroup.id);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/households/${household.id}/members`)
        .set("Authorization", "Bearer mock")
        .send({ personId: member.id, role: "RESIDENT" });

      expect(res.status).toBe(201);
      expect(res.body.personId).toBe(member.id);
      expect(res.body.role).toBe("RESIDENT");

      const entries = await db.householdAuditEntry.findMany({ where: { householdId: household.id } });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("RESIDENT_ADDED");
    });

    it("400 when target is not a family member", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const outsider = await seedSecondPerson(); // no family membership
      const household = await seedHousehold(familyGroup.id);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/households/${household.id}/members`)
        .set("Authorization", "Bearer mock")
        .send({ personId: outsider.id });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/member of the family/i);
    });

    it("non-admin member gets 403", async () => {
      const { admin, familyGroup } = await seedFamilyWithMember();
      const household = await seedHousehold(familyGroup.id);

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/households/${household.id}/members`)
        .set("Authorization", "Bearer mock")
        .send({ personId: admin.id });

      expect(res.status).toBe(403);
    });

    it("400 on duplicate household membership", async () => {
      const { member, familyGroup } = await seedFamilyWithMember();
      const household = await seedHousehold(familyGroup.id);
      await db.householdMember.create({ data: { householdId: household.id, personId: member.id } });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/households/${household.id}/members`)
        .set("Authorization", "Bearer mock")
        .send({ personId: member.id });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already in this household/i);
    });

    it("POST members accepts a person who is member of the OTHER linked family", async () => {
      const f = await twoFamilyFixture();

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID }); // adminA adding memberB
      const res = await request(app)
        .post(`/api/v1/households/${f.household.id}/members`)
        .set("Authorization", "Bearer mock")
        .send({ personId: f.memberB.id, role: "RESIDENT" });

      expect(res.status).toBe(201);
      expect(res.body.personId).toBe(f.memberB.id);

      const hm = await db.householdMember.findUnique({
        where: { householdId_personId: { householdId: f.household.id, personId: f.memberB.id } }
      });
      expect(hm).not.toBeNull();

      const entries = await db.householdAuditEntry.findMany({ where: { householdId: f.household.id } });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("RESIDENT_ADDED");
      expect(entries[0].actorFamilyGroupId).toBe(f.famA.id);
    });
  });

  describe("DELETE /api/v1/households/:householdId/members/:personId", () => {
    it("a member can remove themselves", async () => {
      const { member, familyGroup } = await seedFamilyWithMember();
      const household = await seedHousehold(familyGroup.id);
      await db.householdMember.create({ data: { householdId: household.id, personId: member.id } });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/households/${household.id}/members/${member.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(204);
      const hm = await db.householdMember.findUnique({
        where: { householdId_personId: { householdId: household.id, personId: member.id } }
      });
      expect(hm).toBeNull();
      const entries = await db.householdAuditEntry.findMany({ where: { householdId: household.id } });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("RESIDENT_REMOVED");
      expect(entries[0].actorPersonId).toBe(member.id);
    });

    it("an admin can remove another member", async () => {
      const { member, familyGroup } = await seedFamilyWithMember();
      const household = await seedHousehold(familyGroup.id);
      await db.householdMember.create({ data: { householdId: household.id, personId: member.id } });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/households/${household.id}/members/${member.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(204);
      const entries = await db.householdAuditEntry.findMany({ where: { householdId: household.id } });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("RESIDENT_REMOVED");
    });

    it("a non-admin cannot remove someone else", async () => {
      const { admin, familyGroup } = await seedFamilyWithMember();
      const household = await seedHousehold(familyGroup.id);
      await db.householdMember.create({ data: { householdId: household.id, personId: admin.id } });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/households/${household.id}/members/${admin.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(403);
    });

    it("404 when household membership does not exist", async () => {
      const { member, familyGroup } = await seedFamilyWithMember();
      const household = await seedHousehold(familyGroup.id);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/households/${household.id}/members/${member.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/v1/households/:householdId/unlink", () => {
    it("unlink one of two links: 204, link gone, UNLINKED audit entry, household survives", async () => {
      const f = await twoFamilyFixture();

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID }); // adminB unlinks famB
      const res = await request(app)
        .post(`/api/v1/households/${f.household.id}/unlink`)
        .set("Authorization", "Bearer mock")
        .send({ familyGroupId: f.famB.id });

      expect(res.status).toBe(204);

      const link = await db.householdFamily.findUnique({
        where: { householdId_familyGroupId: { householdId: f.household.id, familyGroupId: f.famB.id } }
      });
      expect(link).toBeNull();

      const remaining = await db.householdFamily.count({ where: { householdId: f.household.id } });
      expect(remaining).toBe(1);

      const household = await db.household.findUnique({ where: { id: f.household.id } });
      expect(household).not.toBeNull();

      const entries = await db.householdAuditEntry.findMany({ where: { householdId: f.household.id } });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("UNLINKED");
      expect(entries[0].actorFamilyGroupId).toBe(f.famB.id);
      expect(entries[0].actorPersonId).toBe(f.adminB.id);
    });

    it("unlink the last link without destroy: 409 LAST_LINK, nothing deleted", async () => {
      const f = await oneFamilyFixture();

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/households/${f.household.id}/unlink`)
        .set("Authorization", "Bearer mock")
        .send({ familyGroupId: f.famA.id });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("LAST_LINK");
      expect(await db.household.findUnique({ where: { id: f.household.id } })).not.toBeNull();
      expect(await db.householdFamily.count({ where: { householdId: f.household.id } })).toBe(1);
      expect(await db.householdAuditEntry.count({ where: { householdId: f.household.id } })).toBe(0);
    });

    it("unlink last link with destroy:true: 204, household + members gone, DESTROYED audit entry persists", async () => {
      const f = await oneFamilyFixture();
      const resident = await seedPerson("user_test_resident", "Res", "Ident");
      await db.familyMember.create({
        data: { familyGroupId: f.famA.id, personId: resident.id, roles: [], permissions: [] }
      });
      await db.householdMember.create({ data: { householdId: f.household.id, personId: resident.id } });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/households/${f.household.id}/unlink`)
        .set("Authorization", "Bearer mock")
        .send({ familyGroupId: f.famA.id, destroy: true });

      expect(res.status).toBe(204);

      expect(await db.household.findUnique({ where: { id: f.household.id } })).toBeNull();
      expect(await db.householdMember.count({ where: { householdId: f.household.id } })).toBe(0);
      expect(await db.householdFamily.count({ where: { householdId: f.household.id } })).toBe(0);

      const entries = await db.householdAuditEntry.findMany({ where: { householdId: f.household.id } });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("DESTROYED");
    });

    it("unlink requires admin of the named family itself (admin of the OTHER family is 403)", async () => {
      const f = await twoFamilyFixture();

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID }); // adminB, not admin of famA
      const res = await request(app)
        .post(`/api/v1/households/${f.household.id}/unlink`)
        .set("Authorization", "Bearer mock")
        .send({ familyGroupId: f.famA.id });

      expect(res.status).toBe(403);
      expect(await db.householdFamily.count({ where: { householdId: f.household.id } })).toBe(2);
      expect(await db.householdAuditEntry.count({ where: { householdId: f.household.id } })).toBe(0);
    });

    it("unlink refuses when the named familyGroupId is not linked to this household, even with destroy:true (hijack regression)", async () => {
      const f = await oneFamilyFixture();
      const adminC = await seedPerson("user_test_admin_c", "Cai", "C");
      const { familyGroup: famC } = await seedTestFamily(adminC.id); // admin of famC, but famC is NOT linked to f.household

      mockGetAuth.mockReturnValue({ userId: "user_test_admin_c" });
      const res = await request(app)
        .post(`/api/v1/households/${f.household.id}/unlink`)
        .set("Authorization", "Bearer mock")
        .send({ familyGroupId: famC.id, destroy: true });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Link not found");
      expect(await db.household.findUnique({ where: { id: f.household.id } })).not.toBeNull();
      expect(await db.householdFamily.count({ where: { householdId: f.household.id } })).toBe(1);
      expect(await db.householdAuditEntry.count({ where: { householdId: f.household.id } })).toBe(0);
    });

    it("audit history persists after destroy (append-only): DESTROYED entry readable-by-DB after the household row is gone", async () => {
      const f = await oneFamilyFixture();

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/households/${f.household.id}/unlink`)
        .set("Authorization", "Bearer mock")
        .send({ familyGroupId: f.famA.id, destroy: true });

      expect(res.status).toBe(204);
      expect(await db.household.findUnique({ where: { id: f.household.id } })).toBeNull();

      const entries = await db.householdAuditEntry.findMany({ where: { householdId: f.household.id } });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("DESTROYED");
      expect(entries[0].actorFamilyGroupId).toBe(f.famA.id);
    });
  });

  describe("GET /api/v1/households/:householdId/audit", () => {
    it("returns entries newest-first to any linked family's admin, 403 to plain members", async () => {
      const f = await twoFamilyFixture();

      // Generate two audit entries in sequence: UPDATED (by adminA) then UNLINKED (by adminB).
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      await request(app)
        .put(`/api/v1/households/${f.household.id}`)
        .set("Authorization", "Bearer mock")
        .send({ name: "Renamed" });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      await request(app)
        .post(`/api/v1/households/${f.household.id}/unlink`)
        .set("Authorization", "Bearer mock")
        .send({ familyGroupId: f.famB.id });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID }); // adminA, still linked
      const res = await request(app)
        .get(`/api/v1/households/${f.household.id}/audit`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(2);
      expect(res.body.entries[0].action).toBe("UNLINKED"); // newest first
      expect(res.body.entries[1].action).toBe("UPDATED");
      expect(new Date(res.body.entries[0].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(res.body.entries[1].createdAt).getTime()
      );

      mockGetAuth.mockReturnValue({ userId: "user_test_member_a" }); // plain member
      const forbidden = await request(app)
        .get(`/api/v1/households/${f.household.id}/audit`)
        .set("Authorization", "Bearer mock");
      expect(forbidden.status).toBe(403);
    });

    it("404 for unknown household", async () => {
      await seedTestPerson();
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get("/api/v1/households/nope/audit")
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(404);
    });
  });
});
