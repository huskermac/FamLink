/**
 * Family API client — typed fetch functions for family, member, and person data.
 * All functions accept Clerk's `getToken` so they work from both client and
 * server components (pass from `useAuth()` or `auth()` respectively).
 */

import { apiFetch } from "@/lib/api";

// ── Response types ────────────────────────────────────────────────────────────

export interface PersonBrief {
  id: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  ageGateLevel: string;
  profilePhotoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FamilyGroupSummary {
  id: string;
  name: string;
  aiEnabled: boolean;
  defaultVisibility: string;
  createdAt: string;
  updatedAt: string;
}

export interface FamilyMembership {
  familyGroup: FamilyGroupSummary;
  role: string;
  joinedAt: string;
}

export interface HouseholdSummary {
  id: string;
  familyGroupId: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HouseholdWithMembers {
  household: HouseholdSummary;
  members: PersonBrief[];
}

export interface FamilyMemberEntry {
  person: PersonBrief;
  roles: string[];
  joinedAt: string;
}

export interface FamilyDetail {
  familyGroup: FamilyGroupSummary & { createdById: string };
  members: FamilyMemberEntry[];
  households: HouseholdWithMembers[];
}

// ── API functions ─────────────────────────────────────────────────────────────

type GetToken = () => Promise<string | null>;

export function getMyFamilies(getToken: GetToken): Promise<FamilyMembership[]> {
  return apiFetch<FamilyMembership[]>("/api/v1/persons/me/families", {
    getToken,
    method: "GET"
  });
}

export function getFamilyDetails(
  familyId: string,
  getToken: GetToken
): Promise<FamilyDetail> {
  return apiFetch<FamilyDetail>(`/api/v1/families/${encodeURIComponent(familyId)}`, {
    getToken,
    method: "GET"
  });
}

export function getPerson(
  personId: string,
  getToken: GetToken
): Promise<PersonBrief> {
  return apiFetch<PersonBrief>(`/api/v1/persons/${encodeURIComponent(personId)}`, {
    getToken,
    method: "GET"
  });
}

export function updatePerson(
  personId: string,
  data: Partial<Pick<PersonBrief, "firstName" | "lastName" | "preferredName">>,
  getToken: GetToken
): Promise<PersonBrief> {
  return apiFetch<PersonBrief>(`/api/v1/persons/${encodeURIComponent(personId)}`, {
    getToken,
    method: "PUT",
    body: JSON.stringify(data)
  });
}

export function updatePersonPhotoUrl(
  personId: string,
  profilePhotoUrl: string,
  getToken: GetToken
): Promise<PersonBrief> {
  return apiFetch<PersonBrief>(`/api/v1/persons/${encodeURIComponent(personId)}`, {
    getToken,
    method: "PUT",
    body: JSON.stringify({ profilePhotoUrl })
  });
}
