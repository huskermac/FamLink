export type UserId = string;

export interface FamilyMember {
  id: UserId;
  name: string;
  email?: string;
}

export interface FamilyGroup {
  id: string;
  name: string;
  members: FamilyMember[];
}

export function getPrimaryContact(group: FamilyGroup): FamilyMember | undefined {
  return group.members[0];
}
