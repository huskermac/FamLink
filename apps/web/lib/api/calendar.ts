import { apiFetch } from "@/lib/api";

// Raw shape from the API — shared by both regular events and synthetic birthday events
interface RawCalendarRow {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  isBirthdayEvent: boolean;
  birthdayPersonId?: string;
  locationName?: string | null;
  familyGroupId: string;
}

export type CalendarEventType = "EVENT" | "BIRTHDAY";

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: CalendarEventType;
  /** Present for EVENT type; undefined for BIRTHDAY */
  eventId?: string;
  resource?: { location?: string };
}

export interface DigestItem {
  id: string;
  title: string;
  startAt: string;
  locationName: string | null;
  isBirthdayEvent: boolean;
}

export interface DigestSummary {
  events: DigestItem[];
  birthdays: DigestItem[];
  generatedAt: string;
}

type GetToken = () => Promise<string | null>;

function toCalendarEvent(row: RawCalendarRow): CalendarEvent {
  const start = new Date(row.startAt);
  // Birthday events span the full day; regular events default to 1 hour when no endAt
  const end = row.endAt
    ? new Date(row.endAt)
    : row.isBirthdayEvent
    ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1))
    : new Date(start.getTime() + 3_600_000);
  return {
    id: row.id,
    title: row.title,
    start,
    end,
    type: row.isBirthdayEvent ? "BIRTHDAY" : "EVENT",
    ...(row.isBirthdayEvent ? {} : { eventId: row.id }),
    ...(row.locationName ? { resource: { location: row.locationName } } : {})
  };
}

/** Fetch calendar events for the month containing `startDate`. */
export function getCalendarEvents(
  familyId: string,
  startDate: Date,
  getToken: GetToken
): Promise<CalendarEvent[]> {
  const y = startDate.getFullYear();
  const m = String(startDate.getMonth() + 1).padStart(2, "0");
  return apiFetch<{ month: string; events: RawCalendarRow[] }>(
    `/api/v1/families/${encodeURIComponent(familyId)}/calendar?month=${y}-${m}`,
    { getToken, method: "GET" }
  ).then((data) => data.events.map(toCalendarEvent));
}

/** Fetch upcoming events + birthdays for the next 7 days. */
export function getUpcomingDigest(
  familyId: string,
  getToken: GetToken
): Promise<DigestSummary> {
  return apiFetch<{ events: RawCalendarRow[]; generatedAt: string }>(
    `/api/v1/families/${encodeURIComponent(familyId)}/calendar/upcoming?days=7`,
    { getToken, method: "GET" }
  ).then((data) => ({
    events: data.events
      .filter((e) => !e.isBirthdayEvent)
      .map((e) => ({
        id: e.id,
        title: e.title,
        startAt: e.startAt,
        locationName: e.locationName ?? null,
        isBirthdayEvent: false
      })),
    birthdays: data.events
      .filter((e) => e.isBirthdayEvent)
      .map((e) => ({
        id: e.id,
        title: e.title,
        startAt: e.startAt,
        locationName: null,
        isBirthdayEvent: true
      })),
    generatedAt: data.generatedAt
  }));
}
