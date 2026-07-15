import { Router, type NextFunction } from "express";
import { z } from "zod";
import { db, type Household } from "@famlink/db";
import { activeFamilyMembership, hasAdminRole } from "../lib/familyAccess";
import {
  anyLinkedMembership,
  householdAdmin,
  householdViewer,
  linkedFamilies,
  writeHouseholdAudit
} from "../lib/householdAccess";
import { personed } from "../middleware/requireAuth";

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

const UnlinkHouseholdSchema = z.object({
  familyGroupId: z.string().min(1),
  destroy: z.boolean().optional()
});

const householdIdParam = z.object({
  householdId: z.string().min(1)
});

const householdMemberParam = z.object({
  householdId: z.string().min(1),
  personId: z.string().min(1)
});

/** Thrown inside the unlink transaction when the named link doesn't exist; mapped to 404. */
class LinkNotFound extends Error {}
/** Thrown inside the unlink transaction when unlinking the household's last family link
 *  without `destroy: true`; mapped to 409 LAST_LINK. */
class LastLink extends Error {}

function buildDisplayName(person: {
  firstName: string;
  lastName: string;
  preferredName: string | null;
}): string {
  return person.preferredName ?? `${person.firstName} ${person.lastName}`;
}

/**
 * The requester's active membership (in any family linked to this household) whose family
 * grants admin rights — fetches ALL active linked memberships and picks the first admin one
 * (NOT findFirst-by-joinedAt, which can land on a non-admin membership and wrongly reject a
 * legitimate admin). Returns the familyGroupId of that membership, or null.
 */
async function actorAdminFamily(householdId: string, personId: string): Promise<string | null> {
  const memberships = await db.familyMember.findMany({
    where: { personId, suspendedAt: null, familyGroup: { householdLinks: { some: { householdId } } } },
    orderBy: { joinedAt: "asc" }
  });
  const admin = memberships.find((m) => hasAdminRole(m));
  return admin ? admin.familyGroupId : null;
}

// anyLinkedMembership (the requester's first active membership in ANY family linked to this
// household, admin or not) is imported from householdAccess.ts — see Fix 1 there. Used to
// (a) validate that a target person is eligible to join the household, and (b) resolve
// `actorFamilyGroupId` for self-removal by a plain member (actorAdminFamily returns null for
// non-admins and would wrongly break self-removal).

async function householdResponsePayload(household: Household, viewerPersonId: string) {
  const [families, members] = await Promise.all([
    linkedFamilies(household.id, viewerPersonId),
    db.householdMember.findMany({
      where: { householdId: household.id },
      include: { person: { select: { firstName: true, lastName: true, preferredName: true } } },
      orderBy: { joinedAt: "asc" }
    })
  ]);

  return {
    id: household.id,
    name: household.name,
    street: household.street,
    city: household.city,
    state: household.state,
    zip: household.zip,
    country: household.country,
    createdAt: household.createdAt.toISOString(),
    updatedAt: household.updatedAt.toISOString(),
    linkedFamilies: families,
    members: members.map((m) => ({
      id: m.id,
      personId: m.personId,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      displayName: buildDisplayName(m.person)
    }))
  };
}

householdsRouter.get("/:householdId", async (req, res) => {
  const p = householdIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid household id", details: p.error.flatten() });
    return;
  }
  const { householdId } = p.data;

  const requester = personed(req).person;

  const household = await db.household.findUnique({ where: { id: householdId } });
  if (!household) {
    res.status(404).json({ error: "Household not found" });
    return;
  }

  const viewer = await householdViewer(householdId, requester.id);
  if (!viewer) {
    res.status(403).json({ error: "Not a member of any family linked to this household" });
    return;
  }

  res.json(await householdResponsePayload(household, requester.id));
});

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

  const requester = personed(req).person;

  const before = await db.household.findUnique({ where: { id: householdId } });
  if (!before) {
    res.status(404).json({ error: "Household not found" });
    return;
  }

  const isAdmin = await householdAdmin(householdId, requester.id);
  if (!isAdmin) {
    res.status(403).json({ error: "Only family admins can update this household" });
    return;
  }

  const d = parsed.data;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of ["name", "street", "city", "state", "zip", "country"] as const) {
    if (d[key] !== undefined && d[key] !== before[key]) {
      changes[key] = { from: before[key], to: d[key] };
    }
  }

  // No-op guard (council BLOCKER): if nothing actually changed, skip the update entirely —
  // otherwise Prisma advances updatedAt as an unaudited mutation.
  if (Object.keys(changes).length === 0) {
    res.json(await householdResponsePayload(before, requester.id));
    return;
  }

  const actorFamilyGroupId = await actorAdminFamily(householdId, requester.id);
  if (!actorFamilyGroupId) {
    res.status(403).json({ error: "Only family admins can update this household" });
    return;
  }

  const updated = await db.$transaction(async (tx) => {
    const u = await tx.household.update({
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
    await writeHouseholdAudit(tx, {
      householdId,
      actorPersonId: requester.id,
      actorFamilyGroupId,
      action: "UPDATED",
      changes
    });
    return u;
  });

  res.json(await householdResponsePayload(updated, requester.id));
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

  const requester = personed(req).person;

  const household = await db.household.findUnique({ where: { id: householdId } });
  if (!household) {
    res.status(404).json({ error: "Household not found" });
    return;
  }

  const isAdmin = await householdAdmin(householdId, requester.id);
  if (!isAdmin) {
    res.status(403).json({ error: "Only family admins can add household members" });
    return;
  }

  const targetMembership = await anyLinkedMembership(householdId, body.data.personId);
  if (!targetMembership) {
    res.status(400).json({
      error: "Person must be a member of the family before joining this household"
    });
    return;
  }

  const actorFamilyGroupId = await actorAdminFamily(householdId, requester.id);
  if (!actorFamilyGroupId) {
    res.status(403).json({ error: "Only family admins can add household members" });
    return;
  }

  try {
    const hm = await db.$transaction(async (tx) => {
      const created = await tx.householdMember.create({
        data: {
          householdId,
          personId: body.data.personId,
          role: body.data.role
        }
      });
      await writeHouseholdAudit(tx, {
        householdId,
        actorPersonId: requester.id,
        actorFamilyGroupId,
        action: "RESIDENT_ADDED"
      });
      return created;
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

  const requester = personed(req).person;

  const household = await db.household.findUnique({ where: { id: householdId } });
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

  const isSelf = requester.id === personId;

  let actorFamilyGroupId: string | null;
  if (isSelf) {
    const membership = await anyLinkedMembership(householdId, requester.id);
    if (!membership) {
      res.status(403).json({ error: "Not a member of any family linked to this household" });
      return;
    }
    actorFamilyGroupId = membership.familyGroupId;
  } else {
    const isAdmin = await householdAdmin(householdId, requester.id);
    if (!isAdmin) {
      res.status(403).json({ error: "Not authorized to remove this household member" });
      return;
    }
    actorFamilyGroupId = await actorAdminFamily(householdId, requester.id);
    if (!actorFamilyGroupId) {
      res.status(403).json({ error: "Not authorized to remove this household member" });
      return;
    }
  }

  const auditActorFamilyGroupId: string = actorFamilyGroupId;

  await db.$transaction(async (tx) => {
    await tx.householdMember.delete({
      where: { householdId_personId: { householdId, personId } }
    });
    await writeHouseholdAudit(tx, {
      householdId,
      actorPersonId: requester.id,
      actorFamilyGroupId: auditActorFamilyGroupId,
      action: "RESIDENT_REMOVED"
    });
  });
  res.status(204).send();
});

householdsRouter.post("/:householdId/unlink", async (req, res, next: NextFunction) => {
  const p = householdIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid household id", details: p.error.flatten() });
    return;
  }
  const { householdId } = p.data;

  const body = UnlinkHouseholdSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body", details: body.error.flatten() });
    return;
  }
  const { familyGroupId, destroy } = body.data;

  const requester = personed(req).person;

  const household = await db.household.findUnique({ where: { id: householdId } });
  if (!household) {
    res.status(404).json({ error: "Household not found" });
    return;
  }

  // Admin of the family BEING UNLINKED itself — not just any linked family.
  const membership = await activeFamilyMembership(familyGroupId, requester.id);
  if (!membership || !hasAdminRole(membership)) {
    res.status(403).json({ error: "Only an admin of the family being unlinked can perform this action" });
    return;
  }

  try {
    await db.$transaction(async (tx) => {
      // Serialize the min-1 check: lock the household row first so two concurrent unlinks on a
      // two-link household can't both observe count 2 and leave the household tenantless.
      await tx.$queryRaw`SELECT "id" FROM "Household" WHERE "id" = ${householdId} FOR UPDATE`;

      // Verify the named link exists BEFORE anything else (council BLOCKER): without this, an
      // admin of an unrelated family could pass destroy:true with their OWN family id against a
      // single-linked household and delete another tenant's household.
      const link = await tx.householdFamily.findUnique({
        where: { householdId_familyGroupId: { householdId, familyGroupId } }
      });
      if (!link) throw new LinkNotFound();

      const count = await tx.householdFamily.count({ where: { householdId } });
      if (count === 1 && !destroy) throw new LastLink();

      if (count === 1 && destroy) {
        await writeHouseholdAudit(tx, {
          householdId,
          actorPersonId: requester.id,
          actorFamilyGroupId: familyGroupId,
          action: "DESTROYED"
        });
        // count===1 && destroy is the ONLY branch that deletes the household; a destroy:true
        // request against a multi-link household deliberately degrades to a plain unlink below
        // (min-1 rule preserved, no tenant left with zero linked families) — per plan.
        // Cascades HouseholdMember + HouseholdFamily; HouseholdAuditEntry rows persist by design.
        await tx.household.delete({ where: { id: householdId } });
        return;
      }

      // Plain-unlink branch: reached only when count > 1 (count===1 is fully handled above,
      // either LastLink or destroy). The household survives with at least one remaining link.
      await tx.householdFamily.delete({ where: { id: link.id } });
      await writeHouseholdAudit(tx, {
        householdId,
        actorPersonId: requester.id,
        actorFamilyGroupId: familyGroupId,
        action: "UNLINKED"
      });

      // Cascade-remove residents stranded by this unlink: a HouseholdMember whose access came
      // ONLY via the family just unlinked (active member of familyGroupId, and NOT an active
      // member of any family still linked to the household post-delete) can no longer see or
      // leave the household. Narrow by design: a resident who fails householdViewer for some
      // OTHER reason is left untouched — only losses caused by THIS unlink are cleaned up.
      const residents = await tx.householdMember.findMany({
        where: { householdId },
        select: { personId: true }
      });
      if (residents.length > 0) {
        const residentPersonIds = residents.map((r) => r.personId);
        const relevantMemberships = await tx.familyMember.findMany({
          where: {
            personId: { in: residentPersonIds },
            suspendedAt: null,
            OR: [{ familyGroupId }, { familyGroup: { householdLinks: { some: { householdId } } } }]
          },
          select: { personId: true, familyGroupId: true }
        });
        const inUnlinkedFamily = new Set<string>();
        const inRemainingFamily = new Set<string>();
        for (const m of relevantMemberships) {
          if (m.familyGroupId === familyGroupId) inUnlinkedFamily.add(m.personId);
          else inRemainingFamily.add(m.personId);
        }
        const strandedPersonIds = residentPersonIds.filter(
          (id) => inUnlinkedFamily.has(id) && !inRemainingFamily.has(id)
        );
        if (strandedPersonIds.length > 0) {
          await tx.householdMember.deleteMany({
            where: { householdId, personId: { in: strandedPersonIds } }
          });
          for (const personId of strandedPersonIds) {
            await writeHouseholdAudit(tx, {
              householdId,
              actorPersonId: requester.id,
              actorFamilyGroupId: familyGroupId,
              action: "RESIDENT_REMOVED",
              changes: { personId: { from: personId, to: null } }
            });
          }
        }
      }
    });
  } catch (e: unknown) {
    if (e instanceof LinkNotFound) {
      res.status(404).json({ error: "Link not found" });
      return;
    }
    if (e instanceof LastLink) {
      res.status(409).json({ error: "LAST_LINK" });
      return;
    }
    next(e);
    return;
  }

  res.status(204).send();
});

householdsRouter.get("/:householdId/audit", async (req, res) => {
  const p = householdIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid household id", details: p.error.flatten() });
    return;
  }
  const { householdId } = p.data;

  const requester = personed(req).person;

  const household = await db.household.findUnique({ where: { id: householdId } });
  if (!household) {
    res.status(404).json({ error: "Household not found" });
    return;
  }

  const isAdmin = await householdAdmin(householdId, requester.id);
  if (!isAdmin) {
    res.status(403).json({ error: "Only family admins can view this household's audit log" });
    return;
  }

  const entries = await db.householdAuditEntry.findMany({
    where: { householdId },
    orderBy: { createdAt: "desc" }
  });

  res.json({
    entries: entries.map((e) => ({
      id: e.id,
      actorPersonId: e.actorPersonId,
      actorFamilyGroupId: e.actorFamilyGroupId,
      action: e.action,
      changes: e.changes,
      createdAt: e.createdAt.toISOString()
    }))
  });
});
