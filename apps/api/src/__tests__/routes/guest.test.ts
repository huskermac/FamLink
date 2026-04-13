import { db } from "@famlink/db";
import { RSVPStatus } from "@famlink/shared";
import request from "supertest";
import { generateGuestToken } from "../../lib/guestToken";
import { createApp } from "../../server";
import {
  seedGuestPerson,
  seedTestEvent,
  seedTestFamily,
  seedTestPerson
} from "../helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
  getAuth: vi.fn(() => ({ userId: null }))
}));

describe("guest routes", () => {
  const app = createApp();

  it("GET /api/v1/guest/event returns 401 without token", async () => {
    const res = await request(app).get("/api/v1/guest/event");
    expect(res.status).toBe(401);
  });

  it("GET /api/v1/guest/event returns 400 for FAMILY resource type", async () => {
    const token = generateGuestToken(
      {
        personId: "x",
        scope: "VIEW",
        resourceId: "fam",
        resourceType: "FAMILY"
      },
      "1h"
    );
    const res = await request(app).get("/api/v1/guest/event").query({ token });
    expect(res.status).toBe(400);
  });

  it("GET /api/v1/guest/event returns 404 when event id does not exist", async () => {
    const token = generateGuestToken(
      {
        personId: "person_nonexistent",
        scope: "VIEW",
        resourceId: "event_nonexistent",
        resourceType: "EVENT"
      },
      "1h"
    );
    const res = await request(app).get("/api/v1/guest/event").query({ token });
    expect(res.status).toBe(404);
  });

  it("GET /api/v1/guest/event returns 403 without family membership or RSVP", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    const guest = await seedGuestPerson();
    const token = generateGuestToken(
      {
        personId: guest.id,
        scope: "VIEW",
        resourceId: event.id,
        resourceType: "EVENT"
      },
      "1h"
    );
    const res = await request(app).get("/api/v1/guest/event").query({ token });
    expect(res.status).toBe(403);
  });

  it("GET /api/v1/guest/event returns 200 when person is a family member", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    const guest = await seedGuestPerson();
    await db.familyMember.create({
      data: {
        familyGroupId: familyGroup.id,
        personId: guest.id,
        roles: ["MEMBER"],
        permissions: []
      }
    });
    const token = generateGuestToken(
      {
        personId: guest.id,
        scope: "VIEW",
        resourceId: event.id,
        resourceType: "EVENT"
      },
      "1h"
    );
    const res = await request(app).get("/api/v1/guest/event").query({ token });
    expect(res.status).toBe(200);
    expect(res.body.event.id).toBe(event.id);
    expect(res.body.myRsvp).toBeNull();
  });

  it("GET /api/v1/guest/event includes RSVP list when RSVPs exist", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    const guest = await seedGuestPerson();
    await db.rSVP.create({
      data: {
        eventId: event.id,
        personId: guest.id,
        status: RSVPStatus.PENDING
      }
    });
    const token = generateGuestToken(
      {
        personId: guest.id,
        scope: "RSVP",
        resourceId: event.id,
        resourceType: "EVENT"
      },
      "1h"
    );
    const res = await request(app).get("/api/v1/guest/event").query({ token });
    expect(res.status).toBe(200);
    expect(res.body.attendees.some((a: { displayName: string }) => /Guest/i.test(a.displayName))).toBe(
      true
    );
  });

  it("POST /api/v1/guest/rsvp returns 403 for VIEW scope", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    const guest = await seedGuestPerson();
    await db.rSVP.create({
      data: {
        eventId: event.id,
        personId: guest.id,
        status: RSVPStatus.PENDING
      }
    });
    const token = generateGuestToken(
      {
        personId: guest.id,
        scope: "VIEW",
        resourceId: event.id,
        resourceType: "EVENT"
      },
      "1h"
    );
    const res = await request(app)
      .post("/api/v1/guest/rsvp")
      .set("Authorization", `Bearer ${token}`)
      .send({ status: RSVPStatus.YES });
    expect(res.status).toBe(403);
  });

  it("POST /api/v1/guest/rsvp upserts RSVP for RSVP scope", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    const guest = await seedGuestPerson();
    await db.rSVP.create({
      data: {
        eventId: event.id,
        personId: guest.id,
        status: RSVPStatus.PENDING
      }
    });
    const token = generateGuestToken(
      {
        personId: guest.id,
        scope: "RSVP",
        resourceId: event.id,
        resourceType: "EVENT"
      },
      "1h"
    );
    const res = await request(app)
      .post("/api/v1/guest/rsvp")
      .set("Authorization", `Bearer ${token}`)
      .send({ status: RSVPStatus.YES });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const row = await db.rSVP.findUnique({
      where: {
        eventId_personId: { eventId: event.id, personId: guest.id }
      }
    });
    expect(row?.status).toBe(RSVPStatus.YES);
    expect(row?.guestToken).toBe(token);
  });

  it("POST /api/v1/guest/rsvp returns 400 for invalid status", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    const guest = await seedGuestPerson();
    await db.rSVP.create({
      data: {
        eventId: event.id,
        personId: guest.id,
        status: RSVPStatus.PENDING
      }
    });
    const token = generateGuestToken(
      {
        personId: guest.id,
        scope: "RSVP",
        resourceId: event.id,
        resourceType: "EVENT"
      },
      "1h"
    );
    const res = await request(app)
      .post("/api/v1/guest/rsvp")
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "NOT_A_STATUS" });
    expect(res.status).toBe(400);
  });
});
