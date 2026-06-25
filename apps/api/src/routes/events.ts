import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { db, type Event, type EventItem } from "@famlink/db";
import { InviteScope, RSVPStatus } from "@famlink/shared";
import { activeFamilyMembership, hasAdminRole, hasPermission } from "../lib/familyAccess";
import { personed } from "../middleware/requireAuth";
import { canViewEvent } from "../lib/eventVisibility";
import { emitEventCreated, emitRsvpUpdated, getIo } from "../lib/socketServer";
import { generateBirthdayEvents } from "../lib/birthdayGenerator";
import { getInviteeSuggestions } from "../lib/inviteeSuggestions";
import { resolveEventAccess } from "../lib/eventAccess";
import { NotificationService } from "../lib/notificationService";
import { env } from "../lib/env";

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function matchPersonByContact(email?: string, phone?: string) {
  if (!email && !phone) return null;
  return db.person.findFirst({
    where: {
      OR: [
        ...(email ? [{ email }] : []),
        ...(phone ? [{ phone }] : [])
      ]
    },
    select: { id: true }
  });
}

const visibilityEnum = z.enum(["PRIVATE", "HOUSEHOLD", "FAMILY", "INVITED", "GUEST"]);
const eventTypeEnum = z.enum(["HOLIDAY", "PARTY", "MILESTONE", "SPORTS", "SCHOOL", "OTHER"]);
const eventVisibilityEnum = z.enum(["BROADCAST", "OPEN", "PRIVATE"]);

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
  isRecurring: z.boolean().optional().default(false),
  eventType: eventTypeEnum.optional().default("OTHER"),
  eventVisibility: eventVisibilityEnum.optional().default("BROADCAST")
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
    eventType: e.eventType,
    eventVisibility: e.eventVisibility,
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
  const membership = await activeFamilyMembership(event.familyGroupId, requesterPersonId);
  if (!membership) {
    return { error: "forbidden" as const };
  }
  // PRIVATE events are fully hidden from non-invited members (decision
  // 2026-06-10) — report not_found, never reveal existence.
  if (!(await canViewEvent(event, requesterPersonId, hasAdminRole(membership)))) {
    return { error: "not_found" as const };
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

  const requester = personed(req).person;

  const membership = await activeFamilyMembership(familyId, requester.id);
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
      isRecurring: d.isRecurring ?? false,
      eventType: d.eventType ?? "OTHER",
      eventVisibility: d.eventVisibility ?? "BROADCAST"
    }
  });

  try {
    emitEventCreated(getIo(), familyId, {
      id: created.id,
      title: created.title,
      startTime: created.startAt.toISOString(),
      createdByName: `${requester.firstName} ${requester.lastName}`.trim()
    });
  } catch {
    // Socket.io not initialized (e.g. test environment) — non-fatal
  }

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

  const requester = personed(req).person;

  // Synthetic birthday events: birthday-{personId}-{year}
  const bdMatch = /^birthday-(.+)-(\d{4})$/.exec(eventId);
  if (bdMatch) {
    const birthdayPersonId = bdMatch[1];
    const year = Number(bdMatch[2]);

    const birthdayPerson = await db.person.findUnique({
      where: { id: birthdayPersonId },
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true }
    });
    if (!birthdayPerson || !birthdayPerson.dateOfBirth) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const requesterFamilies = await db.familyMember.findMany({
      where: { personId: requester.id, suspendedAt: null },
      select: { familyGroupId: true }
    });
    const requesterFamilyIds = requesterFamilies.map((m) => m.familyGroupId);

    const sharedMembership = await db.familyMember.findFirst({
      where: { personId: birthdayPersonId, familyGroupId: { in: requesterFamilyIds } }
    });
    if (!sharedMembership) {
      res.status(403).json({ error: "Not authorized to view this event" });
      return;
    }

    const [synthetic] = generateBirthdayEvents(
      [{ ...birthdayPerson, dateOfBirth: birthdayPerson.dateOfBirth.toISOString().slice(0, 10) }],
      year,
      sharedMembership.familyGroupId
    );
    if (!synthetic) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    res.json({
      event: {
        id: synthetic.id,
        familyGroupId: synthetic.familyGroupId,
        createdByPersonId: null,
        title: synthetic.title,
        description: null,
        startAt: synthetic.startAt,
        endAt: synthetic.endAt,
        locationName: null,
        locationAddress: null,
        locationMapUrl: null,
        visibility: synthetic.visibility,
        isRecurring: true,
        recurrenceRule: null,
        isBirthdayEvent: true,
        birthdayPersonId: synthetic.birthdayPersonId,
        eventType: "MILESTONE",
        eventVisibility: "BROADCAST",
        createdAt: synthetic.startAt,
        updatedAt: synthetic.startAt
      },
      invitations: 0,
      rsvps: { YES: 0, NO: 0, MAYBE: 0, PENDING: 0 },
      eventItems: []
    });
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

  const requester = personed(req).person;

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
  const membership = await activeFamilyMembership(event.familyGroupId, requester.id);
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
      ...(d.isRecurring !== undefined ? { isRecurring: d.isRecurring } : {}),
      ...(d.eventType !== undefined ? { eventType: d.eventType } : {}),
      ...(d.eventVisibility !== undefined ? { eventVisibility: d.eventVisibility } : {})
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

  const requester = personed(req).person;

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

  const membership = await activeFamilyMembership(event.familyGroupId, requester.id);
  const isCreator = event.createdByPersonId === requester.id;
  const isAdmin = membership ? hasAdminRole(membership) : false;
  if (!isCreator && !isAdmin) {
    res.status(403).json({ error: "Only the event creator or a family admin can delete this event" });
    return;
  }

  await db.event.delete({ where: { id: eventId } });
  res.status(204).send();
});

const InviteeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person"), personId: z.string() }),
  z.object({
    kind: z.literal("guest"),
    guestEmail: z.string().email().optional(),
    guestPhone: z.string().optional(),
    guestName: z.string().optional()
  }),
  z.object({
    kind: z.literal("famlinkUser"),
    personId: z.string().min(1),
    role: z.enum(["PARTICIPANT", "EVENT_ADMIN"]).optional()
  })
]);

const SendInvitationsV2Schema = z.object({
  invitees: z.array(InviteeSchema).min(1)
});

eventsRouter.post("/:eventId/invitations", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }
  const { eventId } = p.data;

  const parsed = SendInvitationsV2Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const requester = personed(req).person;

  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  if (event.eventVisibility === "BROADCAST") {
    res.status(400).json({ error: "Broadcast events include all family members automatically — no invitations needed" });
    return;
  }

  const membership = await activeFamilyMembership(event.familyGroupId, requester.id);
  if (!membership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  // PRIVATE: only organizer/admin can invite. OPEN: any member can invite.
  if (event.eventVisibility === "PRIVATE" && !hasAdminRole(membership) && event.createdByPersonId !== requester.id) {
    res.status(403).json({ error: "Only the event organizer or an admin can invite to a private event" });
    return;
  }

  // Cross-family invites require event-admin access
  const hasFamlinkUserInvite = parsed.data.invitees.some((i) => i.kind === "famlinkUser");
  if (hasFamlinkUserInvite) {
    const access = await resolveEventAccess(eventId, requester.id);
    if ("error" in access) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    if (!access.canAdmin) {
      res.status(403).json({ error: "Only an event admin can invite cross-family participants" });
      return;
    }
  }

  const now = new Date();
  const createdInvitations: object[] = [];
  const famlinkUserInvites: Array<{ linkedPersonId: string; guestToken: string }> = [];

  await db.$transaction(async (tx) => {
    for (const invitee of parsed.data.invitees) {
      if (invitee.kind === "person") {
        const existing = await tx.eventInvitation.findFirst({
          where: { eventId, personId: invitee.personId }
        });
        if (!existing) {
          const created = await tx.eventInvitation.create({
            data: {
              eventId,
              personId: invitee.personId,
              invitedById: requester.id,
              scope: "INDIVIDUAL",
              status: "PENDING",
              sentAt: now
            }
          });
          createdInvitations.push(created);
        }
      } else if (invitee.kind === "guest") {
        // External guest
        const match = await matchPersonByContact(invitee.guestEmail, invitee.guestPhone);
        const existing = await tx.eventInvitation.findFirst({
          where: {
            eventId,
            OR: [
              ...(invitee.guestEmail ? [{ guestEmail: invitee.guestEmail }] : []),
              ...(invitee.guestPhone ? [{ guestPhone: invitee.guestPhone }] : [])
            ]
          }
        });
        if (!existing) {
          const created = await tx.eventInvitation.create({
            data: {
              eventId,
              guestEmail: invitee.guestEmail ?? null,
              guestPhone: invitee.guestPhone ?? null,
              guestName: invitee.guestName ?? null,
              guestToken: generateInviteToken(),
              linkedPersonId: match?.id ?? null,
              invitedById: requester.id,
              scope: "INDIVIDUAL",
              status: "PENDING",
              sentAt: now
            }
          });
          createdInvitations.push(created);
        }
      } else if (invitee.kind === "famlinkUser") {
        const existing = await tx.eventInvitation.findFirst({ where: { eventId, linkedPersonId: invitee.personId } });
        if (!existing) {
          const token = generateInviteToken();
          const created = await tx.eventInvitation.create({
            data: {
              eventId,
              linkedPersonId: invitee.personId,
              role: invitee.role ?? "PARTICIPANT",
              guestToken: token,
              invitedById: requester.id,
              scope: "INDIVIDUAL",
              status: "PENDING",
              sentAt: now
            }
          });
          createdInvitations.push(created);
          famlinkUserInvites.push({ linkedPersonId: invitee.personId, guestToken: token });
        }
      }
    }
  });

  // Send accept-link notifications to cross-family (famlinkUser) invitees ONLY —
  // fire-and-forget, non-fatal. Guest invites (even when their contact matches an
  // existing person) must NOT trigger this notification.
  if (famlinkUserInvites.length > 0) {
    const notifier = new NotificationService();
    for (const inv of famlinkUserInvites) {
      const acceptLink = `${env.WEB_APP_URL}/events/accept?token=${inv.guestToken}`;
      notifier.send({
        type: "EVENT_INVITE",
        recipientPersonId: inv.linkedPersonId,
        title: "You've been invited to an event",
        body: `You have a new event invitation. Accept it here: ${acceptLink}`,
        data: { acceptLink }
      }).catch(() => { /* non-fatal */ });
    }
  }

  res.status(201).json({ invitations: createdInvitations });
});

eventsRouter.get("/:eventId/invitations", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }
  const { eventId } = p.data;

  const requester = personed(req).person;

  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const membership = await activeFamilyMembership(event.familyGroupId, requester.id);
  if (!membership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  if (event.eventVisibility === "PRIVATE" && !hasAdminRole(membership) && event.createdByPersonId !== requester.id) {
    res.status(403).json({ error: "Only the event organizer or an admin can view invitations for a private event" });
    return;
  }

  const invitations = await db.eventInvitation.findMany({
    where: { eventId },
    orderBy: { createdAt: "asc" }
  });

  const linkedPersonIds = invitations.map(i => i.personId).filter(Boolean) as string[];
  const persons = linkedPersonIds.length > 0
    ? await db.person.findMany({
        where: { id: { in: linkedPersonIds } },
        select: { id: true, firstName: true, lastName: true, preferredName: true, profilePhotoUrl: true }
      })
    : [];
  const personById = new Map(persons.map(p => [p.id, p]));

  res.json({
    invitations: invitations.map(inv => {
      const person = inv.personId ? personById.get(inv.personId) : undefined;
      return {
        id:             inv.id,
        personId:       inv.personId ?? null,
        displayName:    person
          ? (person.preferredName?.trim() || `${person.firstName} ${person.lastName}`.trim())
          : (inv.guestName ?? "Guest"),
        guestEmail:     inv.guestEmail ?? null,
        guestPhone:     inv.guestPhone ?? null,
        linkedPersonId: inv.linkedPersonId ?? null,
        invitedById:    inv.invitedById ?? null,
        status:         inv.status,
        sentAt:         inv.sentAt?.toISOString() ?? null,
      };
    })
  });
});

eventsRouter.get("/:eventId/invitee-suggestions", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }
  const { eventId } = p.data;

  const requester = personed(req).person;

  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const membership = await activeFamilyMembership(event.familyGroupId, requester.id);
  if (!membership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  if (event.eventVisibility === "PRIVATE" && !hasAdminRole(membership) && event.createdByPersonId !== requester.id) {
    res.status(403).json({ error: "Only the event organizer or an admin can view suggestions for a private event" });
    return;
  }

  // Collect already-invited personIds (plus requester) to exclude from suggestions
  const explicitInvites = await db.eventInvitation.findMany({
    where: { eventId, personId: { not: null } },
    select: { personId: true }
  });
  const invitedPersonIds = [
    ...explicitInvites.map(i => i.personId as string),
    requester.id
  ];

  const suggestions = await getInviteeSuggestions({
    familyGroupId: event.familyGroupId,
    invitedPersonIds
  });

  res.json({ suggestions });
});

eventsRouter.get("/:eventId/rsvps", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id", details: p.error.flatten() });
    return;
  }
  const { eventId } = p.data;

  const requester = personed(req).person;

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

  const requester = personed(req).person;

  const access = await resolveEventAccess(eventId, requester.id);
  if ("error" in access) { res.status(404).json({ error: "Event not found" }); return; }
  if (!access.canContribute) { res.status(403).json({ error: "Not authorized to RSVP to this event" }); return; }
  const { event } = access;

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

  // Fire-and-forget: notify organizer
  try {
    const organizer = await db.person.findUnique({
      where: { id: event.createdByPersonId },
      select: { userId: true }
    });
    if (organizer?.userId) {
      emitRsvpUpdated(getIo(), organizer.userId, {
        eventId,
        eventTitle: event.title,
        responderName: `${requester.firstName} ${requester.lastName}`.trim(),
        status: parsed.data.status
      });
    }
  } catch {
    // Socket.io not initialized (e.g. test environment) — non-fatal
  }

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

const ParticipationTokenSchema = z.object({ token: z.string().min(1) });

eventsRouter.post("/:eventId/participation/accept", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid event id" }); return; }
  const body = ParticipationTokenSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid request body" }); return; }
  const requester = personed(req).person;

  const inv = await db.eventInvitation.findFirst({
    where: { eventId: p.data.eventId, guestToken: body.data.token, status: "PENDING" }
  });
  // Bind to authenticated identity: the token's invitation must target THIS person.
  if (!inv || inv.linkedPersonId !== requester.id) {
    res.status(403).json({ error: "This invitation is not for your account" });
    return;
  }
  await db.$transaction(async (tx) => {
    await tx.eventParticipant.upsert({
      where: { eventId_personId: { eventId: p.data.eventId, personId: requester.id } },
      create: { eventId: p.data.eventId, personId: requester.id, role: inv.role ?? "PARTICIPANT", status: "ACTIVE", invitedById: inv.invitedById ?? null },
      update: { status: "ACTIVE", role: inv.role ?? "PARTICIPANT" }
    });
    await tx.eventInvitation.update({ where: { id: inv.id }, data: { status: "ACCEPTED" } });
  });
  res.json({ accepted: true });
});

eventsRouter.post("/:eventId/participation/decline", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid event id" }); return; }
  const body = ParticipationTokenSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid request body" }); return; }
  const requester = personed(req).person;

  const inv = await db.eventInvitation.findFirst({
    where: { eventId: p.data.eventId, guestToken: body.data.token, status: "PENDING" }
  });
  if (!inv || inv.linkedPersonId !== requester.id) {
    res.status(403).json({ error: "This invitation is not for your account" });
    return;
  }
  await db.eventInvitation.update({ where: { id: inv.id }, data: { status: "DECLINED" } });
  res.json({ declined: true });
});

const SetRoleSchema = z.object({ role: z.enum(["PARTICIPANT", "EVENT_ADMIN"]) });

eventsRouter.post("/:eventId/participants/:personId/revoke", async (req, res) => {
  const requester = personed(req).person;
  const access = await resolveEventAccess(req.params.eventId, requester.id);
  if ("error" in access) { res.status(404).json({ error: "Event not found" }); return; }
  if (!access.canAdmin) { res.status(403).json({ error: "Only an event admin can revoke participants" }); return; }
  await db.eventParticipant.updateMany({
    where: { eventId: req.params.eventId, personId: req.params.personId },
    data: { status: "REVOKED" }
  });
  res.json({ revoked: true });
});

eventsRouter.put("/:eventId/participants/:personId/role", async (req, res) => {
  const body = SetRoleSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid role" }); return; }
  const requester = personed(req).person;
  const access = await resolveEventAccess(req.params.eventId, requester.id);
  if ("error" in access) { res.status(404).json({ error: "Event not found" }); return; }
  if (!access.canAdmin) { res.status(403).json({ error: "Only an event admin can set roles" }); return; }
  await db.eventParticipant.updateMany({
    where: { eventId: req.params.eventId, personId: req.params.personId, status: "ACTIVE" },
    data: { role: body.data.role }
  });
  res.json({ updated: true });
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

  const requester = personed(req).person;

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

  const membership = await activeFamilyMembership(event.familyGroupId, requester.id);
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
