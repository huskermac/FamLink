import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { seedTestFamily } from "../../__tests__/helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

/**
 * P3-04 W1 PR-2 Task 12 — dedicated concurrency regression pack. Pins the
 * named races from the spec/council review as explicit tests against the
 * REAL test database (not a mocked clock or a stubbed transaction), so a
 * regression in claim serialization shows up as a named test failure.
 */
describe("P3-04 W1 PR-2 concurrency races", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  const clerkIdByPersonId = new Map<string, string>();
  let nextClerkId = 0;

  beforeEach(() => {
    mockGetAuth.mockReset();
    clerkIdByPersonId.clear();
    nextClerkId = 0;
  });

  async function seedPerson(
    clerkId: string | null | undefined,
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
        userId: clerkId ?? null,
        email: overrides?.email,
        phone: overrides?.phone,
        dateOfBirth: overrides?.dateOfBirth
      }
    });
    if (clerkId) clerkIdByPersonId.set(person.id, clerkId);
    return person;
  }

  async function seedAuthedPerson(overrides?: Parameters<typeof seedPerson>[1]) {
    nextClerkId += 1;
    return seedPerson(`user_test_concurrency_${nextClerkId}`, overrides);
  }

  function actingAs(personId: string) {
    const clerkId = clerkIdByPersonId.get(personId);
    if (!clerkId) throw new Error(`actingAs: no clerk id registered for person ${personId}`);
    mockGetAuth.mockReturnValue({ userId: clerkId });
    return request(app);
  }
  const asAdmin = actingAs;
  const asPerson = actingAs;

  async function seedAdminFamily() {
    const admin = await seedAuthedPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    return { admin, familyGroup };
  }

  async function seedMembershipRequest(overrides: {
    familyGroupId: string;
    targetPersonId: string;
    requestedByPersonId: string;
    direction?: "PULL" | "JOIN";
    expiresAt?: Date;
    status?: string;
  }) {
    return db.linkRequest.create({
      data: {
        kind: "FAMILY_MEMBERSHIP",
        direction: overrides.direction ?? "PULL",
        familyGroupId: overrides.familyGroupId,
        targetPersonId: overrides.targetPersonId,
        requestedByPersonId: overrides.requestedByPersonId,
        status: overrides.status ?? "PENDING",
        consentChannel: "IN_APP",
        attestedAdult: false,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 30 * 86_400_000)
      }
    });
  }

  async function seedHousehold(opts?: { linkedFamilyGroupIds?: string[] }) {
    const household = await db.household.create({ data: { name: "Concurrency House", country: "US" } });
    for (const familyGroupId of opts?.linkedFamilyGroupIds ?? []) {
      await db.householdFamily.create({ data: { householdId: household.id, familyGroupId } });
    }
    return household;
  }

  describe("concurrent double-accept — membership", () => {
    it("two simultaneous accepts grant exactly once", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Race", lastName: "Target" });
      const linkRequest = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: target.id,
        requestedByPersonId: admin.id
      });

      const [a, b] = await Promise.all([
        asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`).send({}),
        asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`).send({})
      ]);

      expect([a.status, b.status].every((s) => s === 200)).toBe(true);
      expect([a.body.granted, b.body.granted].filter(Boolean).length).toBe(1); // exactly one caller claimed

      const members = await db.familyMember.findMany({
        where: { familyGroupId: familyGroup.id, personId: target.id }
      });
      expect(members.length).toBe(1);

      const row = await db.linkRequest.findUnique({ where: { id: linkRequest.id } });
      expect(row?.status).toBe("ACCEPTED");
    });
  });

  describe("concurrent double-accept — household", () => {
    it("two simultaneous accepts on a HOUSEHOLD_LINK request grant exactly once", async () => {
      const { admin: adminA, familyGroup: familyA } = await seedAdminFamily();
      const { admin: adminB, familyGroup: familyB } = await seedAdminFamily();
      const household = await seedHousehold({ linkedFamilyGroupIds: [familyB.id] });

      const createRes = await asAdmin(adminA.id)
        .post("/api/v1/link-requests")
        .send({ kind: "HOUSEHOLD_LINK", direction: "JOIN", familyGroupId: familyA.id, targetHouseholdId: household.id });
      expect(createRes.status).toBe(201);
      const reqId = createRes.body.id;

      const [a, b] = await Promise.all([
        asAdmin(adminB.id).post(`/api/v1/link-requests/${reqId}/accept`).send({}),
        asAdmin(adminB.id).post(`/api/v1/link-requests/${reqId}/accept`).send({})
      ]);

      expect([a.status, b.status].every((s) => s === 200)).toBe(true);
      expect([a.body.granted, b.body.granted].filter(Boolean).length).toBe(1); // exactly one caller claimed

      const links = await db.householdFamily.findMany({
        where: { householdId: household.id, familyGroupId: familyA.id }
      });
      expect(links.length).toBe(1);

      const auditEntries = await db.householdAuditEntry.findMany({
        where: { householdId: household.id, action: "LINKED" }
      });
      expect(auditEntries.length).toBe(1);

      const row = await db.linkRequest.findUnique({ where: { id: reqId } });
      expect(row?.status).toBe("ACCEPTED");
    });
  });

  describe("concurrent link-vs-unlink on a household", () => {
    it("min-1 holds — the household never ends with zero linked families", async () => {
      // Household starts linked to family B only (count 1). Family A has a PENDING JOIN
      // request open. Concurrently: B accepts the join (adds A, count -> 2) AND B unlinks
      // itself (would only succeed once count > 1). Both routes take a `SELECT ... FOR
      // UPDATE` lock on the Household row, so Postgres serializes them — but the ORDER is a
      // genuine race. Either order must leave the household with >= 1 linked family.
      const { admin: adminA, familyGroup: familyA } = await seedAdminFamily();
      const { admin: adminB, familyGroup: familyB } = await seedAdminFamily();
      const household = await seedHousehold({ linkedFamilyGroupIds: [familyB.id] });

      const createRes = await asAdmin(adminA.id)
        .post("/api/v1/link-requests")
        .send({ kind: "HOUSEHOLD_LINK", direction: "JOIN", familyGroupId: familyA.id, targetHouseholdId: household.id });
      expect(createRes.status).toBe(201);
      const reqId = createRes.body.id;

      const [acceptRes, unlinkRes] = await Promise.all([
        asAdmin(adminB.id).post(`/api/v1/link-requests/${reqId}/accept`).send({}),
        asAdmin(adminB.id).post(`/api/v1/households/${household.id}/unlink`).send({ familyGroupId: familyB.id })
      ]);

      const links = await db.householdFamily.findMany({ where: { householdId: household.id } });
      const linkedFamilyIds = new Set(links.map((l) => l.familyGroupId));

      // The household must never be left tenantless, whichever order won the race.
      expect(links.length).toBeGreaterThanOrEqual(1);

      if (unlinkRes.status === 204) {
        // B's unlink only succeeds once count > 1 at that instant, which requires A's accept
        // to have already committed — so the accept must show granted:true, and the surviving
        // family must be A alone.
        expect(acceptRes.body.granted).toBe(true);
        expect(linkedFamilyIds.has(familyA.id)).toBe(true);
        expect(linkedFamilyIds.has(familyB.id)).toBe(false);
        expect(links.length).toBe(1);
      } else {
        // The unlink lost the race against a still-count-1 household — LAST_LINK, not applied.
        expect(unlinkRes.status).toBe(409);
        expect(unlinkRes.body.error).toBe("LAST_LINK");
        expect(linkedFamilyIds.has(familyB.id)).toBe(true); // B was never removed
      }
    });
  });

  describe("concurrent duplicate-create", () => {
    it("two simultaneous creates for the same (family, target) leave exactly one PENDING row", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Dup", lastName: "Target" });

      const [a, b] = await Promise.all([
        asAdmin(admin.id)
          .post("/api/v1/link-requests")
          .send({ kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: familyGroup.id, targetPersonId: target.id }),
        asAdmin(admin.id)
          .post("/api/v1/link-requests")
          .send({ kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: familyGroup.id, targetPersonId: target.id })
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.error).toBe("REQUEST_ALREADY_PENDING");

      const rows = await db.linkRequest.findMany({
        where: { familyGroupId: familyGroup.id, targetPersonId: target.id, kind: "FAMILY_MEMBERSHIP", status: "PENDING" }
      });
      expect(rows.length).toBe(1); // the partial unique index let exactly one through
    });
  });

  describe("accept-vs-decline", () => {
    it("the terminal state and the grant agree — a FamilyMember row exists iff the row ended ACCEPTED", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Race2", lastName: "Target" });
      const linkRequest = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: target.id,
        requestedByPersonId: admin.id
      });

      const [acceptRes, declineRes] = await Promise.all([
        asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/accept`).send({}),
        asPerson(target.id).post(`/api/v1/link-requests/${linkRequest.id}/decline`).send({})
      ]);

      expect([acceptRes.status, declineRes.status]).toEqual([200, 200]);

      const row = await db.linkRequest.findUnique({ where: { id: linkRequest.id } });
      expect(["ACCEPTED", "DECLINED"]).toContain(row?.status);

      const member = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: target.id } }
      });
      if (row?.status === "ACCEPTED") {
        expect(member).not.toBeNull();
        expect(acceptRes.body.granted).toBe(true);
      } else {
        expect(member).toBeNull();
        expect(acceptRes.body.granted).toBe(false);
      }
    });
  });

  describe("expiry sweep before create", () => {
    it("an expired-but-still-PENDING duplicate is swept so a new create is not spuriously rejected by the partial index", async () => {
      const { admin, familyGroup } = await seedAdminFamily();
      const target = await seedAuthedPerson({ firstName: "Stale", lastName: "Target" });

      // A stale row, still marked PENDING in the DB (as if the expiry sweep on read/accept
      // never ran for it), but its expiresAt is already in the past.
      const stale = await seedMembershipRequest({
        familyGroupId: familyGroup.id,
        targetPersonId: target.id,
        requestedByPersonId: admin.id,
        expiresAt: new Date(Date.now() - 1000)
      });

      const res = await asAdmin(admin.id)
        .post("/api/v1/link-requests")
        .send({ kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: familyGroup.id, targetPersonId: target.id });

      expect(res.status).toBe(201); // NOT 409 — the stale row must be swept before the insert

      const staleRow = await db.linkRequest.findUnique({ where: { id: stale.id } });
      expect(staleRow?.status).toBe("EXPIRED");

      const pending = await db.linkRequest.findMany({
        where: { familyGroupId: familyGroup.id, targetPersonId: target.id, kind: "FAMILY_MEMBERSHIP", status: "PENDING" }
      });
      expect(pending.length).toBe(1);
      expect(pending[0].id).not.toBe(stale.id);
    });
  });
});
