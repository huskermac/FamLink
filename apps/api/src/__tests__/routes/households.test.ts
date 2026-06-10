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

async function seedHousehold(familyGroupId: string, name = "Main House") {
  return db.household.create({ data: { familyGroupId, name, country: "US" } });
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
});
