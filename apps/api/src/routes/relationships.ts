import { Router, type Request } from "express";
import { z } from "zod";
import { db, RECIPROCAL_TYPES } from "@famlink/db";
import type { AuthedRequest } from "../middleware/requireAuth";

/** All 19 directed relationship types (ADR-04 registry). */
const RelationshipTypeSchema = z.enum([
  "SPOUSE",
  "PARTNER",
  "EX_SPOUSE",
  "PARENT",
  "CHILD",
  "STEP_PARENT",
  "STEP_CHILD",
  "ADOPTIVE_PARENT",
  "ADOPTIVE_CHILD",
  "SIBLING",
  "HALF_SIBLING",
  "STEP_SIBLING",
  "GRANDPARENT",
  "GRANDCHILD",
  "AUNT_UNCLE",
  "NIECE_NEPHEW",
  "COUSIN",
  "CAREGIVER",
  "GUARDIAN",
  "FAMILY_FRIEND"
]);

const CreateRelationshipSchema = z.object({
  fromPersonId: z.string().min(1),
  toPersonId: z.string().min(1),
  type: RelationshipTypeSchema,
  notes: z.string().optional()
});

const familyIdParam = z.object({
  familyId: z.string().min(1)
});

const personIdParam = z.object({
  personId: z.string().min(1)
});

const relationshipIdParam = z.object({
  relationshipId: z.string().min(1)
});

function authed(req: Request): AuthedRequest {
  return req as unknown as AuthedRequest;
}

async function personForClerkUserId(clerkUserId: string) {
  return db.person.findUnique({ where: { userId: clerkUserId } });
}

async function isFamilyMember(personId: string, familyGroupId: string): Promise<boolean> {
  const m = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId, personId } }
  });
  return m !== null;
}

async function shareAtLeastOneFamilyGroup(personIdA: string, personIdB: string): Promise<boolean> {
  const row = await db.familyMember.findFirst({
    where: {
      personId: personIdA,
      familyGroup: { members: { some: { personId: personIdB } } }
    }
  });
  return row !== null;
}

function personSummary(p: {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  ageGateLevel: string;
}) {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    preferredName: p.preferredName,
    ageGateLevel: p.ageGateLevel
  };
}

function serializeRelationship(r: {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  type: string;
  familyGroupId: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    fromPersonId: r.fromPersonId,
    toPersonId: r.toPersonId,
    type: r.type,
    familyGroupId: r.familyGroupId,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString()
  };
}

/** POST + GET /api/v1/families/:familyId/relationships */
export const familyRelationshipsRouter = Router();

familyRelationshipsRouter.post("/:familyId/relationships", async (req, res) => {
  const p = familyIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid family id", details: p.error.flatten() });
    return;
  }
  const { familyId } = p.data;

  const parsed = CreateRelationshipSchema.safeParse(req.body);
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

  if (!(await isFamilyMember(requester.id, familyId))) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  const { fromPersonId, toPersonId, type, notes } = parsed.data;

  if (fromPersonId === toPersonId) {
    res.status(400).json({ error: "fromPersonId and toPersonId must differ" });
    return;
  }

  const [fromOk, toOk] = await Promise.all([
    isFamilyMember(fromPersonId, familyId),
    isFamilyMember(toPersonId, familyId)
  ]);
  if (!fromOk || !toOk) {
    res.status(400).json({ error: "Both persons must be family members" });
    return;
  }

  const reciprocalType = RECIPROCAL_TYPES[type] ?? null;

  try {
    const result = await db.$transaction(async (tx) => {
      const relationship = await tx.relationship.create({
        data: {
          fromPersonId,
          toPersonId,
          type,
          familyGroupId: familyId,
          notes: notes ?? null
        }
      });

      let reciprocal: typeof relationship | null = null;
      if (reciprocalType !== null) {
        reciprocal = await tx.relationship.create({
          data: {
            fromPersonId: toPersonId,
            toPersonId: fromPersonId,
            type: reciprocalType,
            familyGroupId: familyId,
            notes: notes ?? null
          }
        });
      }

      return { relationship, reciprocal };
    });

    res.status(201).json({
      relationship: serializeRelationship(result.relationship),
      reciprocal: result.reciprocal ? serializeRelationship(result.reciprocal) : null
    });
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: string }).code : "";
    if (code === "P2002") {
      res.status(409).json({ error: "Relationship already exists" });
      return;
    }
    throw e;
  }
});

familyRelationshipsRouter.get("/:familyId/relationships", async (req, res) => {
  const p = familyIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid family id", details: p.error.flatten() });
    return;
  }
  const { familyId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: "Complete onboarding before creating a family" });
    return;
  }

  if (!(await isFamilyMember(requester.id, familyId))) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  const rows = await db.relationship.findMany({
    where: { familyGroupId: familyId },
    include: {
      fromPerson: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          ageGateLevel: true,
          profilePhotoUrl: true
        }
      },
      toPerson: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          ageGateLevel: true,
          profilePhotoUrl: true
        }
      }
    },
    orderBy: [{ createdAt: "asc" }]
  });

  res.json(
    rows.map((r) => ({
      ...serializeRelationship(r),
      fromPerson: personSummary(r.fromPerson),
      toPerson: personSummary(r.toPerson)
    }))
  );
});

/** GET /api/v1/persons/:personId/relationships — mount this router before personsRouter. */
export const personRelationshipsRouter = Router();

personRelationshipsRouter.get("/:personId/relationships", async (req, res) => {
  const p = personIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid person id", details: p.error.flatten() });
    return;
  }
  const { personId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: "Complete onboarding before creating a family" });
    return;
  }

  if (!(await shareAtLeastOneFamilyGroup(requester.id, personId))) {
    res.status(403).json({ error: "Not authorized to view this person's relationships" });
    return;
  }

  const rows = await db.relationship.findMany({
    where: {
      fromPersonId: personId,
      familyGroup: {
        members: { some: { personId: requester.id } }
      }
    },
    include: {
      toPerson: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          ageGateLevel: true
        }
      }
    },
    orderBy: [{ createdAt: "asc" }]
  });

  res.json(
    rows.map((r) => ({
      ...serializeRelationship(r),
      relatedPerson: {
        displayName:
          r.toPerson.preferredName?.trim() ||
          `${r.toPerson.firstName} ${r.toPerson.lastName}`.trim(),
        ageGateLevel: r.toPerson.ageGateLevel
      }
    }))
  );
});

/** DELETE /api/v1/relationships/:relationshipId */
export const relationshipsRouter = Router();

relationshipsRouter.delete("/:relationshipId", async (req, res) => {
  const p = relationshipIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid relationship id", details: p.error.flatten() });
    return;
  }
  const { relationshipId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: "Complete onboarding before creating a family" });
    return;
  }

  const rel = await db.relationship.findUnique({
    where: { id: relationshipId }
  });
  if (!rel) {
    res.status(404).json({ error: "Relationship not found" });
    return;
  }

  if (!(await isFamilyMember(requester.id, rel.familyGroupId))) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  await db.$transaction(async (tx) => {
    const reciprocal = await tx.relationship.findFirst({
      where: {
        fromPersonId: rel.toPersonId,
        toPersonId: rel.fromPersonId,
        familyGroupId: rel.familyGroupId
      }
    });

    await tx.relationship.delete({ where: { id: rel.id } });
    if (reciprocal) {
      await tx.relationship.delete({ where: { id: reciprocal.id } });
    }
  });

  res.status(204).send();
});
