import { Router, type Request } from "express";
import { z } from "zod";
import { db, type Person } from "@famlink/db";
import {
  CREATOR_PERMISSIONS,
  CREATOR_ROLES,
  hasAdminRole,
  hasPermission
} from "../lib/familyAccess";
import {
  ERROR_PERSON_BEFORE_CREATE_FAMILY,
  ERROR_PERSON_RECORD_REQUIRED
} from "../lib/personRequiredMessages";
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

  const requesterMembership = await db.familyMember.findUnique({
    where: {
      familyGroupId_personId: { familyGroupId: familyId, personId: requester.id }
    }
  });
  if (!requesterMembership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }
  if (!hasPermission(requesterMembership, "INVITE_MEMBERS")) {
    res.status(403).json({ error: "Not authorized to invite members" });
    return;
  }

  const targetPerson = await db.person.findUnique({ where: { id: body.data.personId } });
  if (!targetPerson) {
    res.status(400).json({ error: "Person not found" });
    return;
  }

  try {
    const member = await db.familyMember.create({
      data: {
        familyGroupId: familyId,
        personId: body.data.personId,
        roles: body.data.roles,
        permissions: body.data.permissions
      }
    });
    res.status(201).json({
      id: member.id,
      familyGroupId: member.familyGroupId,
      personId: member.personId,
      roles: member.roles,
      permissions: member.permissions,
      joinedAt: member.joinedAt.toISOString()
    });
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: string }).code : "";
    if (code === "P2002") {
      res.status(400).json({ error: "Person is already a member of this family" });
      return;
    }
    throw e;
  }
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

  const requesterMembership = await db.familyMember.findUnique({
    where: {
      familyGroupId_personId: { familyGroupId: familyId, personId: requester.id }
    }
  });
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

  const membership = await db.familyMember.findUnique({
    where: {
      familyGroupId_personId: { familyGroupId: familyId, personId: requester.id }
    }
  });
  if (!membership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }
  if (!hasPermission(membership, "CREATE_EVENTS")) {
    res.status(403).json({ error: "Not authorized to create households" });
    return;
  }

  const data = parsed.data;
  const household = await db.household.create({
    data: {
      familyGroupId: familyId,
      name: data.name,
      street: data.street,
      city: data.city,
      state: data.state,
      zip: data.zip,
      country: data.country ?? "US"
    }
  });

  res.status(201).json({
    id: household.id,
    familyGroupId: household.familyGroupId,
    name: household.name,
    street: household.street,
    city: household.city,
    state: household.state,
    zip: household.zip,
    country: household.country,
    createdAt: household.createdAt.toISOString(),
    updatedAt: household.updatedAt.toISOString()
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
      members: { some: { personId: requester.id } }
    },
    include: {
      members: {
        include: { person: true },
        orderBy: { joinedAt: "asc" }
      },
      households: {
        include: {
          members: {
            include: { person: true },
            orderBy: { joinedAt: "asc" }
          }
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!family) {
    res.status(403).json({ error: "Not authorized to view this family" });
    return;
  }

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
    households: family.households.map((h) => ({
      household: {
        id: h.id,
        familyGroupId: h.familyGroupId,
        name: h.name,
        street: h.street,
        city: h.city,
        state: h.state,
        zip: h.zip,
        country: h.country,
        createdAt: h.createdAt.toISOString(),
        updatedAt: h.updatedAt.toISOString()
      },
      members: h.members.map((hm) => serializePersonBrief(hm.person))
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

  const membership = await db.familyMember.findUnique({
    where: {
      familyGroupId_personId: { familyGroupId: familyId, personId: requester.id }
    }
  });
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
