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

/** Household linked to exactly ONE family. */
async function seedHousehold(familyGroupId: string, name = "Main House") {
  const household = await db.household.create({
    data: { name, country: "US", families: { create: { familyGroupId } } }
  });
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
  const { familyGroup: famAInitial } = await seedTestFamily(adminA.id);
  // Distinct names (council/review): seedTestFamily's default "Test Family" is identical for
  // both families, which would let a linkedFamilies bug (e.g. returning the same family twice,
  // or the wrong family's name) pass a same-name assertion undetected.
  const famA = await db.familyGroup.update({ where: { id: famAInitial.id }, data: { name: "Family A" } });
  const memberA = await seedPerson("user_test_member_a", "Mia", "A");
  await db.familyMember.create({
    data: { familyGroupId: famA.id, personId: memberA.id, roles: [], permissions: [] }
  });

  const adminB = await seedPerson(TEST_USER_2_CLERK_ID, "Bob", "B");
  const { familyGroup: famBInitial } = await seedTestFamily(adminB.id);
  const famB = await db.familyGroup.update({ where: { id: famBInitial.id }, data: { name: "Family B" } });
  const memberB = await seedPerson("user_test_member_b", "Meg", "B");
  await db.familyMember.create({
    data: { familyGroupId: famB.id, personId: memberB.id, roles: [], permissions: [] }
  });

  const outsider = await seedPerson("user_test_outsider", "Out", "Sider");

  const household = await db.household.create({
    data: {
      name: "Shared Home",
      country: "US",
      families: { create: { familyGroupId: famA.id, linkedByPersonId: adminA.id } }
    }
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
    data: {
      name: "Solo House",
      country: "US",
      families: { create: { familyGroupId: famA.id, linkedByPersonId: adminA.id } }
    }
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
      expect(names).toEqual(["Family A", "Family B"]); // distinct names discriminate mix-ups

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

  describe("POST /api/v1/households/:householdId/unlink — cascade-remove stranded residents", () => {
    it("removes a resident whose only membership was in the unlinked family, with a RESIDENT_REMOVED audit entry naming them", async () => {
      const f = await twoFamilyFixture();
      await db.householdMember.create({
        data: { householdId: f.household.id, personId: f.memberB.id, role: "RESIDENT" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID }); // adminB unlinks famB
      const res = await request(app)
        .post(`/api/v1/households/${f.household.id}/unlink`)
        .set("Authorization", "Bearer mock")
        .send({ familyGroupId: f.famB.id });

      expect(res.status).toBe(204);

      const hm = await db.householdMember.findUnique({
        where: { householdId_personId: { householdId: f.household.id, personId: f.memberB.id } }
      });
      expect(hm).toBeNull();

      const entries = await db.householdAuditEntry.findMany({ where: { householdId: f.household.id } });
      const removedEntry = entries.find(
        (e) =>
          e.action === "RESIDENT_REMOVED" &&
          (e.changes as { residentDisplayName?: { from?: string } } | null)?.residentDisplayName?.from ===
            "Meg B"
      );
      expect(removedEntry).toBeDefined();
      expect(removedEntry?.actorPersonId).toBe(f.adminB.id);
      expect(removedEntry?.actorFamilyGroupId).toBe(f.famB.id);
    });

    it("retains a resident who is an active member of BOTH families after one family unlinks", async () => {
      const f = await twoFamilyFixture();
      // memberA also joins famB, so they're an active member of both linked families.
      await db.familyMember.create({
        data: { familyGroupId: f.famB.id, personId: f.memberA.id, roles: [], permissions: [] }
      });
      await db.householdMember.create({
        data: { householdId: f.household.id, personId: f.memberA.id, role: "RESIDENT" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID }); // adminB unlinks famB
      const res = await request(app)
        .post(`/api/v1/households/${f.household.id}/unlink`)
        .set("Authorization", "Bearer mock")
        .send({ familyGroupId: f.famB.id });

      expect(res.status).toBe(204);

      const hm = await db.householdMember.findUnique({
        where: { householdId_personId: { householdId: f.household.id, personId: f.memberA.id } }
      });
      expect(hm).not.toBeNull();

      const removed = await db.householdAuditEntry.findMany({
        where: { householdId: f.household.id, action: "RESIDENT_REMOVED" }
      });
      expect(removed).toHaveLength(0);
    });

    it("leaves a resident untouched when they are a member of the remaining family but never a member of the unlinked family", async () => {
      const f = await twoFamilyFixture();
      // memberA is only ever a member of famA (the family that stays linked), never of famB.
      await db.householdMember.create({
        data: { householdId: f.household.id, personId: f.memberA.id, role: "RESIDENT" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID }); // adminB unlinks famB
      const res = await request(app)
        .post(`/api/v1/households/${f.household.id}/unlink`)
        .set("Authorization", "Bearer mock")
        .send({ familyGroupId: f.famB.id });

      expect(res.status).toBe(204);

      const hm = await db.householdMember.findUnique({
        where: { householdId_personId: { householdId: f.household.id, personId: f.memberA.id } }
      });
      expect(hm).not.toBeNull();

      const removed = await db.householdAuditEntry.findMany({
        where: { householdId: f.household.id, action: "RESIDENT_REMOVED" }
      });
      expect(removed).toHaveLength(0);
    });

    it("leaves an orphaned resident untouched — no active membership in the unlinked family or any remaining linked family", async () => {
      const f = await twoFamilyFixture();
      // outsider has a HouseholdMember row but is not an active member of famA (stays linked)
      // or famB (being unlinked) — an out-of-scope stray membership. Only losses caused by
      // THIS unlink are in scope; this regression-guards the `inUnlinkedFamily.has(id) &&`
      // conjunct in the cascade criterion (without it, "not in any remaining family" alone
      // would over-broadly sweep this resident up too).
      await db.householdMember.create({
        data: { householdId: f.household.id, personId: f.outsider.id, role: "RESIDENT" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID }); // adminB unlinks famB
      const res = await request(app)
        .post(`/api/v1/households/${f.household.id}/unlink`)
        .set("Authorization", "Bearer mock")
        .send({ familyGroupId: f.famB.id });

      expect(res.status).toBe(204);

      const hm = await db.householdMember.findUnique({
        where: { householdId_personId: { householdId: f.household.id, personId: f.outsider.id } }
      });
      expect(hm).not.toBeNull();

      const entries = await db.householdAuditEntry.findMany({ where: { householdId: f.household.id } });
      const removedEntry = entries.find(
        (e) =>
          e.action === "RESIDENT_REMOVED" &&
          (e.changes as { residentDisplayName?: { from?: string } } | null)?.residentDisplayName?.from ===
            "Out Sider"
      );
      expect(removedEntry).toBeUndefined();
    });

    it("Fix A (CRITICAL): a cascade-removed resident's id never appears anywhere in the audit payload — only their display name", async () => {
      const f = await twoFamilyFixture();
      await db.householdMember.create({
        data: { householdId: f.household.id, personId: f.memberB.id, role: "RESIDENT" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID }); // adminB unlinks famB, stranding memberB
      const unlinkRes = await request(app)
        .post(`/api/v1/households/${f.household.id}/unlink`)
        .set("Authorization", "Bearer mock")
        .send({ familyGroupId: f.famB.id });
      expect(unlinkRes.status).toBe(204);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID }); // adminA — remaining family's admin
      const res = await request(app)
        .get(`/api/v1/households/${f.household.id}/audit`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);

      // Whole-payload check (not just the `changes` key): proves the id is absent by
      // construction, so the test still catches a future leak introduced anywhere else in
      // this response shape.
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain(f.memberB.id);

      const removedEntry = res.body.entries.find(
        (e: { action: string }) => e.action === "RESIDENT_REMOVED"
      );
      expect(removedEntry).toBeDefined();
      expect(removedEntry.changes).toEqual({
        residentDisplayName: { from: "Meg B", to: null }
      });
    });

    it("destroy:true on the last link still deletes the household and all its members (unaffected by the cascade)", async () => {
      const f = await oneFamilyFixture();
      const resident = await seedPerson("user_test_resident2", "Res2", "Ident2");
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

      const entries = await db.householdAuditEntry.findMany({ where: { householdId: f.household.id } });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("DESTROYED");
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

    it("Fix 2 (invariant 1): a foreign-family actor's ids are absent but display name + family name are present; an own-family actor's ids are present", async () => {
      const f = await twoFamilyFixture();

      // UPDATED by adminA (own family, from adminA's viewpoint)
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      await request(app)
        .put(`/api/v1/households/${f.household.id}`)
        .set("Authorization", "Bearer mock")
        .send({ name: "Renamed by A" });

      // UNLINKED by adminB (foreign family, from adminA's viewpoint)
      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      await request(app)
        .post(`/api/v1/households/${f.household.id}/unlink`)
        .set("Authorization", "Bearer mock")
        .send({ familyGroupId: f.famB.id });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID }); // adminA views
      const res = await request(app)
        .get(`/api/v1/households/${f.household.id}/audit`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      const updated = res.body.entries.find((e: { action: string }) => e.action === "UPDATED");
      const unlinked = res.body.entries.find((e: { action: string }) => e.action === "UNLINKED");

      // Own-family entry: ids present
      expect(updated.actorPersonId).toBe(f.adminA.id);
      expect(updated.actorFamilyGroupId).toBe(f.famA.id);
      expect(updated.actorDisplayName).toBe("Ada A");
      expect(updated.actorFamilyName).toBe("Family A");

      // Foreign-family entry: ids absent (not undefined-but-present — actually absent keys)
      expect(unlinked).not.toHaveProperty("actorPersonId");
      expect(unlinked).not.toHaveProperty("actorFamilyGroupId");
      expect(unlinked.actorDisplayName).toBe("Bob B");
      expect(unlinked.actorFamilyName).toBe("Family B");
    });

    it("Fix 2: a deleted actor still renders, with a placeholder display name, and does not crash the endpoint", async () => {
      const f = await twoFamilyFixture();
      await db.householdMember.create({ data: { householdId: f.household.id, personId: f.memberA.id, role: "RESIDENT" } });

      // memberA self-removes -> RESIDENT_REMOVED audit entry with actorPersonId = memberA.id,
      // actorFamilyGroupId = famA.id (memberA's own family, from adminA's later viewpoint).
      mockGetAuth.mockReturnValue({ userId: "user_test_member_a" });
      const del = await request(app)
        .delete(`/api/v1/households/${f.household.id}/members/${f.memberA.id}`)
        .set("Authorization", "Bearer mock");
      expect(del.status).toBe(204);

      // actorPersonId/actorFamilyGroupId are deliberately logical columns (no FK) — deleting
      // the Person must not break rendering of the audit entry that references them.
      await db.person.delete({ where: { id: f.memberA.id } });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID }); // adminA, still exists
      const res = await request(app)
        .get(`/api/v1/households/${f.household.id}/audit`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      const removed = res.body.entries.find((e: { action: string }) => e.action === "RESIDENT_REMOVED");
      expect(removed).toBeDefined();
      expect(removed.actorFamilyGroupId).toBe(f.famA.id); // own family — id still shown
      expect(removed.actorPersonId).toBe(f.memberA.id); // dangling but still the actor's id
      expect(removed.actorDisplayName).toBe("Unknown member"); // person no longer resolvable
      expect(removed.actorFamilyName).toBe("Family A");
    });

    it("Fix 3: entries are ordered newest-first across two separate requests (no tie — createdAt alone already orders these)", async () => {
      const f = await oneFamilyFixture();
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });

      await request(app)
        .put(`/api/v1/households/${f.household.id}`)
        .set("Authorization", "Bearer mock")
        .send({ name: "Rename 1" });
      await request(app)
        .put(`/api/v1/households/${f.household.id}`)
        .set("Authorization", "Bearer mock")
        .send({ name: "Rename 2" });

      const res = await request(app)
        .get(`/api/v1/households/${f.household.id}/audit`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(2);
      expect(res.body.entries[0].action).toBe("UPDATED");
      expect(res.body.entries[0].changes).toMatchObject({ name: { to: "Rename 2" } });
      expect(res.body.entries[1].changes).toMatchObject({ name: { to: "Rename 1" } });
    });

    it("Fix C1: entries with a genuinely tied createdAt are ordered by the id-desc secondary key", async () => {
      // NOTE on construction (see final-review-fixes-2-report.md for the full finding): the
      // unlink cascade does NOT actually produce a createdAt tie in this codebase — verified
      // empirically. Raw SQL confirms Postgres's CURRENT_TIMESTAMP is genuinely transaction-
      // constant, but Prisma 7.7's `.create()` generates `@default(now())` values CLIENT-SIDE
      // per call (new Date() at call time), not via the DB DEFAULT, so sequential creates in
      // the same $transaction still get millisecond-distinct createdAt values in practice. The
      // spec/plan's "rows written in one transaction share CURRENT_TIMESTAMP" premise does not
      // hold for this ORM version. A tie CAN still occur for real (two writes landing in the
      // same millisecond, or any future write path that sets createdAt explicitly), so the
      // secondary key is still load-bearing — this test constructs a genuine tie directly to
      // exercise it deterministically.
      const f = await oneFamilyFixture();
      const tiedAt = new Date("2026-01-01T00:00:00.000Z");
      await db.householdAuditEntry.createMany({
        data: [
          {
            householdId: f.household.id,
            actorPersonId: f.adminA.id,
            actorFamilyGroupId: f.famA.id,
            action: "UPDATED",
            changes: { name: { from: "a", to: "b" } },
            createdAt: tiedAt
          },
          {
            householdId: f.household.id,
            actorPersonId: f.adminA.id,
            actorFamilyGroupId: f.famA.id,
            action: "UPDATED",
            changes: { name: { from: "b", to: "c" } },
            createdAt: tiedAt
          },
          {
            householdId: f.household.id,
            actorPersonId: f.adminA.id,
            actorFamilyGroupId: f.famA.id,
            action: "UPDATED",
            changes: { name: { from: "c", to: "d" } },
            createdAt: tiedAt
          }
        ]
      });

      const dbEntries = await db.householdAuditEntry.findMany({
        where: { householdId: f.household.id },
        orderBy: [{ id: "desc" }]
      });
      expect(dbEntries).toHaveLength(3);
      // Confirm the tie is real, not incidental.
      expect(new Set(dbEntries.map((e) => e.createdAt.getTime())).size).toBe(1);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/households/${f.household.id}/audit`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      expect(res.body.entries.map((e: { id: string }) => e.id)).toEqual(dbEntries.map((e) => e.id));
    });

    it("Fix C2: response is capped at take:200 even when more entries exist", async () => {
      const f = await oneFamilyFixture();
      const rows = Array.from({ length: 201 }, (_, i) => ({
        householdId: f.household.id,
        actorPersonId: f.adminA.id,
        actorFamilyGroupId: f.famA.id,
        action: "UPDATED",
        changes: { name: { from: `v${i}`, to: `v${i + 1}` } }
      }));
      await db.householdAuditEntry.createMany({ data: rows });
      expect(await db.householdAuditEntry.count({ where: { householdId: f.household.id } })).toBe(201);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/households/${f.household.id}/audit`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(200);
    });
  });
});
