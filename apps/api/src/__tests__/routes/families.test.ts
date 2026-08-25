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
          name: "Main",
          country: "US",
          families: { create: { familyGroupId: familyGroup.id } }
        }
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

  describe("POST /api/v1/families/:familyId/members — provenance gate, no inline billing", () => {
    it("adds a passive, contact-less target this family authored (provenance) — 201, no 402 gate, no Stripe call, even at the seat boundary", async () => {
      const admin = await seedTestPerson({ userId: "clerk_admin_nb" });
      const { familyGroup } = await seedTestFamily(admin.id);
      // activeUserLimit finite + activeCount(1 admin) == seatCount(1) => OLD billing-gate code
      // would have returned 402. That gate is gone; the ONLY gate now is provenance.
      await db.pricingTier.create({
        data: { tierKey: "BASE", displayName: "Base", displayOrder: 1, includedSeats: 1, activeUserLimit: 1, stripePriceId: "price_base", stripeSeatPriceId: "price_seat" }
      });
      await db.familySubscription.create({
        data: { familyGroupId: familyGroup.id, tierKey: "BASE", seatCount: 1, stripeCustomerId: "cus_test", stripeSubscriptionId: "sub_test", status: "ACTIVE" }
      });
      // Passive, no contact at all, authored by THIS family — data entry the gate must allow.
      const dataEntry = await db.person.create({
        data: { firstName: "Data", lastName: "Entry", ageGateLevel: "ADULT", userId: null, createdByFamilyGroupId: familyGroup.id }
      });

      mockGetAuth.mockReturnValue({ userId: "clerk_admin_nb" });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/members`)
        .send({ personId: dataEntry.id, roles: ["MEMBER"], permissions: [] });

      expect(res.status).toBe(201);
      expect(res.body.personId).toBe(dataEntry.id);
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
      expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
      // seatCount is NOT bumped inline — the daily cron reconciles it.
      const sub = await db.familySubscription.findUnique({ where: { familyGroupId: familyGroup.id } });
      expect(sub?.seatCount).toBe(1);
    });

    it("409 CONSENT_REQUIRED for an active-account target (has userId) — no FamilyMember created", async () => {
      const admin = await seedTestPerson({ userId: "clerk_admin_active" });
      const { familyGroup } = await seedTestFamily(admin.id);
      const activeTarget = await seedTestPerson({ userId: "clerk_target_active" });

      mockGetAuth.mockReturnValue({ userId: "clerk_admin_active" });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/members`)
        .send({ personId: activeTarget.id, roles: ["MEMBER"], permissions: [] });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("CONSENT_REQUIRED");
      expect(res.body.linkRequest).toMatchObject({
        endpoint: "/api/v1/link-requests",
        kind: "FAMILY_MEMBERSHIP",
        direction: "PULL",
        familyGroupId: familyGroup.id,
        targetPersonId: activeTarget.id
      });
      const member = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: activeTarget.id } }
      });
      expect(member).toBeNull();
    });

    it("409 CONSENT_REQUIRED for a passive target WITH contact (email set) — no FamilyMember created", async () => {
      const admin = await seedTestPerson({ userId: "clerk_admin_contact" });
      const { familyGroup } = await seedTestFamily(admin.id);
      const contactTarget = await db.person.create({
        data: {
          firstName: "Has",
          lastName: "Contact",
          ageGateLevel: "ADULT",
          userId: null,
          createdByFamilyGroupId: familyGroup.id,
          email: "has-contact@example.com",
          emailNormalized: "has-contact@example.com"
        }
      });

      mockGetAuth.mockReturnValue({ userId: "clerk_admin_contact" });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/members`)
        .send({ personId: contactTarget.id, roles: ["MEMBER"], permissions: [] });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("CONSENT_REQUIRED");
      const member = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: contactTarget.id } }
      });
      expect(member).toBeNull();
    });

    it("409 CONSENT_REQUIRED for a passive, contact-less target with NO owning family (createdByFamilyGroupId null) — no FamilyMember created", async () => {
      const admin = await seedTestPerson({ userId: "clerk_admin_orphan" });
      const { familyGroup } = await seedTestFamily(admin.id);
      const orphan = await seedGuestPerson(); // passive, no contact, createdByFamilyGroupId null

      mockGetAuth.mockReturnValue({ userId: "clerk_admin_orphan" });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/members`)
        .send({ personId: orphan.id, roles: ["MEMBER"], permissions: [] });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("CONSENT_REQUIRED");
      const member = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: orphan.id } }
      });
      expect(member).toBeNull();
    });

    it("409 CONSENT_REQUIRED for a passive, contact-less target authored by a DIFFERENT family — no FamilyMember created", async () => {
      const admin = await seedTestPerson({ userId: "clerk_admin_foreign" });
      const { familyGroup } = await seedTestFamily(admin.id);
      const otherAdmin = await seedSecondPerson();
      const otherFamily = await db.familyGroup.create({
        data: { name: "Other Family", createdById: otherAdmin.id }
      });
      const foreignEntry = await db.person.create({
        data: { firstName: "Foreign", lastName: "Entry", ageGateLevel: "ADULT", userId: null, createdByFamilyGroupId: otherFamily.id }
      });

      mockGetAuth.mockReturnValue({ userId: "clerk_admin_foreign" });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/members`)
        .send({ personId: foreignEntry.id, roles: ["MEMBER"], permissions: [] });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("CONSENT_REQUIRED");
      const member = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: foreignEntry.id } }
      });
      expect(member).toBeNull();
    });

    it("400 Person not found for an unknown personId", async () => {
      const admin = await seedTestPerson({ userId: "clerk_admin_nf" });
      const { familyGroup } = await seedTestFamily(admin.id);

      mockGetAuth.mockReturnValue({ userId: "clerk_admin_nf" });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/members`)
        .send({ personId: "nonexistent-person-id", roles: ["MEMBER"], permissions: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Person not found");
    });

    it("400 Person is already a member of this family (idempotent re-add of the same provenance target)", async () => {
      const admin = await seedTestPerson({ userId: "clerk_admin_dup" });
      const { familyGroup } = await seedTestFamily(admin.id);
      const dataEntry = await db.person.create({
        data: { firstName: "Data", lastName: "Entry", ageGateLevel: "ADULT", userId: null, createdByFamilyGroupId: familyGroup.id }
      });
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: dataEntry.id, roles: ["MEMBER"], permissions: [] }
      });

      mockGetAuth.mockReturnValue({ userId: "clerk_admin_dup" });
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/members`)
        .send({ personId: dataEntry.id, roles: ["MEMBER"], permissions: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Person is already a member of this family");
    });

    it("rejects an unknown confirmSeatExpansion-less body the same way as before removal (schema no longer has the field, no error from sending it)", async () => {
      const admin = await seedTestPerson({ userId: "clerk_admin_legacy" });
      const { familyGroup } = await seedTestFamily(admin.id);
      const dataEntry = await db.person.create({
        data: { firstName: "Data", lastName: "Entry", ageGateLevel: "ADULT", userId: null, createdByFamilyGroupId: familyGroup.id }
      });
      mockGetAuth.mockReturnValue({ userId: "clerk_admin_legacy" });
      // A stale client sending the now-removed field must not get a 400 — zod strips unknown keys.
      const res = await request(app)
        .post(`/api/v1/families/${familyGroup.id}/members`)
        .send({ personId: dataEntry.id, roles: ["MEMBER"], permissions: [], confirmSeatExpansion: true });
      expect(res.status).toBe(201);
    });
  });

  describe("GET /api/v1/families/:familyId", () => {
    it("returns family group, members, and households for a member", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      await db.household.create({
        data: { name: "Main", country: "US", families: { create: { familyGroupId: familyGroup.id } } }
      });

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

    it("reads households through the HouseholdFamily join — a household linked to two families is returned for both", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      // Household created and linked to a different family first, then also linked to ours —
      // it must show up for ours purely via the join, with no ownership concept involved.
      const other = await seedSecondPerson();
      const otherFamily = await db.familyGroup.create({
        data: { name: "Other Family", createdById: other.id }
      });
      const household = await db.household.create({
        data: { name: "Shared", country: "US", families: { create: { familyGroupId: otherFamily.id } } }
      });
      await db.householdFamily.create({
        data: { householdId: household.id, familyGroupId: familyGroup.id }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/families/${familyGroup.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      expect(res.body.households).toHaveLength(1);
      expect(res.body.households[0].household.name).toBe("Shared");
      // no per-household family reference is ever surfaced (spec §7 invariant 1 — no foreign family ids)
      expect(res.body.households[0].household).not.toHaveProperty("familyGroupId");
    });

    it("household members are scoped to the requesting family — a resident who is only a member of the OTHER linked family is excluded, a resident of THIS family is included (Fix 1, invariant 1)", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const ownResident = await seedSecondPerson();
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: ownResident.id, roles: [], permissions: [] }
      });

      const otherAdmin = await db.person.create({
        data: { firstName: "Other", lastName: "Admin", ageGateLevel: "ADULT" }
      });
      const otherFamily = await db.familyGroup.create({
        data: { name: "Other Family", createdById: otherAdmin.id }
      });
      const foreignResident = await db.person.create({
        data: { firstName: "Foreign", lastName: "Resident", ageGateLevel: "ADULT", dateOfBirth: new Date("1990-01-01") }
      });
      await db.familyMember.create({
        data: { familyGroupId: otherFamily.id, personId: foreignResident.id, roles: [], permissions: [] }
      });

      const household = await db.household.create({
        data: {
          name: "Shared Home",
          country: "US",
          families: {
            create: [
              { familyGroupId: familyGroup.id },
              { familyGroupId: otherFamily.id }
            ]
          }
        }
      });
      await db.householdMember.create({ data: { householdId: household.id, personId: ownResident.id } });
      await db.householdMember.create({ data: { householdId: household.id, personId: foreignResident.id } });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/families/${familyGroup.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      expect(res.body.households).toHaveLength(1);
      const memberIds = res.body.households[0].members.map((p: { id: string }) => p.id);
      expect(memberIds).toContain(ownResident.id);
      expect(memberIds).not.toContain(foreignResident.id);
      // foreignResident's DOB must never reach a viewer from the other linked family
      expect(
        (res.body.households[0].members as Array<{ id: string; dateOfBirth: string | null }>).some(
          (p) => p.dateOfBirth === "1990-01-01"
        )
      ).toBe(false);
    });

    it("Fix B: a person removed from the family (FamilyMember hard-deleted) drops out of this view but remains visible via GET /households/:id — accepted semantics, nothing stranded", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const member = await seedSecondPerson();
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
      });
      const household = await db.household.create({
        data: { name: "Shared Home", country: "US", families: { create: { familyGroupId: familyGroup.id } } }
      });
      await db.householdMember.create({ data: { householdId: household.id, personId: member.id } });

      // Remove member from the family via the API — hard-deletes FamilyMember, leaves
      // HouseholdMember intact (the behavior the corrected comment documents).
      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const del = await request(app)
        .delete(`/api/v1/families/${familyGroup.id}/members/${member.id}`)
        .set("Authorization", "Bearer mock");
      expect(del.status).toBe(204);

      const familyRes = await request(app)
        .get(`/api/v1/families/${familyGroup.id}`)
        .set("Authorization", "Bearer mock");
      expect(familyRes.status).toBe(200);
      expect(familyRes.body.households).toHaveLength(1);
      const familyViewMemberIds = familyRes.body.households[0].members.map((p: { id: string }) => p.id);
      expect(familyViewMemberIds).not.toContain(member.id);

      const householdRes = await request(app)
        .get(`/api/v1/households/${household.id}`)
        .set("Authorization", "Bearer mock");
      expect(householdRes.status).toBe(200);
      const householdViewMemberIds = householdRes.body.members.map((m: { personId: string }) => m.personId);
      expect(householdViewMemberIds).toContain(member.id);
    });

    it("does NOT return a household that is not linked to this family", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      // No link row at all — the join is the sole source of truth for visibility
      await db.household.create({
        data: { name: "Unlinked", country: "US" }
      });

      mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
      const res = await request(app)
        .get(`/api/v1/families/${familyGroup.id}`)
        .set("Authorization", "Bearer mock");

      expect(res.status).toBe(200);
      expect(res.body.households).toEqual([]);
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
      // Response exposes linkedFamilies (viewer-scoped), not the transitional FK
      expect(res.body).not.toHaveProperty("familyGroupId");
      expect(res.body.linkedFamilies).toEqual([{ id: familyGroup.id, name: "Test Family" }]);

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
