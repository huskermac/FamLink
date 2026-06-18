import { Router } from "express";
import { z } from "zod";
import { RSVPStatus } from "@famlink/shared";
import { db } from "@famlink/db";
import type { GuestTokenPayload } from "../lib/guestToken";
import type { GuestRequest } from "../middleware/guestAuth";
import { requireGuestToken } from "../middleware/guestAuth";
import { guestRateLimiter } from "../middleware/rateLimit";

export const guestRouter = Router();

// All guest endpoints are public or token-based — rate-limit per IP.
guestRouter.use(guestRateLimiter);

const rsvpBodySchema = z.object({
  status: z.nativeEnum(RSVPStatus)
});

type PersonNameRow = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
};

function displayName(p: {
  firstName: string;
  lastName: string;
  preferredName: string | null;
}): string {
  const preferred = p.preferredName?.trim();
  if (preferred) return preferred;
  return `${p.firstName} ${p.lastName}`.trim();
}

async function loadAuthorizedEvent(guest: GuestTokenPayload) {
  if (guest.resourceType !== "EVENT") {
    return { error: "bad_resource" as const };
  }

  const event = await db.event.findUnique({
    where: { id: guest.resourceId },
    include: { familyGroup: true }
  });
  if (!event) {
    return { error: "not_found" as const };
  }

  const [member, rsvp] = await Promise.all([
    db.familyMember.findFirst({
      where: {
        familyGroupId: event.familyGroupId,
        personId: guest.personId,
        suspendedAt: null
      }
    }),
    db.rSVP.findUnique({
      where: {
        eventId_personId: { eventId: event.id, personId: guest.personId }
      }
    })
  ]);

  if (!member && !rsvp) {
    return { error: "forbidden" as const };
  }

  return { event };
}

guestRouter.get("/event", requireGuestToken, async (req, res) => {
  const { guest } = req as GuestRequest;
  const result = await loadAuthorizedEvent(guest);

  if (result.error === "bad_resource") {
    res.status(400).json({ error: "Guest event access requires EVENT resource type" });
    return;
  }
  if (result.error === "not_found") {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (result.error === "forbidden") {
    res.status(403).json({ error: "Not authorized for this event" });
    return;
  }

  const { event } = result;

  const [rsvps, myRsvp, potluck] = await Promise.all([
    db.rSVP.findMany({ where: { eventId: event.id } }),
    db.rSVP.findUnique({
      where: {
        eventId_personId: { eventId: event.id, personId: guest.personId }
      }
    }),
    db.eventItem.findFirst({
      where: { eventId: event.id, assignedToPersonId: guest.personId }
    })
  ]);

  const personIds = [...new Set(rsvps.map((r: { personId: string }) => r.personId))];
  const persons: PersonNameRow[] =
    personIds.length === 0
      ? []
      : await db.person.findMany({
          where: { id: { in: personIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true
          }
        });
  const byId = new Map<string, PersonNameRow>(
    persons.map((p) => [p.id, p])
  );

  const attendees = rsvps
    .map((r: { personId: string }) => {
      const p = byId.get(r.personId);
      if (!p) return null;
      return { displayName: displayName(p) };
    })
    .filter((x: { displayName: string } | null): x is { displayName: string } => x !== null);

  res.json({
    event: {
      id: event.id,
      title: event.title,
      description: event.description,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt?.toISOString() ?? null,
      locationName: event.locationName,
      locationAddress: event.locationAddress,
      locationMapUrl: event.locationMapUrl,
      familyGroup: {
        id: event.familyGroup.id,
        name: event.familyGroup.name
      }
    },
    myRsvp: myRsvp
      ? { status: myRsvp.status, respondedAt: myRsvp.respondedAt?.toISOString() ?? null }
      : null,
    attendees,
    eventItem: potluck
      ? {
          name: potluck.name,
          quantity: potluck.quantity,
          notes: potluck.notes
        }
      : null
  });
});

const guestRsvpSchema = z.object({
  status: z.enum(["ACCEPTED", "DECLINED", "TENTATIVE"])
});

guestRouter.get("/invitation/:token", async (req, res) => {
  const { token } = req.params;

  const invitation = await db.eventInvitation.findUnique({
    where: { guestToken: token },
    include: {
      event: {
        select: {
          id: true, title: true, description: true,
          startAt: true, endAt: true,
          locationName: true, locationAddress: true, locationMapUrl: true,
          familyGroup: { select: { id: true, name: true } }
        }
      }
    }
  });

  if (!invitation) {
    res.status(404).json({ error: "Invitation not found" });
    return;
  }

  const { event } = invitation;

  res.json({
    event: {
      id:              event.id,
      title:           event.title,
      description:     event.description,
      startAt:         event.startAt.toISOString(),
      endAt:           event.endAt?.toISOString() ?? null,
      locationName:    event.locationName,
      locationAddress: event.locationAddress,
      locationMapUrl:  event.locationMapUrl,
      familyGroup:     event.familyGroup
    },
    guestName:     invitation.guestName,
    currentStatus: invitation.status
  });
});

guestRouter.post("/invitation/:token/rsvp", async (req, res) => {
  const { token } = req.params;
  const parsed = guestRsvpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid RSVP body" });
    return;
  }

  const invitation = await db.eventInvitation.findUnique({
    where: { guestToken: token },
    include: { event: { select: { startAt: true, endAt: true } } }
  });
  if (!invitation) {
    res.status(404).json({ error: "Invitation not found" });
    return;
  }

  const deadline = invitation.event.endAt ?? invitation.event.startAt;
  if (new Date() > deadline) {
    res.status(400).json({ error: "This event has ended — RSVP is no longer available" });
    return;
  }

  await db.eventInvitation.update({
    where: { id: invitation.id },
    data: { status: parsed.data.status }
  });

  res.json({ ok: true, status: parsed.data.status });
});

guestRouter.post("/rsvp", requireGuestToken, async (req, res) => {
  const gr = req as GuestRequest;
  const { guest, guestJwt } = gr;

  if (guest.scope !== "RSVP") {
    res.status(403).json({ error: "RSVP scope required" });
    return;
  }

  const parsed = rsvpBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid RSVP body" });
    return;
  }

  const result = await loadAuthorizedEvent(guest);
  if (result.error === "bad_resource") {
    res.status(400).json({ error: "Guest RSVP requires EVENT resource type" });
    return;
  }
  if (result.error === "not_found") {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (result.error === "forbidden") {
    res.status(403).json({ error: "Not authorized for this event" });
    return;
  }

  const { event } = result;
  const now = new Date();

  await db.rSVP.upsert({
    where: {
      eventId_personId: { eventId: event.id, personId: guest.personId }
    },
    create: {
      eventId: event.id,
      personId: guest.personId,
      status: parsed.data.status,
      guestToken: guestJwt,
      respondedAt: now
    },
    update: {
      status: parsed.data.status,
      guestToken: guestJwt,
      respondedAt: now
    }
  });

  res.json({ ok: true, status: parsed.data.status });
});
