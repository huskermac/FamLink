import { db, type FamilyMember, type Prisma } from "@famlink/db";
import { hasAdminRole } from "./familyAccess";

/**
 * Membership row (active, non-suspended) in any family linked to the household, or null.
 * Exported: households.ts imports this rather than re-implementing the same lookup, so the
 * two files can't silently diverge on "is this person a member of any family linked to this
 * household". Note: householdAdmin (below) and actorAdminFamily (households.ts) still inline
 * the identical where clause for their own membership queries — this is not the sole copy.
 */
export async function anyLinkedMembership(householdId: string, personId: string): Promise<FamilyMember | null> {
  return db.familyMember.findFirst({
    where: {
      personId,
      suspendedAt: null,
      familyGroup: { householdLinks: { some: { householdId } } }
    }
  });
}

export async function householdViewer(householdId: string, personId: string): Promise<boolean> {
  return (await anyLinkedMembership(householdId, personId)) !== null;
}

export async function householdAdmin(householdId: string, personId: string): Promise<boolean> {
  const memberships = await db.familyMember.findMany({
    where: {
      personId,
      suspendedAt: null,
      familyGroup: { householdLinks: { some: { householdId } } }
    }
  });
  return memberships.some((m) => hasAdminRole(m));
}

/**
 * Names of linked families are consented-visible across a link; the id is included ONLY
 * for families the viewer is an active member of (spec §7 invariant 1 — no foreign family
 * ids; unlink, the only id-consuming call, always targets the caller's own family).
 * Amended 2026-07-14 (council round 1).
 */
export async function linkedFamilies(
  householdId: string,
  viewerPersonId: string
): Promise<{ id?: string; name: string }[]> {
  const links = await db.householdFamily.findMany({
    where: { householdId },
    include: {
      familyGroup: {
        select: {
          id: true,
          name: true,
          members: { where: { personId: viewerPersonId, suspendedAt: null }, select: { id: true } }
        }
      }
    },
    orderBy: [{ linkedAt: "asc" }, { id: "asc" }] // stable secondary order
  });
  return links.map((l) =>
    l.familyGroup.members.length > 0
      ? { id: l.familyGroup.id, name: l.familyGroup.name }
      : { name: l.familyGroup.name }
  );
}

export type HouseholdAuditAction =
  | "UPDATED" | "LINKED" | "UNLINKED" | "RESIDENT_ADDED" | "RESIDENT_REMOVED" | "DESTROYED";

export async function writeHouseholdAudit(
  tx: Prisma.TransactionClient,
  entry: {
    householdId: string;
    actorPersonId: string;
    actorFamilyGroupId: string;
    action: HouseholdAuditAction;
    changes?: Record<string, { from: unknown; to: unknown }>;
  }
): Promise<void> {
  await tx.householdAuditEntry.create({
    data: {
      householdId: entry.householdId,
      actorPersonId: entry.actorPersonId,
      actorFamilyGroupId: entry.actorFamilyGroupId,
      action: entry.action,
      changes: entry.changes as Prisma.InputJsonValue | undefined
    }
  });
}
