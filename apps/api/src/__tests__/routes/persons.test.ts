import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
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

describe("persons routes", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => {
    mockGetAuth.mockReset();
  });

  describe("GET /api/v1/persons/me", () => {
    it("returns 404 when no Person exists for Clerk user", async () => {
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get("/api/v1/persons/me")
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("complete onboarding");
    });

    it("returns Person when record exists", async () => {
      const p = await seedTestPerson();
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get("/api/v1/persons/me")
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(p.id);
      expect(res.body.firstName).toBe("Test");
      expect(res.body.userId).toBe(TEST_CLERK_ID);
    });
  });

  describe("GET /api/v1/persons/me/families", () => {
    it("returns 404 when no Person exists", async () => {
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get("/api/v1/persons/me/families")
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(404);
    });

    it("returns memberships with familyGroup", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get("/api/v1/persons/me/families")
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].familyGroup.id).toBe(familyGroup.id);
      expect(res.body[0].familyGroup.name).toBe("Test Family");
      expect(res.body[0].role).toBe("ADMIN");
    });
  });

  describe("POST /api/v1/persons", () => {
    it("links first Person to Clerk user when requester has no Person yet", async () => {
      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .post("/api/v1/persons")
        .set("Authorization", "Bearer mock")
        .send({
          firstName: "New",
          lastName: "Organizer",
          ageGateLevel: "NONE"
        });
      expect(res.status).toBe(201);
      expect(res.body.userId).toBe(TEST_USER_2_CLERK_ID);
      expect(res.body.firstName).toBe("New");
    });

    it("creates Person with userId null", async () => {
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      await seedTestPerson();
      const res = await request(app)
        .post("/api/v1/persons")
        .set("Authorization", "Bearer mock")
        .send({
          firstName: "Child",
          lastName: "User",
          ageGateLevel: "MINOR"
        });
      expect(res.status).toBe(201);
      expect(res.body.userId).toBeNull();
      expect(res.body.firstName).toBe("Child");
      expect(res.body.ageGateLevel).toBe("MINOR");
    });

    it("returns 400 for invalid body", async () => {
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      await seedTestPerson();
      const res = await request(app)
        .post("/api/v1/persons")
        .set("Authorization", "Bearer mock")
        .send({ firstName: "" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid request body");
    });
  });

  describe("GET /api/v1/persons/:personId", () => {
    it("returns 403 when requester shares no family with target", async () => {
      const me = await seedTestPerson();
      await seedTestFamily(me.id);
      const other = await seedSecondPerson();
      await seedTestFamily(other.id);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/persons/${other.id}`)
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(403);
    });

    it("returns 200 when both share a family group", async () => {
      const me = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(me.id);
      const other = await seedGuestPerson({ firstName: "Other" });
      await db.familyMember.create({
        data: {
          familyGroupId: familyGroup.id,
          personId: other.id,
          roles: ["MEMBER"],
          permissions: []
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/persons/${other.id}`)
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(other.id);
      // Viewer is family admin — prompt includes guardianPersonId for admins (may be null)
      expect(res.body.guardianPersonId).toBeNull();
    });

    it("includes guardianPersonId for family admin viewing a minor", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const ward = await db.person.create({
        data: {
          firstName: "Ward",
          lastName: "Kid",
          ageGateLevel: "MINOR",
          userId: null,
          guardianPersonId: admin.id
        }
      });
      await db.familyMember.create({
        data: {
          familyGroupId: familyGroup.id,
          personId: ward.id,
          roles: ["MEMBER"],
          permissions: []
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/persons/${ward.id}`)
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(200);
      expect(res.body.guardianPersonId).toBe(admin.id);
    });
  });

  describe("PUT /api/v1/persons/:personId", () => {
    it("allows self to update", async () => {
      const p = await seedTestPerson({ firstName: "Old" });
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/persons/${p.id}`)
        .set("Authorization", "Bearer mock")
        .send({ firstName: "New" });
      expect(res.status).toBe(200);
      expect(res.body.firstName).toBe("New");
    });

    it("returns 403 when not self and not admin", async () => {
      const me = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(me.id);
      const attacker = await seedSecondPerson();
      await db.familyMember.create({
        data: {
          familyGroupId: familyGroup.id,
          personId: attacker.id,
          roles: ["MEMBER"],
          permissions: []
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/persons/${me.id}`)
        .set("Authorization", "Bearer mock")
        .send({ firstName: "Hacked" });
      expect(res.status).toBe(403);
    });

    it("allows family admin to update another member in same family", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const member = await seedGuestPerson({ firstName: "Member" });
      await db.familyMember.create({
        data: {
          familyGroupId: familyGroup.id,
          personId: member.id,
          roles: ["MEMBER"],
          permissions: []
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/persons/${member.id}`)
        .set("Authorization", "Bearer mock")
        .send({ preferredName: "Nick" });
      expect(res.status).toBe(200);
      expect(res.body.preferredName).toBe("Nick");
    });

    it("omits guardianPersonId on self-PUT when requester is not guardian or admin/organizer", async () => {
      const parent = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(parent.id);
      const teen = await db.person.create({
        data: {
          firstName: "Teen",
          lastName: "User",
          ageGateLevel: "MINOR",
          userId: TEST_USER_2_CLERK_ID,
          guardianPersonId: parent.id
        }
      });
      await db.familyMember.create({
        data: {
          familyGroupId: familyGroup.id,
          personId: teen.id,
          roles: ["MEMBER"],
          permissions: []
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/persons/${teen.id}`)
        .set("Authorization", "Bearer mock")
        .send({ preferredName: "T" });
      expect(res.status).toBe(200);
      expect(res.body.preferredName).toBe("T");
      expect(res.body.guardianPersonId).toBeUndefined();

      const still = await db.person.findUnique({ where: { id: teen.id } });
      expect(still?.guardianPersonId).toBe(parent.id);
    });
  });
});
