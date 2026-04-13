import { Router, type Request } from "express";
import { z } from "zod";
import { db, type Event, type EventItem } from "@famlink/db";
import { InviteScope, RSVPStatus } from "@famlink/shared";
import { hasAdminRole, hasPermission } from "../lib/familyAccess";
import { generateGuestToken } from "../lib/guestToken";
import { ERROR_PERSON_RECORD_REQUIRED } from "../lib/personRequiredMessages";
import type { AuthedRequest } from "../middleware/requireAuth";

const visibilityEnum = z.enum(["PRIVATE", "HOUSEHOLD", "FAMILY", "INVITED", "GUEST"]);

const isoDateTime = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), "Expected ISO 8601 datetime string");

const BaseEventFieldsSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  startAt: isoDateTime,
  endAt: isoDateTime.optional(),
  locationName: z.string().optional(),
  locationAddress: z.string().optional(),
  locationMapUrl: z.string().url().optional(),
  visibility: visibilityEnum.optional().default("FAMILY"),
  isRecurring: z.boolean().optional().default(false)
});

export const CreateEventSchema = BaseEventFieldsSchema.superRefine((data, ctx) => {
  if (data.endAt !== undefined) {
    const start = Date.parse(data.startAt);
    const end = Date.parse(data.endAt);
    if (end < start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endAt"],
        message: "endAt must be on or after startAt"
      });
    }
  }
});

export const UpdateEventSchema = BaseEventFieldsSchema.partial();

export const SendInvitationsSchema = z
  .object({
    scope: z.nativeEnum(InviteScope),
    personIds: z.array(z.string().min(1)).optional(),
    householdIds: z.array(z.string().min(1)).optional()
  })
  .superRefine((data, ctx) => {
    if (data.scope === InviteScope.INDIVIDUAL) {
      if (!data.personIds?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["personIds"],
          message: "personIds required for INDIVIDUAL scope"
        });
      }
    }
    if (data.scope === InviteScope.HOUSEHOLD) {
      if (!data.householdIds?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["householdIds"],
          message: "householdIds required for HOUSEHOLD scope"
        });
      }
    }
  });

const UpdateRsvpSchema = z.object({
  status: z.nativeEnum(RSVPStatus)
});

const EventItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.string().optional(),
  notes: z.string().optional(),
  assignedToPersonId: z.string().min(1).nullable().optional()
});

const familyIdParam = z.object({
  familyId: z.string().min(1)
});

const eventIdParam = z.object({
  eventId: z.string().min(1)
});

function authed(req: Request): AuthedRequest {
  return req as unknown as AuthedRequest;
}

async function personForClerkUserId(clerkUserId: string) {
  return db.person.findUnique({ where: { userId: clerkUserId } });
}

function serializeEvent(e: Event) {
  return {
    id: e.id,
    familyGroupId: e.familyGroupId,
    createdByPersonId: e.createdByPersonId,
    title: e.title,
    description: e.description,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt?.toISOString() ?? null,
    locationName: e.locationName,
    locationAddress: e.locationAddress,
    locationMapUrl: e.locationMapUrl,
    visibility: e.visibility,
    isRecurring: e.isRecurring,
    recurrenceRule: e.recurrenceRule,
    isBirthdayEvent: e.isBirthdayEvent,
    birthdayPersonId: e.birthdayPersonId,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString()
  };
}

function serializeEventItem(p: EventItem) {
  return {
    id: p.id,
    eventId: p.eventId,
    createdByPersonId: p.createdByPersonId,
    assignedToPersonId: p.assignedToPersonId,
    name: p.name,
    quantity: p.quantity,
    notes: p.notes,
    isChecklistItem: p.isChecklistItem,
    status: p.status,
    visibility: p.visibility,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString()
  };
}

async function loadEventForMember(eventId: string, requesterPersonId: string) {
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return { error: "not_found" as const };
  }
  const membership = await db.familyMember.findUnique({
    where: {
      familyGroupId_personId: { familyGroupId: event.familyGroupId, personId: requesterPersonId }
    }
  });
  if (!membership) {
    return { error: "forbidden" as const };
  }
  return { event, membership };
}

/** POST /api/v1/families/:familyId/events */
export const familyEventsRouter = Router();

familyEventsRouter.post("/:familyId/events", async (req, res) => {
  const p = familyIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid family id", details: p.error.flatten() });
    return;
  }
  const { familyId } = p.data;

  const parsed = CreateEventSchema.safeParse(req.body);
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
    res.status(403).json({ error: "Not authorized to create events" });
    return;
  }

  const d = parsed.data;
  const startAt = new Date(d.startAt);
  const endAt = d.endAt !== undefined ? new Date(d.endAt) : null;

  const created = await db.event.create({
    data: {
      familyGroupId: familyId,
      createdByPersonId: requester.id,
      title: d.title,
      description: d.description ?? null,
      startAt,
      endAt,
      locationName: d.locationName ?? null,
      locationAddress: d.locationAddress ?? null,
      locationMapUrl: d.locationMapUrl ?? null,
      visibility: d.visibility ?? "FAMILY",
      isRecurring: d.isRecurring ?? false
    }
  });

  res.status(201).json(serializeEvent(created));
});

/** All /api/v1/events/:eventId/* routes */
export const eventsRouter = Router();

eventsRouter.get("/:eventId", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id", details: p.error.flatten() });
    return;
  }
  const { eventId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }

  const loaded = await loadEventForMember(eventId, requester.id);
  if (loaded.error === "not_found") {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (loaded.error === "forbidden") {
    res.status(403).json({ error: "Not authorized to view this event" });
    return;
  }
  const { event } = loaded;

  const [invitationCount, rsvpGroups, eventItems] = await Promise.all([
    db.eventInvitation.count({ where: { eventId } }),
    db.rSVP.groupBy({
      by: ["status"],
      where: { eventId },
      _count: { _all: true }
    }),
    db.eventItem.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" }
    })
  ]);

  const rsvps: Record<string, number> = {
    YES: 0,
    NO: 0,
    MAYBE: 0,
    PENDING: 0
  };
  for (const row of rsvpGroups) {
    const key = row.status as keyof typeof rsvps;
    if (key in rsvps) {
      rsvps[key] = row._count._all;
    }
  }

  res.json({
    event: serializeEvent(event),
    invitations: invitationCount,
    rsvps,
    eventItems: eventItems.map(serializeEventItem)
  });
});

eventsRouter.put("/:eventId", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id", details: p.error.flatten() });
    return;
  }
  const { eventId } = p.data;

  const parsed = UpdateEventSchema.safeParse(req.body);
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

  const loaded = await loadEventForMember(eventId, requester.id);
  if (loaded.error === "not_found") {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (loaded.error === "forbidden") {
    res.status(403).json({ error: "Not authorized to update this event" });
    return;
  }
  const { event } = loaded;

  const isCreator = event.createdByPersonId === requester.id;
  const membership = await db.familyMember.findUnique({
    where: {
      familyGroupId_personId: { familyGroupId: event.familyGroupId, personId: requester.id }
    }
  });
  const isAdmin = membership ? hasAdminRole(membership) : false;
  if (!isCreator && !isAdmin) {
    res.status(403).json({ error: "Only the event creator or a family admin can update this event" });
    return;
  }

  const d = parsed.data;

  const nextStart = d.startAt !== undefined ? new Date(d.startAt) : event.startAt;
  const nextEnd =
    d.endAt !== undefined ? (d.endAt ? new Date(d.endAt) : null) : event.endAt;
  if (nextEnd !== null && nextEnd < nextStart) {
    res.status(400).json({
      error: "Invalid request body",
      details: { endAt: ["endAt must be on or after startAt"] }
    });
    return;
  }

  const updated = await db.event.update({
    where: { id: eventId },
    data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.startAt !== undefined ? { startAt: new Date(d.startAt) } : {}),
      ...(d.endAt !== undefined ? { endAt: d.endAt ? new Date(d.endAt) : null } : {}),
      ...(d.locationName !== undefined ? { locationName: d.locationName } : {}),
      ...(d.locationAddress !== undefined ? { locationAddress: d.locationAddress } : {}),
      ...(d.locationMapUrl !== undefined ? { locationMapUrl: d.locationMapUrl } : {}),
      ...(d.visibility !== undefined ? { visibility: d.visibility } : {}),
      ...(d.isRecurring !== undefined ? { isRecurring: d.isRecurring } : {})
    }
  });

  res.json(serializeEvent(updated));
});

eventsRouter.delete("/:eventId", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id", details: p.error.flatten() });
    return;
  }
  const { eventId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }

  const loaded = await loadEventForMember(eventId, requester.id);
  if (loaded.error === "not_found") {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (loaded.error === "forbidden") {
    res.status(403).json({ error: "Not authorized to delete this event" });
    return;
  }
  const { event } = loaded;

  const membership = await db.familyMember.findUnique({
    where: {
      familyGroupId_personId: { familyGroupId: event.familyGroupId, personId: requester.id }
    }
  });
  const isCreator = event.createdByPersonId === requester.id;
  const isAdmin = membership ? hasAdminRole(membership) : false;
  if (!isCreator && !isAdmin) {
    res.status(403).json({ error: "Only the event creator or a family admin can delete this event" });
    return;
  }

  await db.event.delete({ where: { id: eventId } });
  res.status(204).send();
});

async function collectInvitePersonIds(
  familyGroupId: string,
  scope: InviteScope,
  personIds: string[] | undefined,
  householdIds: string[] | undefined
): Promise<{ personIds: string[]; error?: string }> {
  if (scope === InviteScope.FAMILY) {
    const members = await db.familyMember.findMany({
      where: { familyGroupId },
      select: { personId: true }
    });
    return { personIds: members.map((m) => m.personId) };
  }

  if (scope === InviteScope.INDIVIDUAL) {
    const ids = personIds ?? [];
    for (const pid of ids) {
      const m = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId, personId: pid } }
      });
      if (!m) {
        return { personIds: [], error: "All persons must be members of this family" };
      }
    }
    return { personIds: [...new Set(ids)] };
  }

  const hIds = householdIds ?? [];
  const households = await db.household.findMany({
    where: { id: { in: hIds }, familyGroupId },
    include: { members: { select: { personId: true } } }
  });
  if (households.length !== hIds.length) {
    return { personIds: [], error: "All households must belong to this family" };
  }
  const set = new Set<string>();
  for (const h of households) {
    for (const hm of h.members) {
      set.add(hm.personId);
    }
  }
  return { personIds: [...set] };
}

eventsRouter.post("/:eventId/invitations", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id", details: p.error.flatten() });
    return;
  }
  const { eventId } = p.data;

  const parsed = SendInvitationsSchema.safeParse(req.body);
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

  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const membership = await db.familyMember.findUnique({
    where: {
      familyGroupId_personId: { familyGroupId: event.familyGroupId, personId: requester.id }
    }
  });
  if (!membership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }
  if (!hasPermission(membership, "INVITE_MEMBERS")) {
    res.status(403).json({ error: "Not authorized to send invitations" });
    return;
  }

  const { scope, personIds: bodyPersonIds, householdIds } = parsed.data;
  const collected = await collectInvitePersonIds(
    event.familyGroupId,
    scope,
    bodyPersonIds,
    householdIds
  );
  if (collected.error) {
    res.status(400).json({ error: collected.error });
    return;
  }

  const targetPersonIds = collected.personIds;
  let guestTokensGenerated = 0;

  await db.$transaction(async (tx) => {
    for (const personId of targetPersonIds) {
      const existingInv = await tx.eventInvitation.findFirst({
        where: { eventId, personId }
      });
      if (!existingInv) {
        await tx.eventInvitation.create({
          data: {
            eventId,
            personId,
            scope,
            householdId: null,
            sentAt: new Date()
          }
        });
      }

      const person = await tx.person.findUnique({ where: { id: personId } });
      if (!person) {
        continue;
      }

      const existingRsvp = await tx.rSVP.findUnique({
        where: { eventId_personId: { eventId, personId } }
      });

      let token: string | null = null;
      if (person.userId === null) {
        const needNewToken = !existingRsvp?.guestToken;
        if (needNewToken) {
          token = generateGuestToken(
            {
              personId,
              scope: "RSVP",
              resourceId: eventId,
              resourceType: "EVENT"
            },
            "48h"
          );
          guestTokensGenerated += 1;
        }
      }

      if (!existingRsvp) {
        await tx.rSVP.create({
          data: {
            eventId,
            personId,
            status: RSVPStatus.PENDING,
            guestToken: token
          }
        });
      } else if (token) {
        await tx.rSVP.update({
          where: { id: existingRsvp.id },
          data: { guestToken: token }
        });
      }
    }
  });

  res.status(201).json({ invited: targetPersonIds.length, guestTokensGenerated });
});

eventsRouter.get("/:eventId/rsvps", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id", details: p.error.flatten() });
    return;
  }
  const { eventId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }

  const loaded = await loadEventForMember(eventId, requester.id);
  if (loaded.error === "not_found") {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (loaded.error === "forbidden") {
    res.status(403).json({ error: "Not authorized to view RSVPs for this event" });
    return;
  }

  const rows = await db.rSVP.findMany({
    where: { eventId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }]
  });

  const personIds = [...new Set(rows.map((r) => r.personId))];
  const persons =
    personIds.length === 0
      ? []
      : await db.person.findMany({
          where: { id: { in: personIds } },
          select: { id: true, firstName: true, lastName: true }
        });
  const nameById = new Map(persons.map((p) => [p.id, p]));

  const grouped: Record<string, Array<{ firstName: string; lastName: string; hasGuestToken: boolean }>> = {
    YES: [],
    NO: [],
    MAYBE: [],
    PENDING: []
  };

  for (const r of rows) {
    const bucket = r.status as keyof typeof grouped;
    if (!grouped[bucket]) {
      continue;
    }
    const p = nameById.get(r.personId);
    if (!p) {
      continue;
    }
    grouped[bucket].push({
      firstName: p.firstName,
      lastName: p.lastName,
      hasGuestToken: r.guestToken !== null
    });
  }

  res.json({ rsvps: grouped });
});

eventsRouter.put("/:eventId/rsvp", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id", details: p.error.flatten() });
    return;
  }
  const { eventId } = p.data;

  const parsed = UpdateRsvpSchema.safeParse(req.body);
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

  const loaded = await loadEventForMember(eventId, requester.id);
  if (loaded.error === "not_found") {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (loaded.error === "forbidden") {
    res.status(403).json({ error: "Not authorized to RSVP to this event" });
    return;
  }

  const now = new Date();
  const updated = await db.rSVP.upsert({
    where: {
      eventId_personId: { eventId, personId: requester.id }
    },
    create: {
      eventId,
      personId: requester.id,
      status: parsed.data.status,
      respondedAt: now
    },
    update: {
      status: parsed.data.status,
      respondedAt: now
    }
  });

  res.json({
    id: updated.id,
    eventId: updated.eventId,
    personId: updated.personId,
    status: updated.status,
    guestToken: updated.guestToken,
    respondedAt: updated.respondedAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString()
  });
});

eventsRouter.post("/:eventId/potluck", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id", details: p.error.flatten() });
    return;
  }
  const { eventId } = p.data;

  const parsed = z.array(EventItemSchema).safeParse(req.body);
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

  const loaded = await loadEventForMember(eventId, requester.id);
  if (loaded.error === "not_found") {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (loaded.error === "forbidden") {
    res.status(403).json({ error: "Not authorized to update potluck for this event" });
    return;
  }
  const { event } = loaded;

  const membership = await db.familyMember.findUnique({
    where: {
      familyGroupId_personId: { familyGroupId: event.familyGroupId, personId: requester.id }
    }
  });
  const isCreator = event.createdByPersonId === requester.id;
  const isAdmin = membership ? hasAdminRole(membership) : false;
  if (!isCreator && !isAdmin) {
    res.status(403).json({ error: "Only the event creator or a family admin can set potluck items" });
    return;
  }

  const items = parsed.data;
  const created = await db.$transaction(async (tx) => {
    await tx.eventItem.deleteMany({ where: { eventId } });
    if (items.length === 0) {
      return [] as EventItem[];
    }
    await tx.eventItem.createMany({
      data: items.map((row) => ({
        eventId,
        createdByPersonId: requester.id,
        assignedToPersonId: row.assignedToPersonId ?? null,
        name: row.name,
        quantity: row.quantity ?? null,
        notes: row.notes ?? null
      }))
    });
    return tx.eventItem.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" }
    });
  });

  res.json(created.map(serializeEventItem));
});
