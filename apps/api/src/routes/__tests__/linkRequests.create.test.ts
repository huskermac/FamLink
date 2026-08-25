import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { TEST_CLERK_ID, TEST_USER_2_CLERK_ID } from "../../__tests__/helpers/auth";
import { seedSecondPerson, seedTestFamily } from "../../__tests__/helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

describe("POST /api/v1/link-requests", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  // Personid -> clerk userId lookup, populated by seedPerson below. Lets a test call
  // asPerson(personId)/asAdmin(personId) with a Person.id (matching the brief's fixtures,
  // which assert on FK columns like requestedByPersonId/targetPersonId) while the actual
  // auth mock needs the Clerk user id.
  const clerkIdByPersonId = new Map<string, string>();

  beforeEach(() => {
    mockGetAuth.mockReset();
    clerkIdByPersonId.clear();
  });

  async function seedPerson(
    clerkId: string | null,
    overrides?: Partial<{
      firstName: string;
      lastName: string;
      ageGateLevel: string;
      email: string | null;
      phone: string | null;
      dateOfBirth: Date | null;
    }>
  ) {
    const person = await db.person.create({
      data: {
        firstName: overrides?.firstName ?? "Test",
        lastName: overrides?.lastName ?? "Person",
        ageGateLevel: overrides?.ageGateLevel ?? "ADULT",
        userId: clerkId,
        email: overrides?.email,
        phone: overrides?.phone,
        dateOfBirth: overrides?.dateOfBirth
      }
    });
    if (clerkId) clerkIdByPersonId.set(person.id, clerkId);
    return person;
  }

  /** Authenticate as the given Person.id (must have been seeded with a clerk id). */
  function actingAs(personId: string) {
    const clerkId = clerkIdByPersonId.get(personId);
    if (!clerkId) throw new Error(`actingAs: no clerk id registered for person ${personId}`);
    mockGetAuth.mockReturnValue({ userId: clerkId });
    // getAuth is fully mocked (ignores the request), so no real Authorization header is
    // needed — request(app) itself is the agent; callers chain .post()/.get() on it.
    return request(app);
  }
  // Aliases matching the brief's test vocabulary — admin-ness is a FamilyMember.roles fact,
  // not a distinct auth path, so both resolve identically.
  const asAdmin = actingAs;
  const asPerson = actingAs;

  async function seedAdminFamily() {
    const admin = await seedPerson(TEST_CLERK_ID);
    const { familyGroup } = await seedTestFamily(admin.id);
    return { admin, familyGroup };
  }

  describe("membership PULL", () => {
    it("active-account target: creates PENDING and attaches a billing disclosure", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const activeTarget = await seedPerson(TEST_USER_2_CLERK_ID, { firstName: "Active", lastName: "Target" });

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetPersonId: activeTarget.id
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("PENDING");
      expect(res.body.targetPersonId).toBe(activeTarget.id);
      expect(res.body.billingImpact).toHaveProperty("willBill");

      const row = await db.linkRequest.findFirst({
        where: { familyGroupId: familyGroup.id, targetPersonId: activeTarget.id }
      });
      expect(row?.status).toBe("PENDING");
    });

    it("token (passive-with-contact) target: creates PENDING, no billing disclosure", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      // dateOfBirth set so the attestation gate does not fire — isolates this test to the
      // token-creation + billing-omission behavior under test.
      const tokenTarget = await seedPerson(null, {
        firstName: "Token",
        lastName: "Target",
        email: "token.target@example.com",
        dateOfBirth: new Date("1990-01-01")
      });

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetPersonId: tokenTarget.id
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("PENDING");
      expect(res.body.billingImpact).toBeUndefined();

      const row = await db.linkRequest.findFirst({
        where: { familyGroupId: familyGroup.id, targetPersonId: tokenTarget.id }
      });
      expect(row?.token).not.toBeNull();
    });

    it("known minor target (TEEN, has contact) never gets a token — 201, token null, IN_APP consent", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      // A known minor (ageGateLevel TEEN) with a contact detail, not yet a member of this
      // family. Attestation applies only to a DOB-unknown passive ADULT target (spec §11) —
      // a known minor must skip that gate entirely and never receive a token link; the
      // guardian consents in-app instead.
      const minorTarget = await seedPerson(null, {
        firstName: "Minor",
        lastName: "Target",
        ageGateLevel: "TEEN",
        email: "minor.target@example.com"
      });

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetPersonId: minorTarget.id
        });

      expect(res.status).toBe(201);

      const row = await db.linkRequest.findFirst({
        where: { familyGroupId: familyGroup.id, targetPersonId: minorTarget.id }
      });
      expect(row?.token).toBeNull();
      expect(row?.consentChannel).toBe("IN_APP");
    });

    it("data-entry target (no contact at all) → 409 DATA_ENTRY_NO_CONSENT", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const dataEntryTarget = await seedPerson(null, { firstName: "No", lastName: "Contact" });

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetPersonId: dataEntryTarget.id
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("DATA_ENTRY_NO_CONSENT");
    });

    it("non-admin (no INVITE_MEMBERS) requester → 403", async () => {
      const { familyGroup } = await seedAdminFamily();
      const member = await seedSecondPerson();
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: member.id, roles: [], permissions: [] }
      });
      clerkIdByPersonId.set(member.id, TEST_USER_2_CLERK_ID);
      const activeTarget = await seedPerson("user_test_pull_target");

      const res = await asPerson(member.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetPersonId: activeTarget.id
        });

      expect(res.status).toBe(403);
    });

    it("duplicate PENDING request for the same target → 409", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const activeTarget = await seedPerson(TEST_USER_2_CLERK_ID);

      const first = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetPersonId: activeTarget.id
        });
      expect(first.status).toBe(201);

      const second = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetPersonId: activeTarget.id
        });
      expect(second.status).toBe(409);
      // Pin the specific error code — a regression that accidentally routed this through the
      // AlreadyMember check would still 409, but with the wrong body.
      expect(second.body.error).toBe("REQUEST_ALREADY_PENDING");
    });

    it("target already a family member → 409 ALREADY_MEMBER", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const existingMember = await seedPerson("user_test_already_member");
      await db.familyMember.create({
        data: { familyGroupId: familyGroup.id, personId: existingMember.id, roles: [], permissions: [] }
      });

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetPersonId: existingMember.id
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("ALREADY_MEMBER");
    });

    it("carryHouseholdId not linked to this family → 400 CARRY_HOUSEHOLD_INVALID", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const activeTarget = await seedPerson(TEST_USER_2_CLERK_ID);
      const foreignHousehold = await db.household.create({ data: { name: "Foreign House", country: "US" } });

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetPersonId: activeTarget.id,
          carryHouseholdId: foreignHousehold.id
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("CARRY_HOUSEHOLD_INVALID");
    });
  });

  describe("membership JOIN", () => {
    it("a person asks to join a family → 201 PENDING, requester is the target", async () => {
      const { familyGroup } = await seedAdminFamily();
      const applicant = await seedPerson("user_test_applicant", { firstName: "Ap", lastName: "Plicant" });

      const res = await asPerson(applicant.id)
        .post("/api/v1/link-requests")
        .send({ kind: "FAMILY_MEMBERSHIP", direction: "JOIN", familyGroupId: familyGroup.id });

      expect(res.status).toBe(201);
      expect(res.body.billingImpact).toBeUndefined();

      const row = await db.linkRequest.findFirst({
        where: { familyGroupId: familyGroup.id, requestedByPersonId: applicant.id }
      });
      expect(row?.targetPersonId).toBe(applicant.id);
      expect(row?.status).toBe("PENDING");
    });
  });

  describe("kind-specific schema", () => {
    it("PULL with both targetPersonId and targetEmail (mixed target) → 400", async () => {
      const { admin, familyGroup } = await seedAdminFamily();

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetPersonId: "some-id",
          targetEmail: "mixed@example.com"
        });

      expect(res.status).toBe(400);
    });

    it("PULL with no target at all (empty) → 400", async () => {
      const { admin, familyGroup } = await seedAdminFamily();

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({ kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: familyGroup.id });

      expect(res.status).toBe(400);
    });

    it("JOIN with a targetPersonId supplied → 400 (JOIN forbids any target)", async () => {
      const { familyGroup } = await seedAdminFamily();
      const applicant = await seedPerson("user_test_join_bad");

      const res = await asPerson(applicant.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "FAMILY_MEMBERSHIP",
          direction: "JOIN",
          familyGroupId: familyGroup.id,
          targetPersonId: "someone-else"
        });

      expect(res.status).toBe(400);
    });
  });

  describe("attestation gate", () => {
    it("DOB-unknown passive target without attestation → 400 ATTESTATION_REQUIRED", async () => {
      const { admin, familyGroup } = await seedAdminFamily();

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetEmail: "dobunknown@x.com"
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("ATTESTATION_REQUIRED");
    });

    it("DOB-unknown passive target WITH attestedAdult:true → 201", async () => {
      const { admin, familyGroup } = await seedAdminFamily();

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "FAMILY_MEMBERSHIP",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetEmail: "dobunknown-attested@x.com",
          attestedAdult: true
        });

      expect(res.status).toBe(201);
    });
  });

  describe("HOUSEHOLD_LINK dispatch", () => {
    it("a HOUSEHOLD_LINK body returns 501 (Task 8 implements it)", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const household = await db.household.create({
        data: { name: "Some House", country: "US", families: { create: { familyGroupId: familyGroup.id } } }
      });

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({
          kind: "HOUSEHOLD_LINK",
          direction: "PULL",
          familyGroupId: familyGroup.id,
          targetHouseholdId: household.id
        });

      expect(res.status).toBe(501);
    });
  });
});
