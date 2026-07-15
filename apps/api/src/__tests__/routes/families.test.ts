import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { CREATOR_PERMISSIONS, CREATOR_ROLES } from "../../lib/familyAccess";
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

const mockStripe = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn(), update: vi.fn() }
}));

vi.mock("stripe", () => {
  function MockStripe() { return mockStripe; }
  MockStripe.prototype = mockStripe;
  return { default: MockStripe };
});

describe("families & households routes", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => {
    mockGetAuth.mockReset();
    mockStripe.subscriptions.retrieve.mockReset();
    mockStripe.subscriptions.update.mockReset();
  });

  describe("POST /api/v1/families", () => {
    it("returns 400 when requester has no Person record", async () => {
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post("/api/v1/families")
        .set("Authorization", "Bearer mock")
        .send({ name: "Smith Family" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("onboarding");
    });

    it("creates family and creator membership with ADMIN, ORGANIZER, and permissions", async () => {
      await seedTestPerson();
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post("/api/v1/families")
        .set("Authorization", "Bearer mock")
        .send({ name: "Smith Family" });
      expect(res.status).toBe(201);
      expect(res.body.familyGroup.name).toBe("Smith Family");
      expect(res.body.membership.roles.sort()).toEqual([...CREATOR_ROLES].sort());
      expect(res.body.membership.permissions.sort()).toEqual([...CREATOR_PERMISSIONS].sort());
    });
  });

  describe("GET /api/v1/families/:familyId", () => {
    it("returns 403 when requester is not a member", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      await seedSecondPerson();
      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/families/${familyGroup.id}`)
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(403);
    });

    it("returns 200 with nested members and households for a member", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/families/${familyGroup.id}`)
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(200);
      expect(res.body.familyGroup.id).toBe(familyGroup.id);
      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0].person.id).toBe(admin.id);
      expect(res.body.households).toEqual([]);
    });
  });

  describe("DELETE /api/v1/families/:familyId/members/:personId", () => {
    it("returns 400 when removing the last admin", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/families/${familyGroup.id}/members/${admin.id}`)
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/last admin/i);
    });

    it("allows removing self when not the only admin scenario", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const other = await seedGuestPerson();
      await db.familyMember.create({
        data: {
          familyGroupId: familyGroup.id,
          personId: other.id,
          roles: ["ADMIN"],
          permissions: []
        }
      });
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/families/${familyGroup.id}/members/${admin.id}`)
        .set("Authorization", "Bearer mock");
      expect(res.status).toBe(204);
    });
  });

  describe("POST /api/v1/households/:householdId/members", () => {
    it("returns 400 when person is not a family member", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const household = await db.household.create({
        data: {
          familyGroupId: familyGroup.id,
          name: "Main",
          country: "US"
        }
      });
      await db.householdFamily.create({
        data: { householdId: household.id, familyGroupId: familyGroup.id }
      });
      const outsider = await seedSecondPerson();
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/households/${household.id}/members`)
        .set("Authorization", "Bearer mock")
        .send({ personId: outsider.id });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/member of the family/i);
    });
  });

  describe("POST /api/v1/families/:familyId/members — seat enforcement", () => {
    it("returns 402 with seatRequired when adding active user would exceed seat count", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const second = await seedSecondPerson();
      await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, activeUserLimit: 5 } });
      await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 1 } });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/members`)
        .set("Authorization", "Bearer mock")
        .send({ personId: second.id, roles: ["MEMBER"], permissions: [] });

      expect(res.status).toBe(402);
      expect(res.body.seatRequired).toBe(true);
    });

    it("adds active member with a DB-only seat bump when there is no Stripe seat price (free tier)", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const second = await seedSecondPerson();
      await db.pricingTier.create({ data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, activeUserLimit: 5 } });
      await db.familySubscription.create({ data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 1 } });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/members`)
        .set("Authorization", "Bearer mock")
        .send({ personId: second.id, roles: ["MEMBER"], permissions: [], confirmSeatExpansion: true });

      expect(res.status).toBe(201);
      const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
      expect(sub?.seatCount).toBe(2);
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("confirmed expansion on a paid plan bumps the Stripe seat quantity, not the DB (Stripe = SOT)", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const second = await seedSecondPerson();
      await db.pricingTier.create({
        data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, activeUserLimit: 5, stripePriceId: "price_base", stripeSeatPriceId: "price_seat" }
      });
      await db.familySubscription.create({
        data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 1, stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test" }
      });
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        items: { data: [{ id: "si_seat", price: { id: "price_seat" } }] }
      });
      mockStripe.subscriptions.update.mockResolvedValue({});

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/members`)
        .set("Authorization", "Bearer mock")
        .send({ personId: second.id, roles: ["MEMBER"], permissions: [], confirmSeatExpansion: true });

      expect(res.status).toBe(201);
      // seatCount 1 + 1 new = 2 total; 1 is included in the base price → bill 1
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_test", {
        items: [{ id: "si_seat", quantity: 1 }],
        proration_behavior: "create_prorations"
      });
      // seatCount converges via the customer.subscription.updated webhook
      const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
      expect(sub?.seatCount).toBe(1);
    });

    it("adds the seat item by price when none exists yet (first overflow seat)", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const second = await seedSecondPerson();
      await db.pricingTier.create({
        data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, activeUserLimit: 5, stripePriceId: "price_base", stripeSeatPriceId: "price_seat", includedSeats: 1 }
      });
      await db.familySubscription.create({
        data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 1, stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test" }
      });
      // No seat item on the subscription yet — family was within the allowance
      mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [] } });
      mockStripe.subscriptions.update.mockResolvedValue({});

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/members`)
        .set("Authorization", "Bearer mock")
        .send({ personId: second.id, roles: ["MEMBER"], permissions: [], confirmSeatExpansion: true });

      expect(res.status).toBe(201);
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_test", {
        items: [{ price: "price_seat", quantity: 1 }],
        proration_behavior: "create_prorations"
      });
    });
  });

  describe("GET /api/v1/families/:familyId", () => {
    it("returns family group, members, and households for a member", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      await db.household.create({ data: { familyGroupId: familyGroup.id, name: "Main", country: "US" } });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/families/${familyGroup.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      expect(res.body.familyGroup.id).toBe(familyGroup.id);
      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0].person.id).toBe(admin.id);
      expect(res.body.households).toHaveLength(1);
      expect(res.body.households[0].household.name).toBe("Main");
    });
  });

  describe("POST /api/v1/families/:familyId/households", () => {
    it("creates the household plus exactly one HouseholdFamily link and one LINKED audit entry", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/households`)
        .set("Authorization", "Bearer mock")
        .send({ name: "New Household" });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe("New Household");
      expect(res.body.familyGroupId).toBe(familyGroup.id);

      const links = await db.householdFamily.findMany({ where: { householdId: res.body.id } });
      expect(links).toHaveLength(1);
      expect(links[0]?.familyGroupId).toBe(familyGroup.id);
      expect(links[0]?.linkedByPersonId).toBe(admin.id);

      const auditEntries = await db.householdAuditEntry.findMany({ where: { householdId: res.body.id } });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.action).toBe("LINKED");
      expect(auditEntries[0]?.actorPersonId).toBe(admin.id);
      expect(auditEntries[0]?.actorFamilyGroupId).toBe(familyGroup.id);
    });
  });

  describe("PUT /api/v1/families/:familyId", () => {
    it("admin updates name, aiEnabled, and defaultVisibility", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/families/${familyGroup.id}`)
        .set("Authorization", "Bearer mock")
        .send({ name: "Renamed Family", aiEnabled: false, defaultVisibility: "HOUSEHOLD" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Renamed Family");
      expect(res.body.aiEnabled).toBe(false);
      expect(res.body.defaultVisibility).toBe("HOUSEHOLD");
    });

    it("non-admin member gets 403", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const member = await seedSecondPerson();
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .put(`/api/v1/families/${familyGroup.id}`)
        .set("Authorization", "Bearer mock")
        .send({ name: "Hijacked Family" });

      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/v1/families/:familyId/members/:personId", () => {
    it("a member can remove themselves", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const member = await seedSecondPerson();
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/families/${familyGroup.id}/members/${member.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(204);
    });

    it("an admin can remove another member", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const member = await seedSecondPerson();
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/families/${familyGroup.id}/members/${member.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(204);
    });

    it("a non-admin cannot remove someone else", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const member = await seedSecondPerson();
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/families/${familyGroup.id}/members/${admin.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(403);
    });

    it("refuses to remove the last admin", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/families/${familyGroup.id}/members/${admin.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/last admin/i);
    });

    it("404 when membership does not exist", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const stranger = await seedSecondPerson();

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .delete(`/api/v1/families/${familyGroup.id}/members/${stranger.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(404);
    });
  });
});
