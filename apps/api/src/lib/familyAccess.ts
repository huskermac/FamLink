import type { FamilyMember } from "@famlink/db";

export const CREATOR_ROLES = ["ADMIN", "ORGANIZER"] as const;

export const CREATOR_PERMISSIONS = [
  "VIEW_EVENTS",
  "CREATE_EVENTS",
  "INVITE_MEMBERS",
  "MANAGE_MEMBERS",
  "MANAGE_SETTINGS"
] as const;

export function hasAdminRole(m: Pick<FamilyMember, "roles">): boolean {
  return m.roles.includes("ADMIN");
}

/** ADMIN implies full access for permission gates in P1-06. */
export function hasPermission(m: Pick<FamilyMember, "roles" | "permissions">, perm: string): boolean {
  if (hasAdminRole(m)) return true;
  return m.permissions.includes(perm);
}
