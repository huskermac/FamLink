import type { VisibilityTier } from "./visibility";

export enum RSVPStatus {
  YES = "YES",
  NO = "NO",
  MAYBE = "MAYBE",
  PENDING = "PENDING"
}

export enum InviteScope {
  INDIVIDUAL = "INDIVIDUAL",
  HOUSEHOLD = "HOUSEHOLD",
  FAMILY = "FAMILY"
}

export interface FamLinkEvent {
  id: string;
  familyGroupId: string;
  createdByPersonId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  location: EventLocation | null;
  visibility: VisibilityTier;
  isRecurring: boolean;
  createdAt: string;
}

export interface EventLocation {
  name: string | null;
  address: string | null;
  googleMapsUrl: string | null;
}

export interface RSVP {
  id: string;
  eventId: string;
  personId: string;
  status: RSVPStatus;
  guestToken: string | null;
  respondedAt: string | null;
}

