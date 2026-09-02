/**
 * Link-request API client — typed fetch functions for cross-family consent
 * requests (family membership PULL and household JOIN/link flows).
 * All functions accept Clerk's `getToken` so they work from both client and
 * server components (pass from `useAuth()` or `auth()` respectively).
 */

import { apiFetch } from "@/lib/api";

// ── Response types ────────────────────────────────────────────────────────────

export interface InboxRequest {
  id: string;
  kind: string;
  direction: string;
  requestingFamilyName: string;
  targetName: string | null;
  targetHouseholdName?: string | null;
  carryHouseholdName: string | null;
  notice: string;
}

export interface CreateLinkRequestInput {
  kind: "FAMILY_MEMBERSHIP" | "HOUSEHOLD_LINK";
  direction: "PULL" | "JOIN";
  familyGroupId: string;
  targetPersonId?: string;
  targetEmail?: string;
  targetPhone?: string;
  targetHouseholdId?: string;
  carryHouseholdId?: string;
  attestedAdult?: boolean;
}

export interface OwnerRequest {
  id: string;
  kind: string;
  direction: string;
  familyGroupId: string;
  targetPersonId: string | null;
  targetHouseholdId: string | null;
  status: string;
  consentChannel: string | null;
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
  billingImpact?: unknown;
}

export interface AcceptResult {
  id: string;
  status: string;
  granted: boolean;
  resolvedAt: string | null;
}

export interface DeclineResult {
  id: string;
  status: string;
  resolvedAt: string | null;
}

// ── API functions ─────────────────────────────────────────────────────────────

type GetToken = () => Promise<string | null>;

export function getPendingLinkRequests(getToken: GetToken): Promise<{ requests: InboxRequest[] }> {
  return apiFetch<{ requests: InboxRequest[] }>("/api/v1/link-requests/pending", {
    getToken,
    method: "GET"
  });
}

export function createLinkRequest(input: CreateLinkRequestInput, getToken: GetToken): Promise<OwnerRequest> {
  return apiFetch<OwnerRequest>("/api/v1/link-requests", {
    getToken,
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function acceptLinkRequest(id: string, getToken: GetToken): Promise<AcceptResult> {
  return apiFetch<AcceptResult>(`/api/v1/link-requests/${encodeURIComponent(id)}/accept`, {
    getToken,
    method: "POST"
  });
}

export function declineLinkRequest(id: string, getToken: GetToken): Promise<DeclineResult> {
  return apiFetch<DeclineResult>(`/api/v1/link-requests/${encodeURIComponent(id)}/decline`, {
    getToken,
    method: "POST"
  });
}
