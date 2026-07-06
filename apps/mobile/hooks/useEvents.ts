import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiFetch } from "../lib/api";

export interface SerializedEvent {
  id: string;
  familyGroupId: string;
  createdByPersonId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationMapUrl: string | null;
  visibility: string;
  isRecurring: boolean;
  isBirthdayEvent: boolean;
  birthdayPersonId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedEventItem {
  id: string;
  eventId: string;
  createdByPersonId: string;
  assignedToPersonId: string | null;
  name: string;
  quantity: string | null;
  notes: string | null;
  isChecklistItem: boolean;
  status: "UNCLAIMED" | "CLAIMED" | "PROVIDED" | "CANCELLED";
  visibility: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventDetail {
  event: SerializedEvent;
  invitations: number;
  rsvps: { YES: number; NO: number; MAYBE: number; PENDING: number };
  eventItems: SerializedEventItem[];
}

export interface ForeignParticipantEntry {
  displayName: string;
  rsvpStatus: string | null;
}

export interface ForeignTask {
  id: string;
  name: string;
  quantity: string | null;
  notes: string | null;
  status: "UNCLAIMED" | "CLAIMED" | "PROVIDED" | "CANCELLED";
  isOwn: boolean;
}

/**
 * Isolation-safe cross-family event shape (spec §4.1). participants[] is
 * attendees-only { displayName, rsvpStatus } — NEVER widen with personId
 * or family identifiers.
 */
export interface ForeignInvitedEventDTO {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationMapUrl: string | null;
  eventType: string;
  participants: ForeignParticipantEntry[];
  tasks: ForeignTask[];
  myRsvp: "YES" | "NO" | "MAYBE" | null;
}

export type EventDetailResponse = EventDetail | ForeignInvitedEventDTO;

/** The own-event shape has the `event` wrapper; the foreign DTO is flat. */
export function isForeignEvent(d: EventDetailResponse): d is ForeignInvitedEventDTO {
  return !("event" in d);
}

export interface ParticipatingEventSummary {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  locationName: string | null;
  eventType: string;
}

export function useParticipatingEvents(days = 30) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["participating-events", days],
    queryFn: () =>
      apiFetch<{ events: ParticipatingEventSummary[]; generatedAt: string }>(
        `/api/v1/events/participating?days=${days}`
      ),
  });
}

export function useEvents(familyId: string | null) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["events", familyId],
    queryFn: () =>
      apiFetch<{ events: SerializedEvent[]; generatedAt: string }>(
        `/api/v1/families/${familyId}/calendar/upcoming?days=30`
      ),
    enabled: familyId !== null,
  });
}

export function useEvent(eventId: string) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["event", eventId],
    queryFn: () => apiFetch<EventDetailResponse>(`/api/v1/events/${eventId}`),
    retry: false,
  });
}

export function useRsvp(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: "YES" | "NO" | "MAYBE") =>
      apiFetch(`/api/v1/events/${eventId}/rsvp`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });
}

export function useAddItem(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; quantity?: string }) =>
      apiFetch<SerializedEventItem>(`/api/v1/events/${eventId}/items`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });
}

export function useDeleteItem(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch(`/api/v1/events/${eventId}/items/${itemId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });
}

export function useClaimItem(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch(`/api/v1/events/${eventId}/items/${itemId}/claim`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });
}

export type InviteeEntry =
  | { kind: "person"; personId: string }
  | { kind: "famlinkUser"; personId: string; role?: "PARTICIPANT" | "EVENT_ADMIN" }
  | { kind: "guest"; guestEmail?: string; guestPhone?: string; guestName?: string };

export interface InviteeSuggestion {
  person: { id: string; displayName: string; avatarUrl: string | null };
  via: { personId: string; personName: string; relationshipType: string; relationshipState: string };
  sharedChildren: { id: string; displayName: string }[];
}

export interface ParticipantRecord {
  personId: string;
  displayName: string;
  role: "PARTICIPANT" | "EVENT_ADMIN";
  status: "ACTIVE" | "REVOKED";
}

export function useInviteeSuggestions(eventId: string, opts?: { enabled?: boolean }) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["invitee-suggestions", eventId],
    queryFn: () => apiFetch<{ suggestions: InviteeSuggestion[] }>(`/api/v1/events/${eventId}/invitee-suggestions`),
    enabled: opts?.enabled ?? true,
  });
}

export function useSendInvitations(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitees: InviteeEntry[]) =>
      apiFetch(`/api/v1/events/${eventId}/invitations`, { method: "POST", body: JSON.stringify({ invitees }) }),
    onSuccess: () => {
      // Invited people drop off the suggestion list and (for members) may appear
      // as participants — refresh both alongside the event.
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["invitee-suggestions", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["participants", eventId] });
    },
  });
}

export function useParticipants(eventId: string) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["participants", eventId],
    queryFn: () => apiFetch<{ participants: ParticipantRecord[] }>(`/api/v1/events/${eventId}/participants`),
  });
}

export function useRevokeParticipant(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (personId: string) =>
      apiFetch(`/api/v1/events/${eventId}/participants/${personId}/revoke`, { method: "POST" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["participants", eventId] }); },
  });
}

export function useSetParticipantRole(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ personId, role }: { personId: string; role: "PARTICIPANT" | "EVENT_ADMIN" }) =>
      apiFetch(`/api/v1/events/${eventId}/participants/${personId}/role`, { method: "PUT", body: JSON.stringify({ role }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["participants", eventId] }); },
  });
}
