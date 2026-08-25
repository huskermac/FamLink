import { Router, type Request } from "express";
import { z } from "zod";
import { db, type Person } from "@famlink/db";
import {
  activeFamilyMembership,
  CREATOR_PERMISSIONS,
  CREATOR_ROLES,
  hasAdminRole,
  hasPermission
} from "../lib/familyAccess";
import {
  ERROR_PERSON_BEFORE_CREATE_FAMILY,
  ERROR_PERSON_RECORD_REQUIRED
} from "../lib/personRequiredMessages";
import { linkedFamilies, writeHouseholdAudit } from "../lib/householdAccess";
import { isPassiveNoContact } from "../lib/linkRequest";
import type { AuthedRequest } from "../middleware/requireAuth";

export const familiesRouter = Router();

const CreateFamilySchema = z.object({
  name: z.string().min(2).max(100)
});

const visibilityEnum = z.enum([
  "PRIVATE",
  "HOUSEHOLD",
  "FAMILY",
  "INVITED",
  "GUEST"
]);

const UpdateFamilySchema = z.object({
  name: z.string().min(2).max(100).optional(),
  aiEnabled: z.boolean().optional(),
  defaultVisibility: visibilityEnum.optional()
});

const CreateHouseholdSchema = z.object({
  name: z.string().min(1),
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional().default("US")
});

const AddMemberSchema = z.object({
  personId: z.string().min(1),
  roles: z.array(z.string()).min(1),
  permissions: z.array(z.string()).default([])
});

/** Prisma `@default(cuid())` ids must not be validated with Zod `cuid()` — formats can differ. */
const familyIdParam = z.object({
  familyId: z.string().min(1)
});

const familyMemberParam = z.object({
  familyId: z.string().min(1),
  personId: z.string().min(1)
});

function authed(req: Request): AuthedRequest {
  return req as unknown as AuthedRequest;
}

async function personForClerkUserId(clerkUserId: string): Promise<Person | null> {
  return db.person.findUnique({ where: { userId: clerkUserId } });
}

function serializePersonBrief(p: Person): Record<string, unknown> {
  return {
    id: p.id,
    userId: p.userId,
    firstName: p.firstName,
    lastName: p.lastName,
    preferredName: p.preferredName,
    dateOfBirth: p.dateOfBirth ? p.dateOfBirth.toISOString().slice(0, 10) : null,
    ageGateLevel: p.ageGateLevel,
    profilePhotoUrl: p.profilePhotoUrl,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString()
  };
}

familiesRouter.post("/", async (req, res) => {
  const parsed = CreateFamilySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { userId } = authed(req);
  const person = await personForClerkUserId(userId);
  if (!person) {
    res.status(400).json({ error: ERROR_PERSON_BEFORE_CREATE_FAMILY });
    return;
  }

  const result = await db.$transaction(async (tx) => {
    const familyGroup = await tx.familyGroup.create({
      data: {
        name: parsed.data.name,
        createdById: person.id,
        aiEnabled: true,
        defaultVisibility: "FAMILY"
      }
    });
    const membership = await tx.familyMember.create({
      data: {
        familyGroupId: familyGroup.id,
        personId: person.id,
        roles: [...CREATOR_ROLES],
        permissions: [...CREATOR_PERMISSIONS]
      }
    });
    return { familyGroup, membership };
  });

  res.status(201).json({
    familyGroup: {
      id: result.familyGroup.id,
      name: result.familyGroup.name,
      createdById: result.familyGroup.createdById,
      aiEnabled: result.familyGroup.aiEnabled,
      defaultVisibility: result.familyGroup.defaultVisibility,
      createdAt: result.familyGroup.createdAt.toISOString(),
      updatedAt: result.familyGroup.updatedAt.toISOString()
    },
    membership: {
      id: result.membership.id,
      familyGroupId: result.membership.familyGroupId,
      personId: result.membership.personId,
      roles: result.membership.roles,
      permissions: result.membership.permissions,
      joinedAt: result.membership.joinedAt.toISOString()
    }
  });
});

familiesRouter.post("/:familyId/members", async (req, res) => {
  const p = familyIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid family id", details: p.error.flatten() });
    return;
  }
  const { familyId } = p.data;

  const body = AddMemberSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body", details: body.error.flatten() });
    return;
  }

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }

  const requesterMembership = await activeFamilyMembership(familyId, requester.id);
  if (!requesterMembership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }
  if (!hasPermission(requesterMembership, "INVITE_MEMBERS")) {
    res.status(403).json({ error: "Not authorized to invite members" });
    return;
  }

  // Direct add is allowed ONLY for a passive, contact-less Person that THIS family authored
  // (Person.createdByFamilyGroupId === familyId) — a provably-authored data-entry record.
  // Everything else (an active account, any contact, or a foreign/no owner) must go through
  // the link-request consent flow. The re-read and the insert run in ONE transaction, with
  // a row lock taken first, so the target cannot acquire a userId or a contact between the
  // classify check and the FamilyMember insert (TOCTOU under READ COMMITTED).
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Person" WHERE "id" = ${body.data.personId} FOR UPDATE`;
    const t = await tx.person.findUnique({ where: { id: body.data.personId } });
    if (!t) return { error: "NOT_FOUND" as const };
    const passiveNoContact = isPassiveNoContact(t);
    if (!passiveNoContact || t.createdByFamilyGroupId !== familyId) return { error: "CONSENT_REQUIRED" as const };
    try {
      const member = await tx.familyMember.create({
        data: {
          familyGroupId: familyId,
          personId: t.id,
          roles: body.data.roles,
          permissions: body.data.permissions
        }
      });
      return { member };
    } catch (e) {
      if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
        return { error: "ALREADY_MEMBER" as const };
      }
      throw e;
    }
  });

  if ("error" in result) {
    if (result.error === "NOT_FOUND") {
      res.status(400).json({ error: "Person not found" });
      return;
    }
    if (result.error === "ALREADY_MEMBER") {
      res.status(400).json({ error: "Person is already a member of this family" });
      return;
    }
    res.status(409).json({
      error: "CONSENT_REQUIRED",
      hint: "This person has an account, contact details, or a different owning family — send a link request they can accept.",
      linkRequest: {
        endpoint: "/api/v1/link-requests",
        kind: "FAMILY_MEMBERSHIP",
        direction: "PULL",
        familyGroupId: familyId,
        targetPersonId: body.data.personId
      }
    });
    return;
  }

  const { member } = result;
  res.status(201).json({
    id: member.id,
    familyGroupId: member.familyGroupId,
    personId: member.personId,
    roles: member.roles,
    permissions: member.permissions,
    joinedAt: member.joinedAt.toISOString()
  });
});

familiesRouter.delete("/:familyId/members/:personId", async (req, res) => {
  const p = familyMemberParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid parameters", details: p.error.flatten() });
    return;
  }
  const { familyId, personId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }

  const target = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId: familyId, personId } }
  });
  if (!target) {
    res.status(404).json({ error: "Membership not found" });
    return;
  }

  const requesterMembership = await activeFamilyMembership(familyId, requester.id);
  if (!requesterMembership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  const isSelf = requester.id === personId;
  if (!hasAdminRole(requesterMembership) && !isSelf) {
    res.status(403).json({ error: "Not authorized to remove this member" });
    return;
  }

  if (hasAdminRole(target)) {
    const adminCount = await db.familyMember.count({
      where: { familyGroupId: familyId, roles: { has: "ADMIN" } }
    });
    if (adminCount <= 1) {
      res.status(400).json({ error: "Cannot remove the last admin from the family" });
      return;
    }
  }

  await db.familyMember.delete({
    where: { familyGroupId_personId: { familyGroupId: familyId, personId } }
  });
  res.status(204).send();
});

familiesRouter.post("/:familyId/households", async (req, res) => {
  const p = familyIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid family id", details: p.error.flatten() });
    return;
  }
  const { familyId } = p.data;

  const parsed = CreateHouseholdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }

  const membership = await activeFamilyMembership(familyId, requester.id);
  if (!membership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }
  if (!hasPermission(membership, "CREATE_EVENTS")) {
    res.status(403).json({ error: "Not authorized to create households" });
    return;
  }

  const data = parsed.data;
  const household = await db.$transaction(async (tx) => {
    const h = await tx.household.create({
      data: {
        name: data.name,
        street: data.street,
        city: data.city,
        state: data.state,
        zip: data.zip,
        country: data.country ?? "US"
      }
    });
    await tx.householdFamily.create({
      data: { householdId: h.id, familyGroupId: familyId, linkedByPersonId: requester.id }
    });
    await writeHouseholdAudit(tx, {
      householdId: h.id,
      actorPersonId: requester.id,
      actorFamilyGroupId: familyId,
      action: "LINKED"
    });
    return h;
  });

  res.status(201).json({
    id: household.id,
    name: household.name,
    street: household.street,
    city: household.city,
    state: household.state,
    zip: household.zip,
    country: household.country,
    createdAt: household.createdAt.toISOString(),
    updatedAt: household.updatedAt.toISOString(),
    linkedFamilies: await linkedFamilies(household.id, requester.id)
  });
});

familiesRouter.get("/:familyId", async (req, res) => {
  const p = familyIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid family id", details: p.error.flatten() });
    return;
  }
  const { familyId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }

  const family = await db.familyGroup.findFirst({
    where: {
      id: familyId,
      members: { some: { personId: requester.id, suspendedAt: null } }
    },
    include: {
      members: {
        include: { person: true },
        orderBy: { joinedAt: "asc" }
      },
      householdLinks: {
        include: {
          household: {
            include: {
              members: {
                include: { person: true },
                orderBy: { joinedAt: "asc" }
              }
            }
          }
        },
        orderBy: [{ linkedAt: "asc" }, { id: "asc" }] // stable secondary order
      }
    }
  });

  if (!family) {
    res.status(403).json({ error: "Not authorized to view this family" });
    return;
  }

  // Household residents shown here are scoped to THIS family's own members (matches the
  // suspension handling of `members` above — unfiltered on suspendedAt): under the M2M model
  // a household can link to several families, and a resident who is only a member of another
  // linked family must not have their DOB/Clerk id disclosed to this family (spec §7
  // invariant 1). The household-scoped view (GET /households/:id) is where every resident
  // appears, display-names-only. This filter is NOT a no-op: DELETE /:familyId/members/:personId
  // hard-deletes the FamilyMember row while the person's HouseholdMember row survives, so a
  // person removed from the family intentionally drops out of this view immediately and
  // remains visible (and removable) via GET /households/:id — nothing is stranded (accepted
  // semantics, Steve, 2026-07-15 final review; see the Fix B regression test).
  const familyMemberPersonIds = new Set(family.members.map((m) => m.personId));

  res.json({
    familyGroup: {
      id: family.id,
      name: family.name,
      createdById: family.createdById,
      aiEnabled: family.aiEnabled,
      defaultVisibility: family.defaultVisibility,
      createdAt: family.createdAt.toISOString(),
      updatedAt: family.updatedAt.toISOString()
    },
    members: family.members.map((m) => ({
      person: serializePersonBrief(m.person),
      roles: m.roles,
      joinedAt: m.joinedAt.toISOString()
    })),
    households: family.householdLinks.map(({ household: h }) => ({
      household: {
        id: h.id,
        name: h.name,
        street: h.street,
        city: h.city,
        state: h.state,
        zip: h.zip,
        country: h.country,
        createdAt: h.createdAt.toISOString(),
        updatedAt: h.updatedAt.toISOString()
      },
      members: h.members
        .filter((hm) => familyMemberPersonIds.has(hm.personId))
        .map((hm) => serializePersonBrief(hm.person))
    }))
  });
});

familiesRouter.put("/:familyId", async (req, res) => {
  const p = familyIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid family id", details: p.error.flatten() });
    return;
  }
  const { familyId } = p.data;

  const parsed = UpdateFamilySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }

  const membership = await activeFamilyMembership(familyId, requester.id);
  if (!membership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }
  if (!hasAdminRole(membership)) {
    res.status(403).json({ error: "Only admins can update family settings" });
    return;
  }

  const d = parsed.data;
  const updated = await db.familyGroup.update({
    where: { id: familyId },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.aiEnabled !== undefined ? { aiEnabled: d.aiEnabled } : {}),
      ...(d.defaultVisibility !== undefined ? { defaultVisibility: d.defaultVisibility } : {})
    }
  });

  res.json({
    id: updated.id,
    name: updated.name,
    createdById: updated.createdById,
    aiEnabled: updated.aiEnabled,
    defaultVisibility: updated.defaultVisibility,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString()
  });
});
