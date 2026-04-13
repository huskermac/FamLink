import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import { InviteScope, RSVPStatus } from "@famlink/shared";
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

function tomorrowIso(): string {
  return new Date(Date.now() + 86400000).toISOString();
}

describe("events routes (P1-08)", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => {
    mockGetAuth.mockReset();
  });

  describe("POST /api/v1/families/:familyId/events", () => {
    it("returns 403 when requester cannot create events", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const member = await seedSecondPerson();
      await db.familyMember.create({
        data: {
          familyGroupId: familyGroup.id,
          personId: member.id,
          roles: ["MEMBER"],
          permissions: []
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/events`)
        .set("Authorization", "Bearer mock")
        .send({
          title: "Nope",
          startAt: tomorrowIso()
        });
      expect(res.status).toBe(403);
    });

    it("creates an event when requester has CREATE_EVENTS (admin)", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/events`)
        .set("Authorization", "Bearer mock")
        .send({
          title: "Picnic",
          startAt: tomorrowIso(),
          visibility: "FAMILY"
        });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe("Picnic");
      expect(res.body.createdByPersonId).toBe(admin.id);
      expect(res.body.familyGroupId).toBe(familyGroup.id);
    });
  });

  describe("GET /api/v1/events/:eventId and RSVPs", () => {
    it("returns RSVP counts and potluck; GET rsvps omits raw tokens", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const guest = await seedGuestPerson();
      await db.familyMember.create({
        data: {
          familyGroupId: familyGroup.id,
          personId: guest.id,
          roles: ["MEMBER"],
          permissions: []
        }
      });

      const startAt = new Date(Date.now() + 86400000);
      const event = await db.event.create({
        data: {
          familyGroupId: familyGroup.id,
          createdByPersonId: admin.id,
          title: "Dinner",
          startAt,
          visibility: "FAMILY"
        }
      });

      await db.rSVP.create({
        data: {
          eventId: event.id,
          personId: admin.id,
          status: RSVPStatus.YES,
          guestToken: "secret-token-should-not-appear-in-list"
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const getEv = await request(app)
        .get(`/api/v1/events/${event.id}`)
        .set("Authorization", "Bearer mock");
      expect(getEv.status).toBe(200);
      expect(getEv.body.event.id).toBe(event.id);
      expect(getEv.body.invitations).toBe(0);
      expect(getEv.body.rsvps.YES).toBe(1);
      expect(getEv.body.rsvps.PENDING).toBe(0);
      expect(Array.isArray(getEv.body.potluckAssignments)).toBe(true);

      const list = await request(app)
        .get(`/api/v1/events/${event.id}/rsvps`)
        .set("Authorization", "Bearer mock");
      expect(list.status).toBe(200);
      const yesList = list.body.rsvps.YES as Array<{
        firstName: string;
        lastName: string;
        hasGuestToken: boolean;
      }>;
      expect(yesList.length).toBe(1);
      expect(yesList[0].hasGuestToken).toBe(true);
      expect(JSON.stringify(list.body)).not.toContain("secret-token");
    });

    it("POST invitations generates guestToken for userId-null persons", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const noAccount = await seedGuestPerson({ firstName: "NoAcct" });
      await db.familyMember.create({
        data: {
          familyGroupId: familyGroup.id,
          personId: noAccount.id,
          roles: ["MEMBER"],
          permissions: []
        }
      });

      const startAt = new Date(Date.now() + 86400000);
      const event = await db.event.create({
        data: {
          familyGroupId: familyGroup.id,
          createdByPersonId: admin.id,
          title: "Party",
          startAt,
          visibility: "FAMILY"
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const inv = await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({
          scope: InviteScope.INDIVIDUAL,
          personIds: [noAccount.id]
        });
      expect(inv.status).toBe(201);
      expect(inv.body.invited).toBe(1);
      expect(inv.body.guestTokensGenerated).toBe(1);

      const rsvp = await db.rSVP.findUnique({
        where: { eventId_personId: { eventId: event.id, personId: noAccount.id } }
      });
      expect(rsvp?.status).toBe(RSVPStatus.PENDING);
      expect(rsvp?.guestToken).toBeTruthy();
    });

    it("PUT /api/v1/events/:eventId/rsvp upserts for authenticated member", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const startAt = new Date(Date.now() + 86400000);
      const event = await db.event.create({
        data: {
          familyGroupId: familyGroup.id,
          createdByPersonId: admin.id,
          title: "Meet",
          startAt,
          visibility: "FAMILY"
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const r1 = await request(app)
        .put(`/api/v1/events/${event.id}/rsvp`)
        .set("Authorization", "Bearer mock")
        .send({ status: RSVPStatus.YES });
      expect(r1.status).toBe(200);
      expect(r1.body.status).toBe(RSVPStatus.YES);

      const r2 = await request(app)
        .put(`/api/v1/events/${event.id}/rsvp`)
        .set("Authorization", "Bearer mock")
        .send({ status: RSVPStatus.MAYBE });
      expect(r2.status).toBe(200);
      expect(r2.body.status).toBe(RSVPStatus.MAYBE);
    });
  });

  describe("POST /api/v1/events/:eventId/potluck", () => {
    it("replaces potluck assignments atomically", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const startAt = new Date(Date.now() + 86400000);
      const event = await db.event.create({
        data: {
          familyGroupId: familyGroup.id,
          createdByPersonId: admin.id,
          title: "Potluck",
          startAt,
          visibility: "FAMILY"
        }
      });

      await db.potluckAssignment.create({
        data: {
          eventId: event.id,
          item: "Old",
          quantity: 1
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/potluck`)
        .set("Authorization", "Bearer mock")
        .send([
          { item: "Salad", quantity: 2, notes: "greens" },
          { item: "Bread", personId: null }
        ]);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((x: { item: string }) => x.item).sort()).toEqual(["Bread", "Salad"]);

      const rows = await db.potluckAssignment.findMany({ where: { eventId: event.id } });
      expect(rows).toHaveLength(2);
    });
  });
});
