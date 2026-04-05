import { Router, type Request } from "express";
import { z } from "zod";
import { db, type Person } from "@famlink/db";
import type { AuthedRequest } from "../middleware/requireAuth";

export const personsRouter = Router();

const ageGateEnum = z.enum(["NONE", "YOUNG_ADULT", "MINOR"]);

const isoDateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date YYYY-MM-DD")
  .optional();

export const CreatePersonSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  preferredName: z.string().min(1).optional(),
  dateOfBirth: isoDateOnly,
  ageGateLevel: ageGateEnum.optional().default("NONE"),
  /** Prisma `@default(cuid())` ids must not use Zod `cuid()` — formats can differ. */
  guardianPersonId: z.string().min(1).optional(),
  profilePhotoUrl: z.string().url().optional()
});

export const UpdatePersonSchema = CreatePersonSchema.partial();

const personIdParamSchema = z.object({
  personId: z.string().min(1)
});

function parseDateOnly(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error("Invalid dateOfBirth"), { status: 400 });
  }
  return d;
}

function serializePerson(
  person: Person,
  includeGuardianId: boolean
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: person.id,
    userId: person.userId,
    firstName: person.firstName,
    lastName: person.lastName,
    preferredName: person.preferredName,
    dateOfBirth: person.dateOfBirth
      ? person.dateOfBirth.toISOString().slice(0, 10)
      : null,
    ageGateLevel: person.ageGateLevel,
    profilePhotoUrl: person.profilePhotoUrl,
    createdAt: person.createdAt.toISOString(),
    updatedAt: person.updatedAt.toISOString()
  };
  if (includeGuardianId) {
    base.guardianPersonId = person.guardianPersonId;
  }
  return base;
}

async function personForClerkUserId(clerkUserId: string): Promise<Person | null> {
  return db.person.findUnique({ where: { userId: clerkUserId } });
}

async function shareAtLeastOneFamilyGroup(
  personIdA: string,
  personIdB: string
): Promise<boolean> {
  const row = await db.familyMember.findFirst({
    where: {
      personId: personIdA,
      familyGroup: {
        members: { some: { personId: personIdB } }
      }
    }
  });
  return row !== null;
}

/** Admin or organizer in a family group that includes both people. */
async function isAdminOfSharedFamilyWithTarget(
  requesterPersonId: string,
  targetPersonId: string
): Promise<boolean> {
  const row = await db.familyMember.findFirst({
    where: {
      personId: requesterPersonId,
      familyGroup: { members: { some: { personId: targetPersonId } } },
      OR: [{ roles: { has: "ADMIN" } }, { roles: { has: "ORGANIZER" } }]
    }
  });
  return row !== null;
}

function authed(req: Request): AuthedRequest {
  return req as unknown as AuthedRequest;
}

personsRouter.get("/me", async (req, res) => {
  const { userId } = authed(req);
  const person = await personForClerkUserId(userId);
  if (!person) {
    res.status(404).json({
      error: "Person record not found — complete onboarding"
    });
    return;
  }
  res.json(serializePerson(person, true));
});

personsRouter.get("/me/families", async (req, res) => {
  const { userId } = authed(req);
  const me = await personForClerkUserId(userId);
  if (!me) {
    res.status(404).json({
      error: "Person record not found — complete onboarding"
    });
    return;
  }

  const memberships = await db.familyMember.findMany({
    where: { personId: me.id },
    include: { familyGroup: true },
    orderBy: { joinedAt: "asc" }
  });

  const payload = memberships.map((m) => ({
    familyGroup: {
      id: m.familyGroup.id,
      name: m.familyGroup.name,
      aiEnabled: m.familyGroup.aiEnabled,
      defaultVisibility: m.familyGroup.defaultVisibility,
      createdAt: m.familyGroup.createdAt.toISOString(),
      updatedAt: m.familyGroup.updatedAt.toISOString()
    },
    role: m.roles[0] ?? "MEMBER",
    roles: m.roles,
    joinedAt: m.joinedAt.toISOString()
  }));

  res.json(payload);
});

personsRouter.post("/", async (req, res) => {
  const parsed = CreatePersonSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten()
    });
    return;
  }

  const data = parsed.data;
  let dateOfBirth: Date | undefined;
  try {
    dateOfBirth = parseDateOnly(data.dateOfBirth);
  } catch (e) {
    const status = typeof e === "object" && e !== null && "status" in e ? (e as { status: number }).status : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : "Bad request" });
    return;
  }

  const { userId } = authed(req);
  const requesterPerson = await personForClerkUserId(userId);
  /** First Person for this Clerk user (onboarding) — link account. Otherwise create a family member without login (userId null). */
  const linkToClerk = requesterPerson === null;

  const created = await db.person.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      preferredName: data.preferredName,
      dateOfBirth,
      ageGateLevel: data.ageGateLevel ?? "NONE",
      guardianPersonId: data.guardianPersonId,
      profilePhotoUrl: data.profilePhotoUrl,
      userId: linkToClerk ? userId : null
    }
  });

  res.status(201).json(serializePerson(created, true));
});

personsRouter.get("/:personId", async (req, res) => {
  const paramParsed = personIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    res.status(400).json({
      error: "Invalid person id",
      details: paramParsed.error.flatten()
    });
    return;
  }
  const { personId } = paramParsed.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(404).json({
      error: "Person record not found — complete onboarding"
    });
    return;
  }

  const person = await db.person.findUnique({ where: { id: personId } });
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }

  const shared = await shareAtLeastOneFamilyGroup(requester.id, person.id);
  if (!shared) {
    res.status(403).json({ error: "Not authorized to view this person" });
    return;
  }

  const isGuardian = person.guardianPersonId === requester.id;
  const isAdmin = await isAdminOfSharedFamilyWithTarget(requester.id, person.id);
  const includeGuardian = isGuardian || isAdmin;

  res.json(serializePerson(person, includeGuardian));
});

personsRouter.put("/:personId", async (req, res) => {
  const paramParsed = personIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    res.status(400).json({
      error: "Invalid person id",
      details: paramParsed.error.flatten()
    });
    return;
  }
  const { personId } = paramParsed.data;

  const parsed = UpdatePersonSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten()
    });
    return;
  }

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(404).json({
      error: "Person record not found — complete onboarding"
    });
    return;
  }

  const existing = await db.person.findUnique({ where: { id: personId } });
  if (!existing) {
    res.status(404).json({ error: "Person not found" });
    return;
  }

  const isSelf = existing.userId !== null && existing.userId === userId;
  const isAdmin =
    !isSelf &&
    (await isAdminOfSharedFamilyWithTarget(requester.id, existing.id));

  if (!isSelf && !isAdmin) {
    res.status(403).json({ error: "Not authorized to update this person" });
    return;
  }

  const data = parsed.data;
  let dateOfBirth: Date | null | undefined = undefined;
  if (data.dateOfBirth !== undefined) {
    if (data.dateOfBirth === null || data.dateOfBirth === "") {
      dateOfBirth = null;
    } else {
      try {
        dateOfBirth = parseDateOnly(data.dateOfBirth);
      } catch (e) {
        const status =
          typeof e === "object" && e !== null && "status" in e
            ? (e as { status: number }).status
            : 500;
        res.status(status).json({ error: e instanceof Error ? e.message : "Bad request" });
        return;
      }
    }
  }

  const updateData: Parameters<typeof db.person.update>[0]["data"] = {};
  if (data.firstName !== undefined) updateData.firstName = data.firstName;
  if (data.lastName !== undefined) updateData.lastName = data.lastName;
  if (data.preferredName !== undefined) updateData.preferredName = data.preferredName;
  if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth;
  if (data.ageGateLevel !== undefined) updateData.ageGateLevel = data.ageGateLevel;
  if (data.guardianPersonId !== undefined) updateData.guardianPersonId = data.guardianPersonId;
  if (data.profilePhotoUrl !== undefined) updateData.profilePhotoUrl = data.profilePhotoUrl;

  const updated = await db.person.update({
    where: { id: personId },
    data: updateData
  });

  const isGuardian = updated.guardianPersonId === requester.id;
  const isAdminForGuardianField = await isAdminOfSharedFamilyWithTarget(
    requester.id,
    updated.id
  );
  const includeGuardian = isGuardian || isAdminForGuardianField;

  res.json(serializePerson(updated, includeGuardian));
});
