/**
 * suspendedAt enforcement (P3-00): a member suspended by downgrade
 * enforcement loses access everywhere membership is the gate.
 */
import { getAuth } from "@clerk/express";
import request from "supertest";
import { db } from "@famlink/db";
import { createApp } from "../../server";
import { TEST_CLERK_ID, TEST_USER_2_CLERK_ID } from "../helpers/auth";
import { seedSecondPerson, seedTestEvent, seedTestFamily, seedTestPerson } from "../helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

describe("suspendedAt enforcement", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => mockGetAuth.mockReset());

  it("denies a suspended member event detail, calendar, and AI chat", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const member = await seedSecondPerson();
    await db.familyMember.create({
      data: {
        familyGroupId: familyGroup.id,
        personId: member.id,
        roles: ["MEMBER"],
        permissions: [],
        suspendedAt: new Date()
      }
    });
    const event = await seedTestEvent(familyGroup.id, admin.id);

    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });

    const detail = await request(app)
      .get(`/api/v1/events/${event.id}`)
      .set("Authorization", "Bearer mock");
    expect(detail.status).toBe(403);

    const cal = await request(app)
      .get(`/api/v1/families/${familyGroup.id}/calendar/upcoming`)
      .set("Authorization", "Bearer mock");
    expect(cal.status).toBe(403);

    const chat = await request(app)
      .post("/api/v1/ai/chat")
      .set("Authorization", "Bearer mock")
      .send({ messages: [{ role: "user", content: "hi" }], familyGroupId: familyGroup.id });
    expect(chat.status).toBe(403);
  });

  it("an active member retains access", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const detail = await request(app)
      .get(`/api/v1/events/${event.id}`)
      .set("Authorization", "Bearer mock");
    expect(detail.status).toBe(200);
  });
});
