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
import { activeEventParticipant } from "../../lib/eventAccess";
import { NotificationService } from "../../lib/notificationService";

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
      // serialized events must include the typed fields the web client requires
      expect(res.body.eventType).toBe("OTHER");
      expect(res.body.eventVisibility).toBe("BROADCAST");
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

    it("an active cross-family participant can RSVP", async () => {
      // arrange: admin owns the event; participant is a second person with an ACTIVE grant but NOT an owning member
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const participant = await seedSecondPerson();
      const startAt = new Date(Date.now() + 86400000);
      const event = await db.event.create({
        data: {
          familyGroupId: familyGroup.id,
          createdByPersonId: admin.id,
          title: "Cross-Family RSVP Event",
          startAt,
          visibility: "FAMILY"
        }
      });
      await db.eventParticipant.create({
        data: {
          eventId: event.id,
          personId: participant.id,
          role: "PARTICIPANT",
          status: "ACTIVE",
          invitedById: admin.id
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/events/${event.id}/rsvp`)
        .set("Authorization", "Bearer mock")
        .send({ status: RSVPStatus.YES });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(RSVPStatus.YES);
      expect(
        await db.rSVP.findUnique({
          where: { eventId_personId: { eventId: event.id, personId: participant.id } }
        })
      ).toMatchObject({ status: RSVPStatus.YES });
    });

    it("a non-participant non-member cannot RSVP (404 full-hide)", async () => {
      // arrange: admin owns the event; outsider has a Person record but no membership and no participant grant
      const admin = await seedTestPerson();
      await seedSecondPerson(); // creates Person for TEST_USER_2_CLERK_ID; no family membership
      const { familyGroup } = await seedTestFamily(admin.id);
      const startAt = new Date(Date.now() + 86400000);
      const event = await db.event.create({
        data: {
          familyGroupId: familyGroup.id,
          createdByPersonId: admin.id,
          title: "Hidden Event",
          startAt,
          visibility: "FAMILY"
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/events/${event.id}/rsvp`)
        .set("Authorization", "Bearer mock")
        .send({ status: RSVPStatus.YES });
      expect(res.status).toBe(404);
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
      await db.person.update({
        where: { id: otherPerson.id },
        data: { email: "carol@example.com", emailNormalized: "carol@example.com" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({ invitees: [{ kind: "guest", guestEmail: "carol@example.com", guestName: "Carol" }] });

      expect(res.status).toBe(201);
      const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id } });
      expect(inv!.linkedPersonId).toBe(otherPerson.id);
    });

    it("guest invite links to a person resolved by normalized contact", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id);
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "OPEN" } });

      const contactOnlyPerson = await seedGuestPerson({ firstName: "Casey" });
      await db.person.update({
        where: { id: contactOnlyPerson.id },
        data: { emailNormalized: "guest@x.com" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({ invitees: [{ kind: "guest", guestEmail: "GUEST@x.com", guestName: "G" }] });

      expect(res.status).toBe(201);
      const inv = await db.eventInvitation.findFirst({
        where: { eventId: event.id, guestEmail: "GUEST@x.com" }
      });
      expect(inv?.linkedPersonId).toBe(contactOnlyPerson.id);
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

    it("event-admin can invite a cross-family FamLink user (creates PENDING invite w/ linkedPersonId + role)", async () => {
      // arrange: requester is creator/owning-admin of a PRIVATE event; target is a person in another family
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Cross-Family Event" });
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

      // target person is in a different family (no membership in this family group)
      const targetPerson = await seedGuestPerson({ firstName: "CrossFamily" });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({ invitees: [{ kind: "famlinkUser", personId: targetPerson.id, role: "PARTICIPANT" }] });

      expect(res.status).toBe(201);
      const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id, linkedPersonId: targetPerson.id } });
      expect(inv?.role).toBe("PARTICIPANT");
      expect(inv?.guestToken).toBeTruthy();
    });

    it("a non-admin participant cannot invite cross-family users", async () => {
      // arrange: requester has no family membership (canAdmin false)
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Cross-Family Authz Test" });
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

      await seedSecondPerson();
      // the second person is NOT in this family — they have no membership
      const someoneId = (await seedGuestPerson({ firstName: "Target" })).id;

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({ invitees: [{ kind: "famlinkUser", personId: someoneId }] });

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

    it("returns 403 for PRIVATE event when requester is not organizer or admin", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id);
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });
      const member = await seedSecondPerson();
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
      });

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

  describe("PUT /api/v1/events/:eventId", () => {
    it("creator updates title, time, and eventType", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/events/${event.id}`)
        .set("Authorization", "Bearer mock")
        .send({ title: "Updated Title", eventType: "PARTY", locationName: "Park" });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Updated Title");
      expect(res.body.eventType).toBe("PARTY");
      expect(res.body.locationName).toBe("Park");
    });

    it("rejects endAt before startAt", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/events/${event.id}`)
        .set("Authorization", "Bearer mock")
        .send({ endAt: new Date(event.startAt.getTime() - 3_600_000).toISOString() });

      expect(res.status).toBe(400);
    });

    it("non-creator non-admin member gets 403", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id);
      const member = await seedSecondPerson();
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/events/${event.id}`)
        .set("Authorization", "Bearer mock")
        .send({ title: "Hijacked" });

      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/v1/events/:eventId", () => {
    it("creator deletes the event; subsequent GET is 404", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const del = await request(app)
        .delete(`/api/v1/events/${event.id}`)
        .set("Authorization", "Bearer mock");
      expect(del.status).toBe(204);

      const get = await request(app)
        .get(`/api/v1/events/${event.id}`)
        .set("Authorization", "Bearer mock");
      expect(get.status).toBe(404);
    });

    it("non-creator non-admin member gets 403", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id);
      const member = await seedSecondPerson();
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/events/${event.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/v1/events/birthday-{personId}-{year} (synthetic)", () => {
    it("returns the synthetic birthday event for a shared family member", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const member = await seedSecondPerson();
      await db.person.update({
        where: { id: member.id },
        data: { dateOfBirth: new Date("1990-06-15T00:00:00.000Z") }
      });
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/events/birthday-${member.id}-2030`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      expect(res.body.event.isBirthdayEvent).toBe(true);
      expect(res.body.event.birthdayPersonId).toBe(member.id);
      expect(res.body.event.title).toMatch(/birthday/i);
    });

    it("404 when the person has no date of birth", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const member = await seedSecondPerson();
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/events/birthday-${member.id}-2030`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(404);
    });

    it("403 when requester shares no family with the birthday person", async () => {
      const admin = await seedTestPerson();
      await seedTestFamily(admin.id);
      const stranger = await seedSecondPerson();
      await seedTestFamily(stranger.id); // stranger's own, separate family
      await db.person.update({
        where: { id: stranger.id },
        data: { dateOfBirth: new Date("1985-01-02T00:00:00.000Z") }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/events/birthday-${stranger.id}-2030`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(403);
    });
  });

  // ── POST participation/accept + decline (P3-03 Task 5) ─────────────────────

  describe("POST /api/v1/events/:eventId/participation/accept", () => {
    it("accept: authenticated invitee with matching token gets an ACTIVE grant", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Cross-Family Accept" });
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

      // PENDING invitation with linkedPersonId = admin (the requester)
      const token = "accept-test-token-abc123";
      await db.eventInvitation.create({
        data: {
          eventId: event.id,
          linkedPersonId: admin.id,
          role: "EVENT_ADMIN",
          guestToken: token,
          invitedById: admin.id,
          scope: "INDIVIDUAL",
          status: "PENDING"
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/participation/accept`)
        .set("Authorization", "Bearer mock")
        .send({ token });

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);

      const grant = await db.eventParticipant.findUnique({
        where: { eventId_personId: { eventId: event.id, personId: admin.id } }
      });
      expect(grant).toMatchObject({ status: "ACTIVE", role: "EVENT_ADMIN" });

      const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id, guestToken: token } });
      expect(inv?.status).toBe("ACCEPTED");
    });

    it("accept: token whose invitation.linkedPersonId != requester is rejected (no grant)", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Cross-Family Reject" });
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

      const outsider = await seedSecondPerson();
      const token = "accept-reject-test-token-xyz789";
      // invitation targets outsider, NOT the requester (admin)
      await db.eventInvitation.create({
        data: {
          eventId: event.id,
          linkedPersonId: outsider.id,
          role: "PARTICIPANT",
          guestToken: token,
          invitedById: admin.id,
          scope: "INDIVIDUAL",
          status: "PENDING"
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID }); // admin is the requester
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/participation/accept`)
        .set("Authorization", "Bearer mock")
        .send({ token });

      expect(res.status).toBe(403);
      expect(await db.eventParticipant.findFirst({ where: { eventId: event.id, personId: admin.id } })).toBeNull();
    });

    it("decline: marks the invitation DECLINED and creates no grant", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Cross-Family Decline" });
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

      const token = "decline-test-token-def456";
      await db.eventInvitation.create({
        data: {
          eventId: event.id,
          linkedPersonId: admin.id,
          role: "PARTICIPANT",
          guestToken: token,
          invitedById: admin.id,
          scope: "INDIVIDUAL",
          status: "PENDING"
        }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/participation/decline`)
        .set("Authorization", "Bearer mock")
        .send({ token });

      expect(res.status).toBe(200);
      expect(res.body.declined).toBe(true);
      expect(await db.eventParticipant.findFirst({ where: { eventId: event.id, personId: admin.id } })).toBeNull();

      const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id, guestToken: token } });
      expect(inv?.status).toBe("DECLINED");
    });
  });

  // ── POST participants/:personId/revoke + PUT participants/:personId/role (P3-03 Task 6) ──

  describe("POST /api/v1/events/:eventId/participants/:personId/revoke", () => {
    it("event-admin revoke sets status REVOKED and cuts access", async () => {
      // admin is event creator → canAdmin true
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Revoke Test" });
      // targetPerson has an ACTIVE grant (cross-family participant)
      const targetPerson = await seedGuestPerson({ firstName: "Target" });
      await db.eventParticipant.create({
        data: { eventId: event.id, personId: targetPerson.id, role: "PARTICIPANT", status: "ACTIVE" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/participants/${targetPerson.id}/revoke`)
        .set("Authorization", "Bearer mock")
        .send();

      expect(res.status).toBe(200);
      expect(await activeEventParticipant(targetPerson.id, event.id)).toBeNull();
    });

    it("a participant (non-admin) cannot revoke others", async () => {
      // nonAdmin person has an ACTIVE PARTICIPANT grant but is not event creator/family admin
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Revoke Authz Test" });

      const nonAdmin = await seedSecondPerson();
      // nonAdmin is a cross-family participant (PARTICIPANT role) — not a family member, not creator
      await db.eventParticipant.create({
        data: { eventId: event.id, personId: nonAdmin.id, role: "PARTICIPANT", status: "ACTIVE" }
      });
      const targetPerson = await seedGuestPerson({ firstName: "Target2" });
      await db.eventParticipant.create({
        data: { eventId: event.id, personId: targetPerson.id, role: "PARTICIPANT", status: "ACTIVE" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/participants/${targetPerson.id}/revoke`)
        .set("Authorization", "Bearer mock")
        .send();

      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/v1/events/:eventId/participants/:personId/role", () => {
    it("event-admin can promote a participant to EVENT_ADMIN", async () => {
      // admin is event creator → canAdmin true
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Role Test" });
      const targetPerson = await seedGuestPerson({ firstName: "Promote" });
      await db.eventParticipant.create({
        data: { eventId: event.id, personId: targetPerson.id, role: "PARTICIPANT", status: "ACTIVE" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/events/${event.id}/participants/${targetPerson.id}/role`)
        .set("Authorization", "Bearer mock")
        .send({ role: "EVENT_ADMIN" });

      expect(res.status).toBe(200);
      expect(await activeEventParticipant(targetPerson.id, event.id)).toEqual({ role: "EVENT_ADMIN" });
    });
  });

  // ── Per-item task contributions (P3-03 Task 8) ─────────────────────────

  describe("POST /api/v1/events/:eventId/items (per-item contribution)", () => {
    it("a participant can add a task item (own contribution)", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Task Item Test" });

      // participant: a second person with an ACTIVE cross-family grant (no owning membership)
      const participant = await seedSecondPerson();
      await db.eventParticipant.create({
        data: { eventId: event.id, personId: participant.id, role: "PARTICIPANT", status: "ACTIVE", invitedById: admin.id }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/items`)
        .set("Authorization", "Bearer mock")
        .send({ name: "Cups" });

      expect(res.status).toBe(201);
      // Response to a cross-family participant is the isolation-safe shape (no
      // internal person ids); attribution is verified via the DB row instead.
      expect(res.body.createdByPersonId).toBeUndefined();
      expect(res.body.name).toBe("Cups");
      const row = await db.eventItem.findUnique({ where: { id: res.body.id } });
      expect(row?.createdByPersonId).toBe(participant.id);
    });

    it("a non-participant non-member cannot add an item (404)", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Unauthorized Item" });
      await seedSecondPerson(); // creates Person for TEST_USER_2 but no membership, no grant

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/items`)
        .set("Authorization", "Bearer mock")
        .send({ name: "Cups" });

      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/v1/events/:eventId/items/:itemId (own-only edit)", () => {
    it("a participant cannot edit another person's item", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Edit Authz Test" });

      // item created by admin (the other person)
      const othersItem = await db.eventItem.create({
        data: { eventId: event.id, createdByPersonId: admin.id, name: "Admin's Item" }
      });

      // requester is a participant (cross-family), NOT the item's creator
      const participant = await seedSecondPerson();
      await db.eventParticipant.create({
        data: { eventId: event.id, personId: participant.id, role: "PARTICIPANT", status: "ACTIVE", invitedById: admin.id }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .patch(`/api/v1/events/${event.id}/items/${othersItem.id}`)
        .set("Authorization", "Bearer mock")
        .send({ name: "x" });

      expect(res.status).toBe(403);
    });

    it("an event-admin can edit anyone's item", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Admin Edit Test" });

      // item created by a different person
      const other = await seedSecondPerson();
      const othersItem = await db.eventItem.create({
        data: { eventId: event.id, createdByPersonId: other.id, name: "Other's Item" }
      });

      // requester is admin (TEST_CLERK_ID) — event creator → canAdmin true
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .patch(`/api/v1/events/${event.id}/items/${othersItem.id}`)
        .set("Authorization", "Bearer mock")
        .send({ name: "x" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("x");
    });

    it("a participant can edit their own item", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Own Item Edit" });

      const participant = await seedSecondPerson();
      await db.eventParticipant.create({
        data: { eventId: event.id, personId: participant.id, role: "PARTICIPANT", status: "ACTIVE", invitedById: admin.id }
      });

      // item created by the participant themselves
      const ownItem = await db.eventItem.create({
        data: { eventId: event.id, createdByPersonId: participant.id, name: "My Item" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .patch(`/api/v1/events/${event.id}/items/${ownItem.id}`)
        .set("Authorization", "Bearer mock")
        .send({ name: "My Updated Item" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("My Updated Item");
    });
  });

  describe("DELETE /api/v1/events/:eventId/items/:itemId (own-only delete)", () => {
    it("a participant cannot delete another person's item", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Delete Authz Test" });

      const othersItem = await db.eventItem.create({
        data: { eventId: event.id, createdByPersonId: admin.id, name: "Admin's Item" }
      });

      const participant = await seedSecondPerson();
      await db.eventParticipant.create({
        data: { eventId: event.id, personId: participant.id, role: "PARTICIPANT", status: "ACTIVE", invitedById: admin.id }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/events/${event.id}/items/${othersItem.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(403);
    });

    it("a participant can delete their own item", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Own Delete Test" });

      const participant = await seedSecondPerson();
      await db.eventParticipant.create({
        data: { eventId: event.id, personId: participant.id, role: "PARTICIPANT", status: "ACTIVE", invitedById: admin.id }
      });

      const ownItem = await db.eventItem.create({
        data: { eventId: event.id, createdByPersonId: participant.id, name: "To Delete" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/events/${event.id}/items/${ownItem.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(204);
      const deleted = await db.eventItem.findUnique({ where: { id: ownItem.id } });
      expect(deleted).toBeNull();
    });

    it("an event-admin can delete anyone's item", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Admin Delete Test" });

      const other = await seedSecondPerson();
      const othersItem = await db.eventItem.create({
        data: { eventId: event.id, createdByPersonId: other.id, name: "Other's Item" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/events/${event.id}/items/${othersItem.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(204);
    });
  });

  // ── Task 9: ForeignInvitedEventDTO — isolation-safe detail read ─────────

  describe("GET /api/v1/events/:eventId — cross-family DTO (Task 9)", () => {
    it("cross-family participant detail read omits family identifiers", async () => {
      // arrange: admin owns the event; participant is a second person with ACTIVE grant but NOT an owning member
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const participant = await seedSecondPerson();
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Cross-Family Detail Read" });
      await db.eventParticipant.create({
        data: {
          eventId: event.id,
          personId: participant.id,
          role: "PARTICIPANT",
          status: "ACTIVE",
          invitedById: admin.id
        }
      });
      // a NON-attending owning-family member (no RSVP, no grant) — must NOT
      // appear in the foreign participant list (C1: no roster leak)
      const bystander = await db.person.create({
        data: { firstName: "Bystander", lastName: "NoShow", ageGateLevel: "ADULT", userId: null }
      });
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: bystander.id, roles: [], permissions: [] }
      });
      // a task created by an owning-family member, assigned to one — its person
      // ids must NOT leak into the foreign DTO
      await db.eventItem.create({
        data: { eventId: event.id, createdByPersonId: admin.id, assignedToPersonId: admin.id, name: "Cups" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/events/${event.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      // DTO must NOT include internal family identifiers
      expect(res.body.familyGroupId).toBeUndefined();
      expect(res.body.createdByPersonId).toBeUndefined();
      // DTO must include the allowed fields
      expect(res.body.title).toBeDefined();
      expect(res.body.id).toBe(event.id);
      // participants array must be present with correct shape
      expect(Array.isArray(res.body.participants)).toBe(true);
      expect(res.body.participants.length).toBeGreaterThan(0);
      expect(res.body.participants[0]).toHaveProperty("displayName");
      expect(res.body.participants[0]).toHaveProperty("rsvpStatus");
      // no internal person ids leaked on the participant list
      expect(res.body.participants[0].personId).toBeUndefined();
      // C1: a non-attending owning member (no RSVP, no grant) must NOT appear — no roster leak
      const participantNames = res.body.participants.map((pp: { displayName: string }) => pp.displayName);
      expect(participantNames).not.toContain("Bystander");
      // tasks array must be present and must NOT leak owning-family person ids
      expect(Array.isArray(res.body.tasks)).toBe(true);
      expect(res.body.tasks.length).toBeGreaterThan(0);
      expect(res.body.tasks[0].name).toBe("Cups");
      expect(res.body.tasks[0].status).toBeDefined();
      expect(res.body.tasks[0].createdByPersonId).toBeUndefined();
      expect(res.body.tasks[0].assignedToPersonId).toBeUndefined();
      expect(res.body.tasks[0].eventId).toBeUndefined();
      expect(res.body.tasks[0].visibility).toBeUndefined();
      // family name and nested roster must NOT be present
      expect(res.body.familyName).toBeUndefined();
      expect(res.body.members).toBeUndefined();
    });

    it("cross-family participant item-write response omits internal ids (I1)", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const participant = await seedSecondPerson();
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Foreign Item Write" });
      await db.eventParticipant.create({
        data: { eventId: event.id, personId: participant.id, role: "PARTICIPANT", status: "ACTIVE", invitedById: admin.id }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/items`)
        .set("Authorization", "Bearer mock")
        .send({ name: "Napkins" });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Napkins");
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBeDefined();
      // foreign-safe shape: no internal ids
      expect(res.body.createdByPersonId).toBeUndefined();
      expect(res.body.assignedToPersonId).toBeUndefined();
      expect(res.body.eventId).toBeUndefined();
      expect(res.body.visibility).toBeUndefined();
    });

    it("owning member detail read still returns the full event shape", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Owning Member Read" });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/events/${event.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      // Full shape: event is nested under .event key with familyGroupId present
      expect(res.body.event).toBeDefined();
      expect(res.body.event.familyGroupId).toBe(familyGroup.id);
      expect(res.body.invitations).toBeDefined();
      expect(res.body.rsvps).toBeDefined();
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

  describe("POST /api/v1/events/:eventId/invitations — guest delivery (P3-03 W3a-UI)", () => {
    it("invokes sendGuestInvitation with the rsvp link + title and no family name; send failure is non-fatal", async () => {
      // Each channel inside sendGuestInvitation catches its own error, so we make the
      // whole method throw to prove the route-level call site is also non-fatal.
      const spy = vi.spyOn(NotificationService.prototype, "sendGuestInvitation").mockRejectedValue(new Error("boom"));

      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id); // family name "Test Family"
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Picnic" });
      await db.event.update({ where: { id: event.id }, data: { eventVisibility: "OPEN" } });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/events/${event.id}/invitations`)
        .set("Authorization", "Bearer mock")
        .send({ invitees: [{ kind: "guest", guestEmail: "ext@example.com", guestName: "Ext Guest" }] });

      expect(res.status).toBe(201);
      expect(spy).toHaveBeenCalledTimes(1);
      const arg = spy.mock.calls[0][0];
      expect(arg.email).toBe("ext@example.com");
      expect(arg.message.body).toContain("Picnic");
      expect(arg.message.body).toMatch(/\/rsvp\//);
      expect(`${arg.message.subject}\n${arg.message.body}`).not.toContain("Test Family");

      spy.mockRestore();
    });
  });
});
