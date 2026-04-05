import { Router, type Request } from "express";
import { z } from "zod";
import { db } from "@famlink/db";
import { hasAdminRole } from "../lib/familyAccess";
import type { AuthedRequest } from "../middleware/requireAuth";

export const householdsRouter = Router();

const CreateHouseholdSchema = z.object({
  name: z.string().min(1),
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional().default("US")
});

const UpdateHouseholdSchema = CreateHouseholdSchema.partial();

const AddHouseholdMemberSchema = z.object({
  personId: z.string().min(1),
  role: z.string().optional()
});

const householdIdParam = z.object({
  householdId: z.string().min(1)
});

const householdMemberParam = z.object({
  householdId: z.string().min(1),
  personId: z.string().min(1)
});

function authed(req: Request): AuthedRequest {
  return req as unknown as AuthedRequest;
}

async function personForClerkUserId(userId: string) {
  return db.person.findUnique({ where: { userId } });
}

async function loadHouseholdWithFamily(householdId: string) {
  return db.household.findUnique({
    where: { id: householdId },
    include: { familyGroup: true }
  });
}

householdsRouter.put("/:householdId", async (req, res) => {
  const p = householdIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid household id", details: p.error.flatten() });
    return;
  }
  const { householdId } = p.data;

  const parsed = UpdateHouseholdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: "Complete onboarding before creating a family" });
    return;
  }

  const household = await loadHouseholdWithFamily(householdId);
  if (!household) {
    res.status(404).json({ error: "Household not found" });
    return;
  }

  const membership = await db.familyMember.findUnique({
    where: {
      familyGroupId_personId: {
        familyGroupId: household.familyGroupId,
        personId: requester.id
      }
    }
  });
  if (!membership || !hasAdminRole(membership)) {
    res.status(403).json({ error: "Only family admins can update this household" });
    return;
  }

  const d = parsed.data;
  const updated = await db.household.update({
    where: { id: householdId },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.street !== undefined ? { street: d.street } : {}),
      ...(d.city !== undefined ? { city: d.city } : {}),
      ...(d.state !== undefined ? { state: d.state } : {}),
      ...(d.zip !== undefined ? { zip: d.zip } : {}),
      ...(d.country !== undefined ? { country: d.country } : {})
    }
  });

  res.json({
    id: updated.id,
    familyGroupId: updated.familyGroupId,
    name: updated.name,
    street: updated.street,
    city: updated.city,
    state: updated.state,
    zip: updated.zip,
    country: updated.country,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString()
  });
});

householdsRouter.post("/:householdId/members", async (req, res) => {
  const p = householdIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid household id", details: p.error.flatten() });
    return;
  }
  const { householdId } = p.data;

  const body = AddHouseholdMemberSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body", details: body.error.flatten() });
    return;
  }

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: "Complete onboarding before creating a family" });
    return;
  }

  const household = await loadHouseholdWithFamily(householdId);
  if (!household) {
    res.status(404).json({ error: "Household not found" });
    return;
  }

  const requesterMembership = await db.familyMember.findUnique({
    where: {
      familyGroupId_personId: {
        familyGroupId: household.familyGroupId,
        personId: requester.id
      }
    }
  });
  if (!requesterMembership || !hasAdminRole(requesterMembership)) {
    res.status(403).json({ error: "Only family admins can add household members" });
    return;
  }

  const familyMembership = await db.familyMember.findUnique({
    where: {
      familyGroupId_personId: {
        familyGroupId: household.familyGroupId,
        personId: body.data.personId
      }
    }
  });
  if (!familyMembership) {
    res.status(400).json({
      error: "Person must be a member of the family before joining this household"
    });
    return;
  }

  try {
    const hm = await db.householdMember.create({
      data: {
        householdId,
        personId: body.data.personId,
        role: body.data.role
      }
    });
    res.status(201).json({
      id: hm.id,
      householdId: hm.householdId,
      personId: hm.personId,
      role: hm.role,
      joinedAt: hm.joinedAt.toISOString()
    });
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: string }).code : "";
    if (code === "P2002") {
      res.status(400).json({ error: "Person is already in this household" });
      return;
    }
    throw e;
  }
});

householdsRouter.delete("/:householdId/members/:personId", async (req, res) => {
  const p = householdMemberParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid parameters", details: p.error.flatten() });
    return;
  }
  const { householdId, personId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: "Complete onboarding before creating a family" });
    return;
  }

  const household = await loadHouseholdWithFamily(householdId);
  if (!household) {
    res.status(404).json({ error: "Household not found" });
    return;
  }

  const hm = await db.householdMember.findUnique({
    where: {
      householdId_personId: { householdId, personId }
    }
  });
  if (!hm) {
    res.status(404).json({ error: "Household membership not found" });
    return;
  }

  const requesterMembership = await db.familyMember.findUnique({
    where: {
      familyGroupId_personId: {
        familyGroupId: household.familyGroupId,
        personId: requester.id
      }
    }
  });
  if (!requesterMembership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  const isSelf = requester.id === personId;
  if (!hasAdminRole(requesterMembership) && !isSelf) {
    res.status(403).json({ error: "Not authorized to remove this household member" });
    return;
  }

  await db.householdMember.delete({
    where: { householdId_personId: { householdId, personId } }
  });
  res.status(204).send();
});
