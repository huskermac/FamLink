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
    queryFn: () => apiFetch<EventDetail>(`/api/v1/events/${eventId}`),
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

export function useClaimItem(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      personId,
      currentItems,
    }: {
      itemId: string;
      personId: string;
      currentItems: SerializedEventItem[];
    }) => {
      const updated = currentItems.map((item) =>
        item.id === itemId ? { ...item, assignedToPersonId: personId } : item
      );
      return apiFetch(`/api/v1/events/${eventId}/potluck`, {
        method: "PUT",
        body: JSON.stringify(updated),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });
}
