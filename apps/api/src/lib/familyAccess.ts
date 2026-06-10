import { db, type FamilyMember } from "@famlink/db";

export const CREATOR_ROLES = ["ADMIN", "ORGANIZER"] as const;

/**
 * Membership lookup for requester access gates (P3-00): a member suspended by
 * downgrade enforcement (`suspendedAt` set) is treated as not a member.
 * Member listings and seat counts query FamilyMember directly — suspension
 * removes platform access, not family membership.
 */
export async function activeFamilyMembership(
  familyGroupId: string,
  personId: string
): Promise<FamilyMember | null> {
  const m = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId, personId } }
  });
  if (!m || m.suspendedAt) return null;
  return m;
}

export const CREATOR_PERMISSIONS = [
  "VIEW_EVENTS",
  "CREATE_EVENTS",
  "INVITE_MEMBERS",
  "MANAGE_MEMBERS",
  "MANAGE_SETTINGS"
] as const;

export function hasAdminRole(m: Pick<FamilyMember, "roles">): boolean {
  return (m.roles ?? []).includes("ADMIN");
}

/** ADMIN implies full access for permission gates in P1-06. */
export function hasPermission(m: Pick<FamilyMember, "roles" | "permissions">, perm: string): boolean {
  if (hasAdminRole(m)) return true;
  return m.permissions.includes(perm);
}
