import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { TEST_CLERK_ID, TEST_USER_2_CLERK_ID } from "../helpers/auth";
import { seedTestFamily, seedTestPerson } from "../helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
  getAuth: vi.fn()
}));

describe("POST /api/v1/persons — createdByFamilyGroupId provenance", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => {
    mockGetAuth.mockReset();
  });

  it("stamps createdByFamilyGroupId on a passive person when the requester is an active member", async () => {
    const member = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(member.id);

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/persons")
      .set("Authorization", "Bearer mock")
      .send({ firstName: "Kid", lastName: "Doe", familyGroupId: familyGroup.id });

    expect(res.status).toBe(201);
    const row = await db.person.findUnique({ where: { id: res.body.id } });
    expect(row!.createdByFamilyGroupId).toBe(familyGroup.id);
    expect(row!.userId).toBeNull();
  });

  it("rejects familyGroupId when the requester is not an active member of that family", async () => {
    const admin = await seedTestPerson();
    const { familyGroup: foreignFamily } = await seedTestFamily(admin.id);

    // outsider has their own Person record but no membership in foreignFamily
    await db.person.create({
      data: {
        firstName: "Out",
        lastName: "Sider",
        ageGateLevel: "ADULT",
        userId: TEST_USER_2_CLERK_ID
      }
    });

    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/persons")
      .set("Authorization", "Bearer mock")
      .send({ firstName: "X", lastName: "Y", familyGroupId: foreignFamily.id });

    expect(res.status).toBe(403);
  });

  it("does not stamp createdByFamilyGroupId on an account create (first Person for a Clerk user)", async () => {
    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const res = await request(app)
      .post("/api/v1/persons")
      .set("Authorization", "Bearer mock")
      .send({ firstName: "New", lastName: "Organizer" });

    expect(res.status).toBe(201);
    const row = await db.person.findUnique({ where: { id: res.body.id } });
    expect(row!.createdByFamilyGroupId).toBeNull();
    expect(row!.userId).toBe(TEST_USER_2_CLERK_ID);
  });
});
