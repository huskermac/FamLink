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

jest.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
  getAuth: jest.fn()
}));

async function seedFamilyWithTwoMembers(): Promise<{
  admin: Awaited<ReturnType<typeof seedTestPerson>>;
  other: Awaited<ReturnType<typeof seedGuestPerson>>;
  familyGroup: Awaited<ReturnType<typeof seedTestFamily>>["familyGroup"];
}> {
  const admin = await seedTestPerson();
  const other = await seedGuestPerson();
  const { familyGroup } = await seedTestFamily(admin.id);
  await db.familyMember.create({
    data: {
      familyGroupId: familyGroup.id,
      personId: other.id,
      roles: ["MEMBER"],
      permissions: []
    }
  });
  return { admin, other, familyGroup };
}

describe("relationships routes", () => {
  const app = createApp();
  const mockGetAuth = getAuth as jest.Mock;

  beforeEach(() => {
    mockGetAuth.mockReset();
  });

  describe("POST /api/v1/families/:familyId/relationships", () => {
    it("creates primary and reciprocal in one transaction for PARENT", async () => {
      const { admin, other, familyGroup } = await seedFamilyWithTwoMembers();
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/relationships`)
        .set("Authorization", "Bearer mock")
        .send({
          fromPersonId: admin.id,
          toPersonId: other.id,
          type: "PARENT"
        });
      expect(res.status).toBe(201);
      expect(res.body.relationship.type).toBe("PARENT");
      expect(res.body.reciprocal).not.toBeNull();
      expect(res.body.reciprocal.type).toBe("CHILD");
      expect(res.body.reciprocal.fromPersonId).toBe(other.id);
      expect(res.body.reciprocal.toPersonId).toBe(admin.id);
    });

    it("creates no reciprocal for CAREGIVER", async () => {
      const { admin, other, familyGroup } = await seedFamilyWithTwoMembers();
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/relationships`)
        .set("Authorization", "Bearer mock")
        .send({
          fromPersonId: admin.id,
          toPersonId: other.id,
          type: "CAREGIVER"
        });
      expect(res.status).toBe(201);
      expect(res.body.reciprocal).toBeNull();
    });

    it("returns 400 when a person is not a family member", async () => {
      const admin = await seedTestPerson();
      const outsider = await seedGuestPerson({ firstName: "Out" });
      const { familyGroup } = await seedTestFamily(admin.id);
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/relationships`)
        .set("Authorization", "Bearer mock")
        .send({
          fromPersonId: admin.id,
          toPersonId: outsider.id,
          type: "SIBLING"
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/family members/i);
    });

    it("returns 409 on duplicate relationship", async () => {
      const { admin, other, familyGroup } = await seedFamilyWithTwoMembers();
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const first = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/relationships`)
        .set("Authorization", "Bearer mock")
        .send({
          fromPersonId: admin.id,
          toPersonId: other.id,
          type: "FAMILY_FRIEND"
        });
      expect(first.status).toBe(201);
      const second = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/relationships`)
        .set("Authorization", "Bearer mock")
        .send({
          fromPersonId: admin.id,
          toPersonId: other.id,
          type: "FAMILY_FRIEND"
        });
      expect(second.status).toBe(409);
      expect(second.body.error).toMatch(/already exists/i);
    });
  });

  describe("GET /api/v1/families/:familyId/relationships", () => {
    it("returns relationships with fromPerson and toPerson", async () => {
      const { admin, other, familyGroup } = await seedFamilyWithTwoMembers();
      await db.relationship.create({
        data: {
          fromPersonId: admin.id,
          toPersonId: other.id,
          type: "PARENT",
          familyGroupId: familyGroup.id
        }
      });
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/families/${familyGroup.id}/relationships`)
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].fromPerson.id).toBe(admin.id);
      expect(res.body[0].toPerson.id).toBe(other.id);
      expect(res.body[0].toPerson.ageGateLevel).toBeDefined();
    });
  });

  describe("GET /api/v1/persons/:personId/relationships", () => {
    it("returns 403 when requester shares no family with personId", async () => {
      const admin = await seedTestPerson();
      await seedSecondPerson();
      await seedTestFamily(admin.id);
      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/persons/${admin.id}/relationships`)
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(403);
    });

    it("returns outgoing edges with relatedPerson for a co-member", async () => {
      const { admin, other, familyGroup } = await seedFamilyWithTwoMembers();
      await db.relationship.create({
        data: {
          fromPersonId: admin.id,
          toPersonId: other.id,
          type: "PARENT",
          familyGroupId: familyGroup.id
        }
      });
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/persons/${admin.id}/relationships`)
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].relatedPerson.displayName).toBeDefined();
      expect(res.body[0].relatedPerson.ageGateLevel).toBe("NONE");
    });
  });

  describe("DELETE /api/v1/relationships/:relationshipId", () => {
    it("removes both primary and reciprocal", async () => {
      const { admin, other, familyGroup } = await seedFamilyWithTwoMembers();
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const created = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/relationships`)
        .set("Authorization", "Bearer mock")
        .send({
          fromPersonId: admin.id,
          toPersonId: other.id,
          type: "SPOUSE"
        });
      expect(created.status).toBe(201);
      const primaryId = created.body.relationship.id as string;
      const reciprocalId = created.body.reciprocal.id as string;

      const del = await request(app)
        .delete(`/api/v1/relationships/${primaryId}`)
        .set("Authorization", "Bearer mock");
      expect(del.status).toBe(204);

      const remaining = await db.relationship.findMany({
        where: { familyGroupId: familyGroup.id }
      });
      expect(remaining).toHaveLength(0);

      const gone = await db.relationship.findUnique({ where: { id: reciprocalId } });
      expect(gone).toBeNull();
    });
  });
});
