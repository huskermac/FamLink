import { useQuery } from "@tanstack/react-query";
import { useApiFetch } from "../lib/api";

export interface CalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  isBirthdayEvent: boolean;
  birthdayPersonId: string | null;
  familyGroupId: string;
  description?: string | null;
  locationName?: string | null;
}

export function useCalendarMonth(familyId: string | null, year: number, month: number) {
  const apiFetch = useApiFetch();
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  return useQuery({
    queryKey: ["calendar", familyId, monthStr],
    queryFn: () =>
      apiFetch<{ month: string; events: CalendarEvent[] }>(
        `/api/v1/families/${familyId}/calendar?month=${monthStr}`
      ),
    enabled: familyId !== null,
  });
}

export function eventsOnDate(events: CalendarEvent[], date: string): CalendarEvent[] {
  const target = date.slice(0, 10);
  return events.filter((e) => e.startAt.slice(0, 10) === target);
}
