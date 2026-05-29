import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { seedTestEvent, seedTestFamily, seedTestPerson } from "../helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
  getAuth: vi.fn(() => ({ userId: null }))
}));

describe("Guest invitation token endpoints", () => {
  const app = createApp();

  it("GET /api/v1/guest/invitation/:token returns event info", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "BBQ" });
    const token = "test-token-abc123";
    await db.eventInvitation.create({
      data: {
        eventId: event.id,
        guestEmail: "mia@example.com",
        guestName: "Mia",
        guestToken: token,
        status: "PENDING"
      }
    });

    const res = await request(app).get(`/api/v1/guest/invitation/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.event.title).toBe("BBQ");
    expect(res.body.guestName).toBe("Mia");
    expect(res.body.currentStatus).toBe("PENDING");
  });

  it("POST /api/v1/guest/invitation/:token/rsvp updates invitation status", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    const token = "test-token-xyz789";
    await db.eventInvitation.create({
      data: {
        eventId: event.id,
        guestEmail: "mia@example.com",
        guestName: "Mia",
        guestToken: token,
        status: "PENDING"
      }
    });

    const res = await request(app)
      .post(`/api/v1/guest/invitation/${token}/rsvp`)
      .send({ status: "ACCEPTED" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ACCEPTED");

    const inv = await db.eventInvitation.findFirst({ where: { guestToken: token } });
    expect(inv!.status).toBe("ACCEPTED");
  });

  it("POST /rsvp accepts TENTATIVE status", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    const token = "test-token-tentative1";
    await db.eventInvitation.create({
      data: { eventId: event.id, guestEmail: "alex@example.com", guestToken: token, status: "PENDING" }
    });

    const res = await request(app)
      .post(`/api/v1/guest/invitation/${token}/rsvp`)
      .send({ status: "TENTATIVE" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("TENTATIVE");

    const inv = await db.eventInvitation.findFirst({ where: { guestToken: token } });
    expect(inv!.status).toBe("TENTATIVE");
  });

  it("POST /rsvp returns 400 when event has already ended", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const pastStart = new Date(Date.now() - 7200000); // 2 hours ago
    const event = await seedTestEvent(familyGroup.id, admin.id, { startAt: pastStart });
    // Set endAt in the past too
    await db.event.update({ where: { id: event.id }, data: { endAt: new Date(Date.now() - 3600000) } });
    const token = "test-token-past-event1";
    await db.eventInvitation.create({
      data: { eventId: event.id, guestEmail: "bob@example.com", guestToken: token, status: "PENDING" }
    });

    const res = await request(app)
      .post(`/api/v1/guest/invitation/${token}/rsvp`)
      .send({ status: "ACCEPTED" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ended/i);
  });

  it("GET returns 404 for unknown token", async () => {
    const res = await request(app).get("/api/v1/guest/invitation/not-a-real-token");
    expect(res.status).toBe(404);
  });
});
