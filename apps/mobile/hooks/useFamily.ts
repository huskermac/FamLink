import { useQuery } from "@tanstack/react-query";
import { useApiFetch } from "../lib/api";

interface PersonBrief {
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

interface FamilyMembership {
  familyGroup: { id: string; name: string };
  roles: string[];
  joinedAt: string;
}

export interface FamilyMember {
  person: PersonBrief;
  roles: string[];
  joinedAt: string;
}

interface FamilyDetail {
  familyGroup: { id: string; name: string; aiEnabled: boolean };
  members: FamilyMember[];
  households: Array<{
    household: { id: string; name: string };
    members: PersonBrief[];
  }>;
}

interface PersonRelationship {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  type: string;
  relatedPerson: { displayName: string; ageGateLevel: string };
}

export function useMyFamilies() {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["families"],
    queryFn: () => apiFetch<{ memberships: FamilyMembership[] }>("/api/v1/persons/me/families"),
  });
}

export function useMembers(familyId: string | null) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["family", familyId],
    queryFn: () => apiFetch<FamilyDetail>(`/api/v1/families/${familyId}`),
    enabled: familyId !== null,
    refetchInterval: 10_000,
  });
}

export function usePerson(personId: string) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["person", personId],
    queryFn: () => apiFetch<PersonBrief>(`/api/v1/persons/${personId}`),
    refetchInterval: false,
  });
}

export function useMyPerson() {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<PersonBrief>("/api/v1/persons/me"),
    refetchInterval: false,
  });
}

export function usePersonRelationships(personId: string) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["person-relationships", personId],
    queryFn: () => apiFetch<PersonRelationship[]>(`/api/v1/persons/${personId}/relationships`),
    refetchInterval: false,
  });
}
