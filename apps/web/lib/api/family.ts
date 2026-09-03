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
  roles: string[];
  joinedAt: string;
}

export interface HouseholdSummary {
  id: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
  // Present on the standalone household create/GET endpoints (viewer-scoped: foreign
  // linked families omit `id` — spec §7 invariant 1). Absent from the family-detail
  // endpoint's per-household objects (apps/api/src/routes/families.ts GET /:familyId).
  linkedFamilies?: { id?: string; name: string }[];
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
  data: Partial<Pick<PersonBrief, "firstName" | "lastName" | "preferredName" | "dateOfBirth">>,
  getToken: GetToken
): Promise<PersonBrief> {
  return apiFetch<PersonBrief>(`/api/v1/persons/${encodeURIComponent(personId)}`, {
    getToken,
    method: "PUT",
    body: JSON.stringify(data)
  });
}

export function updatePersonPhoto(
  personId: string,
  key: string,
  getToken: GetToken
): Promise<PersonBrief> {
  // The server derives the URL from the uploaded key — we never send a URL.
  return apiFetch<PersonBrief>(`/api/v1/persons/${encodeURIComponent(personId)}/photo`, {
    getToken,
    method: "POST",
    body: JSON.stringify({ key })
  });
}

// ── PR-3: person create, member add, household detail ──────────────────────────

export interface CreatePersonInput {
  firstName: string;
  lastName: string;
  preferredName?: string;
  dateOfBirth?: string;
  ageGateLevel?: string;
  familyGroupId?: string;
}

export function createPerson(input: CreatePersonInput, getToken: GetToken): Promise<PersonBrief> {
  return apiFetch<PersonBrief>("/api/v1/persons", {
    getToken,
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function addFamilyMember(
  familyId: string,
  personId: string,
  getToken: GetToken
): Promise<{ id: string; personId: string }> {
  return apiFetch<{ id: string; personId: string }>(
    `/api/v1/families/${encodeURIComponent(familyId)}/members`,
    { getToken, method: "POST", body: JSON.stringify({ personId, roles: ["MEMBER"] }) }
  );
}

export interface HouseholdMemberEntry {
  id: string;
  personId: string;
  role: string | null;
  joinedAt: string;
  displayName: string;
}

export type HouseholdDetail = HouseholdSummary & {
  linkedFamilies: { id?: string; name: string }[];
  members: HouseholdMemberEntry[];
};

export function getHousehold(householdId: string, getToken: GetToken): Promise<HouseholdDetail> {
  return apiFetch<HouseholdDetail>(`/api/v1/households/${encodeURIComponent(householdId)}`, {
    getToken,
    method: "GET"
  });
}

export interface AuditEntry {
  id: string;
  actorPersonId?: string;
  actorFamilyGroupId?: string;
  actorDisplayName: string;
  actorFamilyName: string;
  action: string;
  changes: unknown;
  createdAt: string;
}

export function getHouseholdAudit(
  householdId: string,
  getToken: GetToken
): Promise<{ entries: AuditEntry[] }> {
  return apiFetch<{ entries: AuditEntry[] }>(
    `/api/v1/households/${encodeURIComponent(householdId)}/audit`,
    { getToken, method: "GET" }
  );
}

export function unlinkHousehold(
  householdId: string,
  input: { familyGroupId: string; destroy?: boolean },
  getToken: GetToken
): Promise<void> {
  return apiFetch<void>(`/api/v1/households/${encodeURIComponent(householdId)}/unlink`, {
    getToken,
    method: "POST",
    body: JSON.stringify(input)
  });
}
