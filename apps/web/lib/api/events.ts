/**
 * Events API client — typed fetch functions for events, RSVPs, and event items.
 */

import { apiFetch } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RsvpStatus = "YES" | "NO" | "MAYBE" | "PENDING";
export type EventType = "HOLIDAY" | "PARTY" | "MILESTONE" | "SPORTS" | "SCHOOL" | "OTHER";
export type EventVisibility = "BROADCAST" | "OPEN" | "PRIVATE";

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
  eventType: EventType;
  eventVisibility: EventVisibility;
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
  eventType: EventType;
  eventVisibility: EventVisibility;
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
  eventType?: EventType;
  eventVisibility?: EventVisibility;
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

export function updateEvent(
  eventId: string,
  data: Partial<CreateEventData>,
  getToken: GetToken
): Promise<EventRecord> {
  return apiFetch<EventRecord>(`/api/v1/events/${encodeURIComponent(eventId)}`, {
    getToken,
    method: "PUT",
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

// ── Invitations ───────────────────────────────────────────────────────────────

export type InviteeEntry =
  | { kind: "person"; personId: string }
  | { kind: "famlinkUser"; personId: string; role?: "PARTICIPANT" | "EVENT_ADMIN" }
  | { kind: "guest"; guestEmail?: string; guestPhone?: string; guestName?: string };

export interface InvitationRecord {
  id: string;
  personId: string | null;
  displayName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  linkedPersonId: string | null;
  invitedById: string | null;
  status: string;
  sentAt: string | null;
}

export interface InviteeSuggestion {
  person: { id: string; displayName: string; avatarUrl: string | null };
  via: { personId: string; personName: string; relationshipType: string; relationshipState: string };
  sharedChildren: { id: string; displayName: string }[];
}

export async function sendInvitations(
  eventId: string,
  invitees: InviteeEntry[],
  getToken: GetToken
): Promise<{ invitations: unknown[] }> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/invitations`, {
    method: "POST",
    body: JSON.stringify({ invitees }),
    getToken
  });
}

export async function getEventInvitations(
  eventId: string,
  getToken: GetToken
): Promise<{ invitations: InvitationRecord[] }> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/invitations`, { getToken });
}

export async function getEventInviteeSuggestions(
  eventId: string,
  getToken: GetToken
): Promise<{ suggestions: InviteeSuggestion[] }> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/invitee-suggestions`, { getToken });
}

export async function getGuestInvitation(token: string): Promise<{
  event: { id: string; title: string; startAt: string; endAt: string | null; locationName: string | null; familyGroup: { name: string } };
  guestName: string | null;
  currentStatus: string;
}> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const res = await fetch(`${apiBase}/api/v1/guest/invitation/${token}`);
  if (!res.ok) throw new Error("Invitation not found");
  return res.json();
}

export async function submitGuestRsvp(token: string, status: "ACCEPTED" | "DECLINED" | "TENTATIVE"): Promise<{ ok: boolean; status: string }> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const res = await fetch(`${apiBase}/api/v1/guest/invitation/${token}/rsvp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  if (!res.ok) throw new Error("RSVP failed");
  return res.json();
}

// ── Cross-family participation (W3a-UI) ────────────────────────────────────────

export type ParticipationState = "PENDING" | "DECLINED" | "ACTIVE" | "UNAVAILABLE";

export interface ParticipationPreview {
  state: ParticipationState;
  eventId?: string;
  eventTitle?: string;
  startAt?: string;
  endAt?: string | null;
  locationName?: string | null;
  role?: "PARTICIPANT" | "EVENT_ADMIN";
  invitedByName?: string;
}

export interface ParticipantRecord {
  personId: string;
  displayName: string;
  role: "PARTICIPANT" | "EVENT_ADMIN";
  status: "ACTIVE" | "REVOKED";
}

export interface ForeignEventItem {
  id: string;
  name: string;
  quantity: string | null;
  notes: string | null;
  status: string;
  isOwn: boolean;
}

export interface ForeignEventDTO {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationMapUrl: string | null;
  eventType: EventType;
  participants: { displayName: string; rsvpStatus: RsvpStatus | null }[];
  tasks: ForeignEventItem[];
}

export function isForeignEventDTO(d: EventDetail | ForeignEventDTO): d is ForeignEventDTO {
  return !("event" in d);
}

export function previewParticipation(token: string, getToken: GetToken): Promise<ParticipationPreview> {
  return apiFetch<ParticipationPreview>(`/api/v1/events/participation/preview?token=${encodeURIComponent(token)}`, { method: "GET", getToken });
}

export function acceptParticipation(eventId: string, token: string, getToken: GetToken): Promise<{ accepted: boolean }> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/participation/accept`, { method: "POST", body: JSON.stringify({ token }), getToken });
}

export function declineParticipation(eventId: string, token: string, getToken: GetToken): Promise<{ declined: boolean }> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/participation/decline`, { method: "POST", body: JSON.stringify({ token }), getToken });
}

export function listParticipants(eventId: string, getToken: GetToken): Promise<{ participants: ParticipantRecord[] }> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/participants`, { method: "GET", getToken });
}

export function revokeParticipant(eventId: string, personId: string, getToken: GetToken): Promise<{ revoked: boolean }> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(personId)}/revoke`, { method: "POST", getToken });
}

export function setParticipantRole(eventId: string, personId: string, role: "PARTICIPANT" | "EVENT_ADMIN", getToken: GetToken): Promise<{ updated: boolean }> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(personId)}/role`, { method: "PUT", body: JSON.stringify({ role }), getToken });
}

export function addItem(eventId: string, data: { name: string; quantity?: string; notes?: string }, getToken: GetToken): Promise<ForeignEventItem | EventItem> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/items`, { method: "POST", body: JSON.stringify(data), getToken });
}

export function patchItem(eventId: string, itemId: string, data: Partial<{ name: string; quantity: string | null; notes: string | null; status: string }>, getToken: GetToken): Promise<ForeignEventItem | EventItem> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/items/${encodeURIComponent(itemId)}`, { method: "PATCH", body: JSON.stringify(data), getToken });
}

export function deleteItem(eventId: string, itemId: string, getToken: GetToken): Promise<void> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/items/${encodeURIComponent(itemId)}`, { method: "DELETE", getToken });
}
