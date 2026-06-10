/**
 * Event visibility enforcement (P3-00 M2, decision 2026-06-10):
 * PRIVATE events are FULLY hidden from non-invited family members —
 * excluded from calendar lists, and the detail endpoint answers 404
 * (existence is never revealed). Invited members, creators, and admins
 * see them normally.
 */
import { getAuth } from "@clerk/express";
import request from "supertest";
import { db } from "@famlink/db";
import { createApp } from "../../server";
import { TEST_CLERK_ID, TEST_USER_2_CLERK_ID } from "../helpers/auth";
import { seedSecondPerson, seedTestFamily, seedTestPerson } from "../helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

async function seedPrivateEvent(familyGroupId: string, createdByPersonId: string) {
  return db.event.create({
    data: {
      familyGroupId,
      createdByPersonId,
      title: "Secret Planning",
      startAt: new Date(Date.now() + 86_400_000),
      eventVisibility: "PRIVATE"
    }
  });
}

/** Seeds: creator-admin (TEST_CLERK_ID owns family) + plain member (TEST_USER_2). */
async function seedFamilyWithMember() {
  const creator = await seedTestPerson();
  const { familyGroup } = await seedTestFamily(creator.id);
  const member = await seedSecondPerson();
  await db.familyMember.create({
    data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
  });
  return { creator, member, familyGroup };
}

describe("PRIVATE event visibility", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => mockGetAuth.mockReset());

  it("detail endpoint returns 404 (not 403) for a non-invited member", async () => {
    const { creator, familyGroup } = await seedFamilyWithMember();
    const event = await seedPrivateEvent(familyGroup.id, creator.id);

    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const res = await request(app)
      .get(`/api/v1/events/${event.id}`)
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(404);
  });

  it("non-invited member cannot RSVP to a private event", async () => {
    const { creator, familyGroup } = await seedFamilyWithMember();
    const event = await seedPrivateEvent(familyGroup.id, creator.id);

    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const res = await request(app)
      .put(`/api/v1/events/${event.id}/rsvp`)
      .set("Authorization", "Bearer mock")
      .send({ status: "YES" });
    expect(res.status).toBe(404);
  });

  it("calendar upcoming excludes private events for non-invited members but includes them for the creator", async () => {
    const { creator, familyGroup } = await seedFamilyWithMember();
    await seedPrivateEvent(familyGroup.id, creator.id);

    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const memberView = await request(app)
      .get(`/api/v1/families/${familyGroup.id}/calendar/upcoming`)
      .set("Authorization", "Bearer mock");
    expect(memberView.status).toBe(200);
    expect(
      memberView.body.events.filter((e: { title: string }) => e.title === "Secret Planning")
    ).toHaveLength(0);

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const creatorView = await request(app)
      .get(`/api/v1/families/${familyGroup.id}/calendar/upcoming`)
      .set("Authorization", "Bearer mock");
    expect(creatorView.status).toBe(200);
    expect(
      creatorView.body.events.filter((e: { title: string }) => e.title === "Secret Planning")
    ).toHaveLength(1);
  });

  it("an invited member sees the private event (detail + calendar)", async () => {
    const { creator, member, familyGroup } = await seedFamilyWithMember();
    const event = await seedPrivateEvent(familyGroup.id, creator.id);
    await db.eventInvitation.create({
      data: { eventId: event.id, personId: member.id, scope: "INDIVIDUAL", status: "PENDING" }
    });

    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const detail = await request(app)
      .get(`/api/v1/events/${event.id}`)
      .set("Authorization", "Bearer mock");
    expect(detail.status).toBe(200);

    const cal = await request(app)
      .get(`/api/v1/families/${familyGroup.id}/calendar/upcoming`)
      .set("Authorization", "Bearer mock");
    expect(
      cal.body.events.filter((e: { title: string }) => e.title === "Secret Planning")
    ).toHaveLength(1);
  });

  it("BROADCAST and OPEN events remain visible to all members", async () => {
    const { creator, familyGroup } = await seedFamilyWithMember();
    await db.event.create({
      data: {
        familyGroupId: familyGroup.id,
        createdByPersonId: creator.id,
        title: "Family Dinner",
        startAt: new Date(Date.now() + 86_400_000),
        eventVisibility: "OPEN"
      }
    });

    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const cal = await request(app)
      .get(`/api/v1/families/${familyGroup.id}/calendar/upcoming`)
      .set("Authorization", "Bearer mock");
    expect(
      cal.body.events.filter((e: { title: string }) => e.title === "Family Dinner")
    ).toHaveLength(1);
  });
});
