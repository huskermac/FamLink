/**
 * Event read-visibility (P3-00 M2, decision 2026-06-10).
 *
 * PRIVATE events are FULLY hidden from non-invited members — list endpoints
 * exclude them and the detail endpoint returns 404 (never reveal existence).
 * A PRIVATE event is visible to: its creator, family admins, persons invited
 * directly (or matched via a guest invitation's linkedPersonId), members of an
 * invited household, and anyone who already has an RSVP row.
 *
 * BROADCAST and OPEN events are visible to all family members. The legacy
 * Event.visibility column is deprecated and not consulted.
 */
import { db, type Prisma } from "@famlink/db";

/**
 * Household-invite visibility requires the viewer to be an active member of the
 * event's family (spec §7 invariant 3). A household shared with another family
 * must not surface this family's events to residents who aren't members here.
 */
async function householdIdsForPerson(personId: string, familyGroupId: string): Promise<string[]> {
  const membership = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId, personId } }
  });
  if (!membership || membership.suspendedAt !== null) return [];
  const rows = await db.householdMember.findMany({
    where: { personId, household: { families: { some: { familyGroupId } } } },
    select: { householdId: true }
  });
  return rows.map((r) => r.householdId);
}

function invitedOrParticipantFilter(
  personId: string,
  householdIds: string[]
): Prisma.EventWhereInput[] {
  return [
    { createdByPersonId: personId },
    { rsvps: { some: { personId } } },
    { participants: { some: { personId, status: "ACTIVE" } } },
    {
      invitations: {
        some: {
          OR: [
            { personId },
            { linkedPersonId: personId },
            ...(householdIds.length > 0
              ? [{ householdId: { in: householdIds } }]
              : [])
          ]
        }
      }
    }
  ];
}

/**
 * Prisma filter for event LIST queries. Combine with the family scope:
 *   where: { familyGroupId, ...(await visibleEventsWhere(personId, isAdmin, familyGroupId)) }
 */
export async function visibleEventsWhere(
  personId: string,
  isAdmin: boolean,
  familyGroupId: string
): Promise<Prisma.EventWhereInput> {
  if (isAdmin) return {};
  const householdIds = await householdIdsForPerson(personId, familyGroupId);
  return {
    OR: [
      { eventVisibility: { not: "PRIVATE" } },
      ...invitedOrParticipantFilter(personId, householdIds)
    ]
  };
}

/**
 * Detail-gate for a single already-loaded event. Callers should treat `false`
 * as NOT FOUND (full hiding), not as forbidden.
 */
export async function canViewEvent(
  event: { id: string; eventVisibility: string; createdByPersonId: string | null; familyGroupId: string },
  personId: string,
  isAdmin: boolean
): Promise<boolean> {
  if (event.eventVisibility !== "PRIVATE") return true;
  if (isAdmin || event.createdByPersonId === personId) return true;

  const householdIds = await householdIdsForPerson(personId, event.familyGroupId);
  const hit = await db.event.findFirst({
    where: { id: event.id, OR: invitedOrParticipantFilter(personId, householdIds) },
    select: { id: true }
  });
  return hit !== null;
}
