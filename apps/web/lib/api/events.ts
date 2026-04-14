/**
 * Events API client — typed fetch functions for events, RSVPs, and event items.
 */

import { apiFetch } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RsvpStatus = "YES" | "NO" | "MAYBE" | "PENDING";

export interface EventSummary {
  id: string;
  familyGroupId: string;
  createdByPersonId?: string;
  title: string;
  startAt: string;
  endAt: string | null;
  locationName: string | null;
  locationAddress?: string | null;
  isBirthdayEvent: boolean;
}

export interface EventRecord {
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
  createdAt: string;
  updatedAt: string;
}

export interface RsvpSummary {
  YES: number;
  NO: number;
  MAYBE: number;
  PENDING: number;
}

export interface EventItem {
  id: string;
  eventId: string;
  name: string;
  quantity: string | null;
  notes: string | null;
  assignedToPersonId: string | null;
  status: string;
  createdAt: string;
}

export interface EventDetail {
  event: EventRecord;
  invitations: number;
  rsvps: RsvpSummary;
  eventItems: EventItem[];
}

export interface RsvpRecord {
  id: string;
  eventId: string;
  personId: string;
  status: RsvpStatus;
  respondedAt: string | null;
}

export interface CreateEventData {
  title: string;
  startAt: string;
  endAt?: string;
  locationName?: string;
  locationAddress?: string;
  description?: string;
  visibility?: string;
}

/** Shape used by the AI propose-confirm pattern */
export interface AiEventProposal {
  familyId: string;
  title: string;
  startAt: string;
  endAt?: string;
  locationName?: string;
  description?: string;
}

// ── API functions ─────────────────────────────────────────────────────────────

type GetToken = () => Promise<string | null>;

export function getEvents(
  familyId: string,
  getToken: GetToken,
  options?: { days?: number }
): Promise<{ events: EventSummary[]; generatedAt: string }> {
  const params = options?.days ? `?days=${options.days}` : "";
  return apiFetch(`/api/v1/families/${encodeURIComponent(familyId)}/calendar/upcoming${params}`, {
    getToken,
    method: "GET"
  });
}

export function getEventDetails(eventId: string, getToken: GetToken): Promise<EventDetail> {
  return apiFetch<EventDetail>(`/api/v1/events/${encodeURIComponent(eventId)}`, {
    getToken,
    method: "GET"
  });
}

export function createEvent(
  familyId: string,
  data: CreateEventData,
  getToken: GetToken
): Promise<EventRecord> {
  return apiFetch<EventRecord>(`/api/v1/families/${encodeURIComponent(familyId)}/events`, {
    getToken,
    method: "POST",
    body: JSON.stringify(data)
  });
}

export function updateRsvp(
  eventId: string,
  status: RsvpStatus,
  getToken: GetToken
): Promise<RsvpRecord> {
  return apiFetch<RsvpRecord>(`/api/v1/events/${encodeURIComponent(eventId)}/rsvp`, {
    getToken,
    method: "PUT",
    body: JSON.stringify({ status })
  });
}

export function getRsvpStatus(
  eventId: string,
  getToken: GetToken
): Promise<{ rsvps: Record<RsvpStatus, Array<{ firstName: string; lastName: string }>> }> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/rsvps`, {
    getToken,
    method: "GET"
  });
}
