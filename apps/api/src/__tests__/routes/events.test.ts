import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import { RSVPStatus } from "@famlink/shared";
import request from "supertest";
import { createApp } from "../../server";
import { TEST_CLERK_ID, TEST_USER_2_CLERK_ID } from "../helpers/auth";
import {
  seedGuestPerson,
  seedSecondPerson,
  seedTestEvent,
  seedTestFamily,
  seedTestPerson
} from "../helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
  getAuth: vi.fn()
}));

// ── Mock Socket.io emit helpers ───────────────────────────────────────────────

const mockEmitEventCreated = vi.fn();
const mockEmitRsvpUpdated = vi.fn();

vi.mock("../../lib/socketServer", () => ({
  emitEventCreated: (...args: unknown[]) => mockEmitEventCreated(...args),
  emitRsvpUpdated: (...args: unknown[]) => mockEmitRsvpUpdated(...args),
  getIo: vi.fn().mockReturnValue({
    to: vi.fn().mockReturnValue({ emit: vi.fn() })
  })
}));

function tomorrowIso(): string {
  return new Date(Date.now() + 86400000).toISOString();
}

describe("events routes (P1-08)", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => {
    mockGetAuth.mockReset();
    mockEmitEventCreated.mockClear();
    mockEmitRsvpUpdated.mockClear();
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
      expect(Array.isArray(getEv.body.eventItems)).toBe(true);

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

    it("POST invitations creates invitation for a family member by personId", async () => {
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
          visibility: "FAMILY",
          eventVisibility: "OPEN"
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const inv = await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({ invitees: [{ kind: "person", personId: noAccount.id }] });
      expect(inv.status).toBe(201);
      expect(Array.isArray(inv.body.invitations)).toBe(true);
      expect(inv.body.invitations).toHaveLength(1);

      const invitation = await db.eventInvitation.findFirst({
        where: { eventId: event.id, personId: noAccount.id }
      });
      expect(invitation).not.toBeNull();
      expect(invitation?.status).toBe("PENDING");
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

      await db.eventItem.create({
        data: {
          eventId: event.id,
          createdByPersonId: admin.id,
          name: "Old",
          quantity: "1"
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/potluck`)
        .set("Authorization", "Bearer mock")
        .send([
          { name: "Salad", quantity: "2", notes: "greens" },
          { name: "Bread", assignedToPersonId: null }
        ]);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((x: { name: string }) => x.name).sort()).toEqual(["Bread", "Salad"]);

      const rows = await db.eventItem.findMany({ where: { eventId: event.id } });
      expect(rows).toHaveLength(2);
    });
  });

  // ── POST /invitations v2 (P2-12) ────────────────────────────────────────

  describe("POST /api/v1/events/:eventId/invitations", () => {
    it("invites a known family member by personId", async () => {
      const admin = await seedTestPerson();
      const member = await seedGuestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
      });
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Party" });
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({ invitees: [{ kind: "person", personId: member.id }] });

      expect(res.status).toBe(201);
      expect(Array.isArray(res.body.invitations)).toBe(true);
      expect(res.body.invitations).toHaveLength(1);
      const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id, personId: member.id } });
      expect(inv).not.toBeNull();
    });

    it("creates external guest invitation with guestToken", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id);
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "OPEN" } });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({ invitees: [{ kind: "guest", guestEmail: "mia@example.com", guestName: "Mia Torres" }] });

      expect(res.status).toBe(201);
      expect(Array.isArray(res.body.invitations)).toBe(true);
      expect(res.body.invitations).toHaveLength(1);
      const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id, guestEmail: "mia@example.com" } });
      expect(inv).not.toBeNull();
      expect(inv!.guestToken).not.toBeNull();
    });

    it("cross-family match: links to existing FamLink user by email", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id);
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "OPEN" } });

      const otherPerson = await seedGuestPerson({ firstName: "Carol" });
      await db.person.update({ where: { id: otherPerson.id }, data: { email: "carol@example.com" } });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({ invitees: [{ kind: "guest", guestEmail: "carol@example.com", guestName: "Carol" }] });

      expect(res.status).toBe(201);
      const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id } });
      expect(inv!.linkedPersonId).toBe(otherPerson.id);
    });

    it("returns 400 for BROADCAST event", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id);
      // Default eventVisibility is BROADCAST

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({ invitees: [{ kind: "person", personId: "fake-id" }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/broadcast/i);
    });

    it("allows family admin (not organizer) to invite to PRIVATE event", async () => {
      const organizer = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(organizer.id);
      const secondAdmin = await seedSecondPerson();
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: secondAdmin.id, roles: ["ADMIN"], permissions: [] }
      });
      const invitee = await seedGuestPerson({ firstName: "Invitee" });
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: invitee.id, roles: ["MEMBER"], permissions: [] }
      });
      const event = await seedTestEvent(familyGroup.id, organizer.id, { title: "Admin Invite Test" });
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({ invitees: [{ kind: "person", personId: invitee.id }] });

      expect(res.status).toBe(201);
      expect(Array.isArray(res.body.invitations)).toBe(true);
      expect(res.body.invitations).toHaveLength(1);
    });

    it("returns 403 when non-admin non-organizer tries to invite to a PRIVATE event", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const nonAdmin = await seedSecondPerson();
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: nonAdmin.id, roles: ["MEMBER"], permissions: [] }
      });
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Private Party" });
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({ invitees: [{ kind: "person", personId: admin.id }] });

      expect(res.status).toBe(403);
    });

    it("skips duplicate invitation (idempotent) and returns 201 with count 0", async () => {
      const admin = await seedTestPerson();
      const member = await seedGuestPerson({ firstName: "Dup" });
      const { familyGroup } = await seedTestFamily(admin.id);
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
      });
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Dup Test" });
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "OPEN" } });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({ invitees: [{ kind: "person", personId: member.id }] });

      const res2 = await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({ invitees: [{ kind: "person", personId: member.id }] });

      expect(res2.status).toBe(201);
      expect(res2.body.invitations).toHaveLength(0);

      const count = await db.eventInvitation.count({ where: { eventId: event.id, personId: member.id } });
      expect(count).toBe(1);
    });
  });

  // ── GET /invitations + invitee-suggestions (P2-12 Task 3) ───────────────

  describe("GET /api/v1/events/:eventId/invitations", () => {
    it("returns invitations for a family member", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Test" });
      await db.eventInvitation.create({
        data: { eventId: event.id, guestEmail: "bob@example.com", guestName: "Bob", status: "PENDING", guestToken: "tok1" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.invitations)).toBe(true);
      expect(res.body.invitations).toHaveLength(1);
      expect(res.body.invitations[0].guestEmail).toBe("bob@example.com");
      expect(res.body.invitations[0].displayName).toBe("Bob");
    });

    it("returns 400 for non-member with no person record", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id);

      // clerk_no_person has no person record in the DB
      mockGetAuth.mockReturnValue({ userId: "clerk_no_person" });
      const res = await request(app)
        .get(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(400); // no person record for clerk_no_person
    });

    it("returns 403 for person who is not a member of the family", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id);
      // outsider has a person record but is not in this family
      await seedSecondPerson();

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/v1/events/:eventId/invitee-suggestions", () => {
    it("returns suggestions list (may be empty for new event)", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/events/${event.id}/invitee-suggestions`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.suggestions)).toBe(true);
    });
  });

  // ── Socket.io emit integration (P2-04) ──────────────────────────────────

  describe("Socket.io emit calls (P2-04)", () => {
    it("POST /api/v1/families/:familyId/events calls emitEventCreated on success", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/events`)
        .set("Authorization", "Bearer mock")
        .send({ title: "Socket Test Event", startAt: tomorrowIso() });

      expect(res.status).toBe(201);
      expect(mockEmitEventCreated).toHaveBeenCalledTimes(1);
      expect(mockEmitEventCreated).toHaveBeenCalledWith(
        expect.anything(), // io instance
        familyGroup.id,
        expect.objectContaining({
          id: res.body.id,
          title: "Socket Test Event"
        })
      );
    });

    it("PUT /api/v1/events/:eventId/rsvp calls emitRsvpUpdated on success", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const startAt = new Date(Date.now() + 86400000);
      const event = await db.event.create({
        data: {
          familyGroupId: familyGroup.id,
          createdByPersonId: admin.id,
          title: "RSVP Emit Test",
          startAt,
          visibility: "FAMILY"
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/events/${event.id}/rsvp`)
        .set("Authorization", "Bearer mock")
        .send({ status: RSVPStatus.YES });

      expect(res.status).toBe(200);
      expect(mockEmitRsvpUpdated).toHaveBeenCalledTimes(1);
      expect(mockEmitRsvpUpdated).toHaveBeenCalledWith(
        expect.anything(), // io instance
        expect.any(String), // organizerUserId (Clerk userId)
        expect.objectContaining({
          eventId: event.id,
          eventTitle: "RSVP Emit Test",
          status: RSVPStatus.YES
        })
      );
    });
  });
});
