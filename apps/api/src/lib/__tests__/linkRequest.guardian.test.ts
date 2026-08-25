import { db } from "@famlink/db";
import { describe, expect, it } from "vitest";
import { seedTestFamily } from "../../__tests__/helpers/db";
import { AttestationRequired, canConsentMembership, createMembershipRequest } from "../linkRequest";

/**
 * Regression lock for the §6.3 guardian/attestation matrix (Tasks 4-5). Each case here
 * pins one behavior that must never regress: a known minor never gets a token, a
 * would-be guardian must be an ADULT and non-suspended, a family-less minor is
 * consented only by their registered guardian, and attestation gates a DOB-unknown
 * adult but can never promote a known minor onto the token path.
 */
describe("guardian + attestation enforcement (regression lock)", () => {
  async function seedPerson(
    overrides: Partial<{
      firstName: string;
      lastName: string;
      ageGateLevel: string;
      userId: string | null;
      email: string | null;
      phone: string | null;
      guardianPersonId: string | null;
      dateOfBirth: Date | null;
    }> = {}
  ) {
    return db.person.create({
      data: {
        firstName: overrides.firstName ?? "Test",
        lastName: overrides.lastName ?? "Person",
        ageGateLevel: overrides.ageGateLevel ?? "ADULT",
        userId: overrides.userId ?? null,
        email: overrides.email ?? null,
        phone: overrides.phone ?? null,
        guardianPersonId: overrides.guardianPersonId ?? null,
        dateOfBirth: overrides.dateOfBirth ?? null
      }
    });
  }

  /** A fresh family with its own ADMIN, so each case can act as an independent requester. */
  async function seedFamilyWithAdmin() {
    const admin = await seedPerson({ firstName: "Admin", lastName: "Requester" });
    const { familyGroup } = await seedTestFamily(admin.id);
    return { admin, familyGroup };
  }

  describe("1. a known minor with a contact detail never gets a token", () => {
    it("PULL request for a TEEN with an email: token=null, consentChannel=IN_APP", async () => {
      const { admin, familyGroup } = await seedFamilyWithAdmin();
      const minor = await seedPerson({
        firstName: "Minor",
        lastName: "Contactable",
        ageGateLevel: "TEEN",
        email: "minor.contactable@example.com"
      });

      const { request, cls } = await createMembershipRequest({
        familyGroupId: familyGroup.id,
        direction: "PULL",
        requester: { id: admin.id },
        target: { personId: minor.id }
      });

      // Classification is contact-based (TOKEN) — the minor gate overrides it below.
      expect(cls.kind).toBe("TOKEN");
      expect(request.token).toBeNull();
      expect(request.consentChannel).toBe("IN_APP");
    });
  });

  describe("2. canConsentMembership rejects a non-ADULT or suspended would-be guardian", () => {
    it("returns false when the acting admin is not ADULT-level, even though they admin the minor's family", async () => {
      const { familyGroup: guardianFamily } = await seedFamilyWithAdmin();
      const teenAdmin = await seedPerson({ firstName: "Teen", lastName: "Admin", ageGateLevel: "TEEN" });
      await db.familyMember.create({
        data: { familyGroupId: guardianFamily.id, personId: teenAdmin.id, roles: ["ADMIN"], permissions: [] }
      });
      const minor = await seedPerson({
        firstName: "Minor",
        lastName: "UnderTeenAdmin",
        ageGateLevel: "CHILD",
        email: "minor.underteenadmin@example.com"
      });
      await db.familyMember.create({
        data: { familyGroupId: guardianFamily.id, personId: minor.id, roles: [], permissions: [] }
      });
      const { admin: requestingAdmin, familyGroup: requestingFamily } = await seedFamilyWithAdmin();
      const { request } = await createMembershipRequest({
        familyGroupId: requestingFamily.id,
        direction: "PULL",
        requester: { id: requestingAdmin.id },
        target: { personId: minor.id }
      });

      expect(await canConsentMembership(request, { id: teenAdmin.id })).toBe(false);
    });

    it("returns false when the acting ADULT admin's family membership is suspended", async () => {
      const { familyGroup: guardianFamily } = await seedFamilyWithAdmin();
      const suspendedAdmin = await seedPerson({ firstName: "Suspended", lastName: "Admin" });
      await db.familyMember.create({
        data: {
          familyGroupId: guardianFamily.id,
          personId: suspendedAdmin.id,
          roles: ["ADMIN"],
          permissions: [],
          suspendedAt: new Date()
        }
      });
      const minor = await seedPerson({
        firstName: "Minor",
        lastName: "UnderSuspendedAdmin",
        ageGateLevel: "CHILD",
        email: "minor.undersuspendedadmin@example.com"
      });
      await db.familyMember.create({
        data: { familyGroupId: guardianFamily.id, personId: minor.id, roles: [], permissions: [] }
      });
      const { admin: requestingAdmin, familyGroup: requestingFamily } = await seedFamilyWithAdmin();
      const { request } = await createMembershipRequest({
        familyGroupId: requestingFamily.id,
        direction: "PULL",
        requester: { id: requestingAdmin.id },
        target: { personId: minor.id }
      });

      expect(await canConsentMembership(request, { id: suspendedAdmin.id })).toBe(false);
    });
  });

  describe("3. canConsentMembership grants the correct guardian authority", () => {
    it("returns true for an ADULT, non-suspended ADMIN of a family the minor belongs to", async () => {
      const { admin: guardianAdmin, familyGroup: guardianFamily } = await seedFamilyWithAdmin();
      const minor = await seedPerson({
        firstName: "Minor",
        lastName: "InFamily",
        ageGateLevel: "TEEN",
        email: "minor.infamily@example.com"
      });
      await db.familyMember.create({
        data: { familyGroupId: guardianFamily.id, personId: minor.id, roles: [], permissions: [] }
      });
      const { admin: requestingAdmin, familyGroup: requestingFamily } = await seedFamilyWithAdmin();
      const { request } = await createMembershipRequest({
        familyGroupId: requestingFamily.id,
        direction: "PULL",
        requester: { id: requestingAdmin.id },
        target: { personId: minor.id }
      });

      expect(await canConsentMembership(request, { id: guardianAdmin.id })).toBe(true);
    });

    it("family-less minor: only the ADULT guardianPersonId may consent; any other adult is refused", async () => {
      const guardian = await seedPerson({ firstName: "Guardian", lastName: "Registered" });
      const otherAdult = await seedPerson({ firstName: "Other", lastName: "Unrelated" });
      const minor = await seedPerson({
        firstName: "Minor",
        lastName: "FamilyLess",
        ageGateLevel: "CHILD",
        guardianPersonId: guardian.id,
        email: "minor.familyless@example.com"
      });
      const { admin: requestingAdmin, familyGroup: requestingFamily } = await seedFamilyWithAdmin();
      const { request } = await createMembershipRequest({
        familyGroupId: requestingFamily.id,
        direction: "PULL",
        requester: { id: requestingAdmin.id },
        target: { personId: minor.id }
      });

      expect(await canConsentMembership(request, { id: guardian.id })).toBe(true);
      expect(await canConsentMembership(request, { id: otherAdult.id })).toBe(false);
    });
  });

  describe("4. a DOB-unknown passive TOKEN adult requires attestation", () => {
    it("throws AttestationRequired without attestedAdult; succeeds with attestedAdult:true", async () => {
      const { admin, familyGroup } = await seedFamilyWithAdmin();
      const target = await seedPerson({
        firstName: "Unknown",
        lastName: "Age",
        ageGateLevel: "ADULT",
        email: "unknown.age@example.com",
        dateOfBirth: null
      });

      await expect(
        createMembershipRequest({
          familyGroupId: familyGroup.id,
          direction: "PULL",
          requester: { id: admin.id },
          target: { personId: target.id }
        })
      ).rejects.toThrow(AttestationRequired);

      const { request } = await createMembershipRequest({
        familyGroupId: familyGroup.id,
        direction: "PULL",
        requester: { id: admin.id },
        target: { personId: target.id },
        attestedAdult: true
      });

      expect(request.attestedAdult).toBe(true);
      expect(request.token).not.toBeNull();
    });
  });

  describe("5. attestedAdult cannot promote a known minor onto the token path", () => {
    it("a known minor with attestedAdult:true still gets no token", async () => {
      const { admin, familyGroup } = await seedFamilyWithAdmin();
      const minor = await seedPerson({
        firstName: "Minor",
        lastName: "Attested",
        ageGateLevel: "TEEN",
        phone: "+15551234567"
      });

      const { request } = await createMembershipRequest({
        familyGroupId: familyGroup.id,
        direction: "PULL",
        requester: { id: admin.id },
        target: { personId: minor.id },
        attestedAdult: true
      });

      expect(request.token).toBeNull();
      expect(request.consentChannel).toBe("IN_APP");
    });
  });
});
