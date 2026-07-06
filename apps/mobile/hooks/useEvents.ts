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
