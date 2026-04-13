import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { CREATOR_PERMISSIONS, CREATOR_ROLES } from "../../lib/familyAccess";
import { TEST_CLERK_ID, TEST_USER_2_CLERK_ID } from "../helpers/auth";
import {
  seedGuestPerson,
  seedSecondPerson,
  seedTestFamily,
  seedTestPerson
} from "../helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
  getAuth: vi.fn()
}));

describe("families & households routes", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => {
    mockGetAuth.mockReset();
  });

  describe("POST /api/v1/families", () => {
    it("returns 400 when requester has no Person record", async () => {
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post("/api/v1/families")
        .set("Authorization", "Bearer mock")
        .send({ name: "Smith Family" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("onboarding");
    });

    it("creates family and creator membership with ADMIN, ORGANIZER, and permissions", async () => {
      await seedTestPerson();
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post("/api/v1/families")
        .set("Authorization", "Bearer mock")
        .send({ name: "Smith Family" });
      expect(res.status).toBe(201);
      expect(res.body.familyGroup.name).toBe("Smith Family");
      expect(res.body.membership.roles.sort()).toEqual([...CREATOR_ROLES].sort());
      expect(res.body.membership.permissions.sort()).toEqual([...CREATOR_PERMISSIONS].sort());
    });
  });

  describe("GET /api/v1/families/:familyId", () => {
    it("returns 403 when requester is not a member", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      await seedSecondPerson();
      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/families/${familyGroup.id}`)
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(403);
    });

    it("returns 200 with nested members and households for a member", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/families/${familyGroup.id}`)
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(200);
      expect(res.body.familyGroup.id).toBe(familyGroup.id);
      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0].person.id).toBe(admin.id);
      expect(res.body.households).toEqual([]);
    });
  });

  describe("DELETE /api/v1/families/:familyId/members/:personId", () => {
    it("returns 400 when removing the last admin", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/families/${familyGroup.id}/members/${admin.id}`)
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/last admin/i);
    });

    it("allows removing self when not the only admin scenario", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const other = await seedGuestPerson();
      await db.familyMember.create({
        data: {
          familyGroupId: familyGroup.id,
          personId: other.id,
          roles: ["ADMIN"],
          permissions: []
        }
      });
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/families/${familyGroup.id}/members/${admin.id}`)
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(204);
    });
  });

  describe("POST /api/v1/households/:householdId/members", () => {
    it("returns 400 when person is not a family member", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const household = await db.household.create({
        data: {
          familyGroupId: familyGroup.id,
          name: "Main",
          country: "US"
        }
      });
      const outsider = await seedSecondPerson();
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/households/${household.id}/members`)
        .set("Authorization", "Bearer mock")
        .send({ personId: outsider.id });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/member of the family/i);
    });
  });
});
