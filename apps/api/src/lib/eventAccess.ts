import { db } from "@famlink/db";
import type { Event } from "@famlink/db";
import { activeFamilyMembership, hasAdminRole } from "./familyAccess";
import { canViewEvent } from "./eventVisibility";

export function toForeignInvitedEventDTO(
  event: Event,
  participants: Array<{ displayName: string; rsvpStatus: string | null }>,
  tasks: Array<Record<string, unknown>>,
  myRsvp: string | null
) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt?.toISOString() ?? null,
    locationName: event.locationName,
    locationAddress: event.locationAddress,
    locationMapUrl: event.locationMapUrl,
    eventType: event.eventType,
    participants,
    tasks,
    myRsvp
  };
}

export async function activeEventParticipant(
  personId: string,
  eventId: string
): Promise<{ role: "PARTICIPANT" | "EVENT_ADMIN" } | null> {
  const grant = await db.eventParticipant.findUnique({
    where: { eventId_personId: { eventId, personId } },
    select: { role: true, status: true }
  });
  if (!grant || grant.status !== "ACTIVE") return null;
  return { role: grant.role };
}

export type EventAccess = {
  event: Event;
  isOwningMember: boolean;
  isOwningAdmin: boolean;
  eventRole: "PARTICIPANT" | "EVENT_ADMIN" | null;
  canView: boolean;
  canContribute: boolean;
  canAdmin: boolean;
};

export async function eventNotificationRecipients(eventId: string): Promise<string[]> {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { familyGroupId: true } });
  if (!event) return [];
  const members = await db.familyMember.findMany({ where: { familyGroupId: event.familyGroupId }, select: { personId: true } });
  const grants = await db.eventParticipant.findMany({ where: { eventId, status: "ACTIVE" }, select: { personId: true } });
  return [...new Set([...members.map((m) => m.personId), ...grants.map((g) => g.personId)])];
}

export async function resolveEventAccess(
  eventId: string,
  personId: string
): Promise<EventAccess | { error: "not_found" }> {
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) return { error: "not_found" };

  const membership = await activeFamilyMembership(event.familyGroupId, personId);
  const isOwningMember = membership !== null;
  const isOwningAdmin = membership ? hasAdminRole(membership) : false;
  const grant = await activeEventParticipant(personId, eventId);
  const eventRole = grant?.role ?? null;

  const memberCanView = isOwningMember
    ? await canViewEvent(event, personId, isOwningAdmin)
    : false;
  const canView = memberCanView || eventRole !== null;
  if (!canView) return { error: "not_found" };

  const isCreator = event.createdByPersonId === personId;
  return {
    event,
    isOwningMember,
    isOwningAdmin,
    eventRole,
    canView: true,
    canContribute: isOwningMember || eventRole !== null,
    canAdmin: isOwningAdmin || isCreator || eventRole === "EVENT_ADMIN"
  };
}
