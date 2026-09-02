# W1 PR-3 — Consent and Household Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the FamLink web app the consent and household surfaces that consume the PR-2 API, so a family admin can start a membership request and a counterparty can accept or decline it.

**Architecture:** This slice adds no API endpoint. It adds a web client layer for the live PR-2 endpoints, then adds the pages and components that consume that layer. The client functions use `apiFetch` and the Clerk `getToken`, the same as the current clients. The public token functions use a direct `fetch`, the same as the current guest client. The pages use React Query hooks.

**Tech Stack:** Next.js App Router, React, TypeScript, `@tanstack/react-query`, `@clerk/nextjs`, Vitest, React Testing Library.

## Global Constraints

- The web workspace name is `famlink-web`. Run every command from `apps/web`.
- The coverage gate is 80% lines through `npx vitest run --coverage`. Per-task verification runs the coverage gate, not one targeted file (the PR #6 lesson). Cover each new client function and each new handler with a real test.
- The lint step must pass. Run `npm run lint` from the repo root before each commit. The API CI lint step fails on any error.
- Client functions for authenticated endpoints use `apiFetch` from `@/lib/api` and take a `getToken` parameter of type `() => Promise<string | null>`.
- Client functions for the public token endpoints use a direct `fetch` with the base `process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"`, the same as `getGuestInvitation`.
- The endpoint names are the live names from spec §3. The create route is `POST /api/v1/link-requests` with `familyGroupId` in the body. The public consent path has an accept endpoint only. It has no decline endpoint.
- Isolation invariants (spec §6): the inbox, the token page, and the audit view show names only. They show no foreign family id and no roster. The audit view shows an id only for the viewer's own family.
- Commit format: `feat: P3-04 <short description>`. Write commit messages in Simplified Technical English.

## File Structure

- `apps/web/lib/api/linkRequests.ts` — client for the pending list, create, accept, and decline. **Create.**
- `apps/web/lib/api/consent.ts` — client for the public token get and accept. **Create.**
- `apps/web/lib/api/family.ts` — add the person create, the member add, and the household get, audit, and unlink functions. **Modify.**
- `apps/web/lib/nav.ts` — add the `Requests` item. **Modify.**
- `apps/web/hooks/useLinkRequestCount.ts` — the pending-count hook. **Create.**
- `apps/web/components/nav/RequestsBadge.tsx` — the badge. **Create.**
- `apps/web/components/nav/Sidebar.tsx` and `apps/web/components/nav/TopNav.tsx` — render the badge for the `Requests` item. **Modify.**
- `apps/web/app/(protected)/requests/page.tsx` — the consent inbox. **Create.**
- `apps/web/app/consent/[token]/page.tsx` and `ConsentAccept.tsx` — the public token page. **Create.**
- `apps/web/components/family/AddMemberForm.tsx` — the unified add-member form. **Create.**
- `apps/web/app/(protected)/family/[familyId]/page.tsx` — mount the add-member form and the household section. **Modify.**
- `apps/web/components/family/HouseholdSection.tsx` — the linked-families, audit, and unlink surfaces. **Create.**
- `apps/web/components/events/SkipNotices.tsx` — the organizer skip-notices. **Create.**

---

## Task 1: Link-request API client

**Files:**
- Create: `apps/web/lib/api/linkRequests.ts`
- Test: `apps/web/lib/api/__tests__/linkRequests.client.test.ts`

**Interfaces:**
- Consumes: `apiFetch` from `@/lib/api`.
- Produces:
  - `InboxRequest` = `{ id: string; kind: string; direction: string; requestingFamilyName: string; targetName: string | null; targetHouseholdName?: string | null; carryHouseholdName: string | null; notice: string }`
  - `CreateLinkRequestInput` = `{ kind: "FAMILY_MEMBERSHIP" | "HOUSEHOLD_LINK"; direction: "PULL" | "JOIN"; familyGroupId: string; targetPersonId?: string; targetEmail?: string; targetPhone?: string; targetHouseholdId?: string; carryHouseholdId?: string; attestedAdult?: boolean }`
  - `OwnerRequest` = `{ id: string; kind: string; direction: string; familyGroupId: string; targetPersonId: string | null; targetHouseholdId: string | null; status: string; consentChannel: string | null; expiresAt: string; createdAt: string; resolvedAt: string | null; billingImpact?: unknown }`
  - `AcceptResult` = `{ id: string; status: string; granted: boolean; resolvedAt: string | null }`
  - `DeclineResult` = `{ id: string; status: string; resolvedAt: string | null }`
  - `getPendingLinkRequests(getToken): Promise<{ requests: InboxRequest[] }>`
  - `createLinkRequest(input: CreateLinkRequestInput, getToken): Promise<OwnerRequest>`
  - `acceptLinkRequest(id: string, getToken): Promise<AcceptResult>`
  - `declineLinkRequest(id: string, getToken): Promise<DeclineResult>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/api/__tests__/linkRequests.client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getPendingLinkRequests,
  createLinkRequest,
  acceptLinkRequest,
  declineLinkRequest
} from "@/lib/api/linkRequests";

const getToken = () => Promise.resolve("tok");
const originalEnv = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  process.env.NEXT_PUBLIC_API_URL = originalEnv;
  vi.unstubAllGlobals();
});
function mockFetch(ok: boolean, body: unknown, status = ok ? 200 : 409) {
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok, status, json: async () => body, text: async () => JSON.stringify(body)
  });
}

describe("linkRequests client", () => {
  it("GETs the pending list", async () => {
    mockFetch(true, { requests: [] });
    const r = await getPendingLinkRequests(getToken);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/api/v1/link-requests/pending");
    expect(init.method).toBe("GET");
    expect(r).toEqual({ requests: [] });
  });

  it("POSTs a create with the family id in the body", async () => {
    mockFetch(true, { id: "lr1", status: "PENDING" });
    await createLinkRequest(
      { kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: "fam1", targetEmail: "a@b.com" },
      getToken
    );
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/api/v1/link-requests");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ familyGroupId: "fam1", targetEmail: "a@b.com" });
  });

  it("POSTs accept and decline to the id routes", async () => {
    mockFetch(true, { id: "lr1", status: "ACCEPTED", granted: true, resolvedAt: null });
    await acceptLinkRequest("lr1", getToken);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "http://localhost:4000/api/v1/link-requests/lr1/accept"
    );
    mockFetch(true, { id: "lr1", status: "DECLINED", resolvedAt: null });
    await declineLinkRequest("lr1", getToken);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe(
      "http://localhost:4000/api/v1/link-requests/lr1/decline"
    );
  });

  it("throws the API error message on a non-ok create (used to detect CONSENT_REQUIRED)", async () => {
    mockFetch(false, { error: "CONSENT_REQUIRED" }, 409);
    await expect(
      createLinkRequest({ kind: "FAMILY_MEMBERSHIP", direction: "PULL", familyGroupId: "fam1" }, getToken)
    ).rejects.toThrow("CONSENT_REQUIRED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/api/__tests__/linkRequests.client.test.ts`
Expected: FAIL with "Failed to resolve import" or "is not a function".

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/lib/api/linkRequests.ts
import { apiFetch } from "@/lib/api";

type GetToken = () => Promise<string | null>;

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/api/__tests__/linkRequests.client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api/linkRequests.ts apps/web/lib/api/__tests__/linkRequests.client.test.ts
git commit -m "feat: P3-04 add link-request web API client"
```

---

## Task 2: Consent token API client

**Files:**
- Create: `apps/web/lib/api/consent.ts`
- Test: `apps/web/lib/api/__tests__/consent.client.test.ts`

**Interfaces:**
- Consumes: nothing (direct `fetch`, the public-token pattern).
- Produces:
  - `ConsentView` = `{ familyName: string; targetName: string | null; status: string; notice: string }`
  - `ConsentAcceptResult` = `{ granted: boolean; status: string }`
  - `getConsentRequest(token: string): Promise<ConsentView>`
  - `acceptConsentRequest(token: string): Promise<ConsentAcceptResult>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/api/__tests__/consent.client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getConsentRequest, acceptConsentRequest } from "@/lib/api/consent";

const originalEnv = process.env.NEXT_PUBLIC_API_URL;
beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  process.env.NEXT_PUBLIC_API_URL = originalEnv;
  vi.unstubAllGlobals();
});
function mockFetch(ok: boolean, body: unknown, status = ok ? 200 : 410) {
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok, status, json: async () => body, text: async () => JSON.stringify(body)
  });
}

describe("consent client", () => {
  it("GETs the token view (no auth header)", async () => {
    mockFetch(true, { familyName: "The Smiths", targetName: "Jo", status: "PENDING", notice: "n" });
    const r = await getConsentRequest("tok1");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe("http://localhost:4000/api/v1/consent/tok1");
    expect(init).toBeUndefined();
    expect(r.familyName).toBe("The Smiths");
  });

  it("throws when the token get is not ok", async () => {
    mockFetch(false, { error: "This request has expired" }, 410);
    await expect(getConsentRequest("bad")).rejects.toThrow();
  });

  it("POSTs accept and returns the granted body", async () => {
    mockFetch(true, { granted: true, status: "ACCEPTED" });
    const r = await acceptConsentRequest("tok1");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/api/v1/consent/tok1/accept");
    expect(init.method).toBe("POST");
    expect(r).toEqual({ granted: true, status: "ACCEPTED" });
  });

  it("returns the 409 body without throwing (already resolved)", async () => {
    mockFetch(false, { granted: false, status: "EXPIRED" }, 409);
    const r = await acceptConsentRequest("tok1");
    expect(r).toEqual({ granted: false, status: "EXPIRED" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/api/__tests__/consent.client.test.ts`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/lib/api/consent.ts
const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface ConsentView {
  familyName: string;
  targetName: string | null;
  status: string;
  notice: string;
}

export interface ConsentAcceptResult {
  granted: boolean;
  status: string;
}

export async function getConsentRequest(token: string): Promise<ConsentView> {
  const res = await fetch(`${apiBase()}/api/v1/consent/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : "Request not found");
  }
  return res.json();
}

// The accept endpoint returns a body on both 200 (granted) and 409 (already resolved). The page
// reads `granted` and `status`, so return the body in both cases and never throw on a 409.
export async function acceptConsentRequest(token: string): Promise<ConsentAcceptResult> {
  const res = await fetch(`${apiBase()}/api/v1/consent/${encodeURIComponent(token)}/accept`, {
    method: "POST"
  });
  return res.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/api/__tests__/consent.client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api/consent.ts apps/web/lib/api/__tests__/consent.client.test.ts
git commit -m "feat: P3-04 add consent token web API client"
```

---

## Task 3: Person, member, and household client additions

**Files:**
- Modify: `apps/web/lib/api/family.ts`
- Test: `apps/web/lib/api/__tests__/family.household.client.test.ts`

**Interfaces:**
- Consumes: `apiFetch`, and the existing `PersonBrief` and `HouseholdSummary` types in `family.ts`.
- Produces:
  - `CreatePersonInput` = `{ firstName: string; lastName: string; preferredName?: string; dateOfBirth?: string; ageGateLevel?: string; familyGroupId?: string }`
  - `createPerson(input: CreatePersonInput, getToken): Promise<PersonBrief>`
  - `addFamilyMember(familyId: string, personId: string, getToken): Promise<{ id: string; personId: string }>` — sends `roles: ["MEMBER"]`.
  - `HouseholdMemberEntry` = `{ id: string; personId: string; role: string | null; joinedAt: string; displayName: string }`
  - `HouseholdDetail` = `HouseholdSummary & { linkedFamilies: { id?: string; name: string }[]; members: HouseholdMemberEntry[] }`
  - `getHousehold(householdId: string, getToken): Promise<HouseholdDetail>`
  - `AuditEntry` = `{ id: string; actorPersonId?: string; actorFamilyGroupId?: string; actorDisplayName: string; actorFamilyName: string; action: string; changes: unknown; createdAt: string }`
  - `getHouseholdAudit(householdId: string, getToken): Promise<{ entries: AuditEntry[] }>`
  - `unlinkHousehold(householdId: string, input: { familyGroupId: string; destroy?: boolean }, getToken): Promise<void>`

Note for the implementer: `addFamilyMember` sends `roles: ["MEMBER"]` because the API `AddMemberSchema` needs a non-empty `roles` array. `createPerson` sends `lastName` because the API `CreatePersonSchema` needs it.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/api/__tests__/family.household.client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createPerson,
  addFamilyMember,
  getHousehold,
  getHouseholdAudit,
  unlinkHousehold
} from "@/lib/api/family";

const getToken = () => Promise.resolve("tok");
const originalEnv = process.env.NEXT_PUBLIC_API_URL;
beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  process.env.NEXT_PUBLIC_API_URL = originalEnv;
  vi.unstubAllGlobals();
});
function mockFetch(ok: boolean, body: unknown) {
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok, status: ok ? 200 : 400, json: async () => body, text: async () => JSON.stringify(body)
  });
}

describe("family household + person client", () => {
  it("createPerson POSTs the name and family id", async () => {
    mockFetch(true, { id: "p1", firstName: "Jo", lastName: "Doe" });
    await createPerson({ firstName: "Jo", lastName: "Doe", familyGroupId: "fam1" }, getToken);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/api/v1/persons");
    expect(JSON.parse(init.body as string)).toMatchObject({ firstName: "Jo", lastName: "Doe", familyGroupId: "fam1" });
  });

  it("addFamilyMember POSTs personId with a default MEMBER role", async () => {
    mockFetch(true, { id: "m1", personId: "p1" });
    await addFamilyMember("fam1", "p1", getToken);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/api/v1/families/fam1/members");
    expect(JSON.parse(init.body as string)).toEqual({ personId: "p1", roles: ["MEMBER"] });
  });

  it("getHousehold GETs the detail", async () => {
    mockFetch(true, { id: "h1", name: "Home", linkedFamilies: [{ name: "The Smiths" }], members: [] });
    const r = await getHousehold("h1", getToken);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("http://localhost:4000/api/v1/households/h1");
    expect(r.linkedFamilies[0].name).toBe("The Smiths");
  });

  it("getHouseholdAudit GETs the audit entries", async () => {
    mockFetch(true, { entries: [] });
    await getHouseholdAudit("h1", getToken);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("http://localhost:4000/api/v1/households/h1/audit");
  });

  it("unlinkHousehold POSTs the family id and destroy flag", async () => {
    mockFetch(true, "");
    await unlinkHousehold("h1", { familyGroupId: "fam1", destroy: true }, getToken);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4000/api/v1/households/h1/unlink");
    expect(JSON.parse(init.body as string)).toEqual({ familyGroupId: "fam1", destroy: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/api/__tests__/family.household.client.test.ts`
Expected: FAIL with "is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `apps/web/lib/api/family.ts` (after the existing functions):

```ts
// ── PR-3: person create, member add, household detail ──────────────────────────

export interface CreatePersonInput {
  firstName: string;
  lastName: string;
  preferredName?: string;
  dateOfBirth?: string;
  ageGateLevel?: string;
  familyGroupId?: string;
}

export function createPerson(input: CreatePersonInput, getToken: GetToken): Promise<PersonBrief> {
  return apiFetch<PersonBrief>("/api/v1/persons", {
    getToken,
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function addFamilyMember(
  familyId: string,
  personId: string,
  getToken: GetToken
): Promise<{ id: string; personId: string }> {
  return apiFetch<{ id: string; personId: string }>(
    `/api/v1/families/${encodeURIComponent(familyId)}/members`,
    { getToken, method: "POST", body: JSON.stringify({ personId, roles: ["MEMBER"] }) }
  );
}

export interface HouseholdMemberEntry {
  id: string;
  personId: string;
  role: string | null;
  joinedAt: string;
  displayName: string;
}

export type HouseholdDetail = HouseholdSummary & {
  linkedFamilies: { id?: string; name: string }[];
  members: HouseholdMemberEntry[];
};

export function getHousehold(householdId: string, getToken: GetToken): Promise<HouseholdDetail> {
  return apiFetch<HouseholdDetail>(`/api/v1/households/${encodeURIComponent(householdId)}`, {
    getToken,
    method: "GET"
  });
}

export interface AuditEntry {
  id: string;
  actorPersonId?: string;
  actorFamilyGroupId?: string;
  actorDisplayName: string;
  actorFamilyName: string;
  action: string;
  changes: unknown;
  createdAt: string;
}

export function getHouseholdAudit(
  householdId: string,
  getToken: GetToken
): Promise<{ entries: AuditEntry[] }> {
  return apiFetch<{ entries: AuditEntry[] }>(
    `/api/v1/households/${encodeURIComponent(householdId)}/audit`,
    { getToken, method: "GET" }
  );
}

export function unlinkHousehold(
  householdId: string,
  input: { familyGroupId: string; destroy?: boolean },
  getToken: GetToken
): Promise<void> {
  return apiFetch<void>(`/api/v1/households/${encodeURIComponent(householdId)}/unlink`, {
    getToken,
    method: "POST",
    body: JSON.stringify(input)
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/api/__tests__/family.household.client.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api/family.ts apps/web/lib/api/__tests__/family.household.client.test.ts
git commit -m "feat: P3-04 add person, member, and household web API client functions"
```

---

## Task 4: Requests nav item and pending badge

**Files:**
- Modify: `apps/web/lib/nav.ts`
- Create: `apps/web/hooks/useLinkRequestCount.ts`
- Create: `apps/web/components/nav/RequestsBadge.tsx`
- Modify: `apps/web/components/nav/Sidebar.tsx`
- Modify: `apps/web/components/nav/TopNav.tsx`
- Test: `apps/web/components/nav/__tests__/RequestsBadge.test.tsx`

**Interfaces:**
- Consumes: `getPendingLinkRequests` (Task 1), `useAuth` from `@clerk/nextjs`, `useQuery` from `@tanstack/react-query`.
- Produces:
  - `useLinkRequestCount(): number`
  - `RequestsBadge` React component.
  - `NAV_ITEMS` gains `{ label: "Requests", href: "/requests", icon: "✉️" }`.

Note for the implementer: the React Query default refetches on mount, on navigation, and on window focus. That default satisfies the locked badge-refresh decision (spec §9). Add no polling.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/nav/__tests__/RequestsBadge.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const mockCount = vi.fn();
vi.mock("@/hooks/useLinkRequestCount", () => ({ useLinkRequestCount: () => mockCount() }));

import { RequestsBadge } from "@/components/nav/RequestsBadge";
import { NAV_ITEMS } from "@/lib/nav";

describe("RequestsBadge", () => {
  it("shows the count when there are pending requests", () => {
    mockCount.mockReturnValue(3);
    render(<RequestsBadge />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders nothing when the count is zero", () => {
    mockCount.mockReturnValue(0);
    const { container } = render(<RequestsBadge />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("NAV_ITEMS", () => {
  it("has a Requests item", () => {
    expect(NAV_ITEMS.some((i) => i.href === "/requests" && i.label === "Requests")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run components/nav/__tests__/RequestsBadge.test.tsx`
Expected: FAIL with "Failed to resolve import" for `RequestsBadge`.

- [ ] **Step 3: Write minimal implementation**

Add the item to `apps/web/lib/nav.ts` (before `Settings`):

```ts
  { label: "Requests",    href: "/requests",  icon: "✉️" },
```

```ts
// apps/web/hooks/useLinkRequestCount.ts
"use client";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getPendingLinkRequests } from "@/lib/api/linkRequests";

export function useLinkRequestCount(): number {
  const { getToken } = useAuth();
  const { data } = useQuery({
    queryKey: ["link-requests-pending"],
    queryFn: () => getPendingLinkRequests(getToken)
  });
  return data?.requests.length ?? 0;
}
```

```tsx
// apps/web/components/nav/RequestsBadge.tsx
"use client";
import { useLinkRequestCount } from "@/hooks/useLinkRequestCount";

export function RequestsBadge() {
  const count = useLinkRequestCount();
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} pending requests`}
      style={{
        marginLeft: "6px",
        minWidth: "16px",
        height: "16px",
        padding: "0 5px",
        borderRadius: "8px",
        background: "var(--color-primary, #6366f1)",
        color: "#fff",
        fontSize: "10px",
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      {count}
    </span>
  );
}
```

In `apps/web/components/nav/Sidebar.tsx`, import the badge and render it for the Requests item. Add the import near the top:

```tsx
import { RequestsBadge } from "@/components/nav/RequestsBadge";
```

Then, in the `NavItemRow` return for a plain link (the `<Link>` block), add the badge after `{item.label}`:

```tsx
      {item.label}
      {item.href === "/requests" && <RequestsBadge />}
    </Link>
```

In `apps/web/components/nav/TopNav.tsx`, import the badge and render it in the `DropdownItem` non-children `<Link>` branch after `{item.label}`:

```tsx
import { RequestsBadge } from "@/components/nav/RequestsBadge";
```

```tsx
        {item.label}
        {item.href === "/requests" && <RequestsBadge />}
      </Link>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run components/nav/__tests__/RequestsBadge.test.tsx components/nav/__tests__/Sidebar.test.tsx`
Expected: PASS. The existing `Sidebar.test.tsx` mocks `@/lib/nav` with no `/requests` item, so the badge does not render there and needs no query client.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/nav.ts apps/web/hooks/useLinkRequestCount.ts apps/web/components/nav/RequestsBadge.tsx apps/web/components/nav/Sidebar.tsx apps/web/components/nav/TopNav.tsx apps/web/components/nav/__tests__/RequestsBadge.test.tsx
git commit -m "feat: P3-04 add Requests nav item with a pending-count badge"
```

---

## Task 5: Consent inbox page

**Files:**
- Create: `apps/web/app/(protected)/requests/page.tsx`
- Test: `apps/web/app/(protected)/requests/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `getPendingLinkRequests`, `acceptLinkRequest`, `declineLinkRequest`, `InboxRequest` (Task 1); `useAuth`; `useQuery`, `useMutation`, `useQueryClient`.
- Produces: the default-exported `RequestsPage` client component.

The page lists pending requests newest first (the server returns them; the page keeps the order). Each row shows the requesting family name and a purpose line. Each row has an Accept control and a Decline control. On success the page invalidates both the list query and the badge query (`["link-requests-pending"]`). The page shows names only. It shows no id and no roster. An empty list shows an empty state.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/(protected)/requests/__tests__/page.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue("t") }) }));

const mockAccept = vi.fn().mockResolvedValue({ id: "lr1", status: "ACCEPTED", granted: true, resolvedAt: null });
const mockDecline = vi.fn().mockResolvedValue({ id: "lr1", status: "DECLINED", resolvedAt: null });
vi.mock("@/lib/api/linkRequests", () => ({
  getPendingLinkRequests: vi.fn(),
  acceptLinkRequest: (...a: unknown[]) => mockAccept(...a),
  declineLinkRequest: (...a: unknown[]) => mockDecline(...a)
}));

const queryData: Record<string, unknown> = {};
const invalidate = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({ data: queryData[String(queryKey[0])], isLoading: false }),
  useMutation: ({ mutationFn, onSuccess }: { mutationFn: (v: unknown) => Promise<unknown>; onSuccess?: () => void }) => ({
    mutate: async (vars: unknown) => { await mutationFn(vars); onSuccess?.(); },
    isPending: false
  }),
  useQueryClient: () => ({ invalidateQueries: invalidate })
}));

import RequestsPage from "../page";

beforeEach(() => {
  mockAccept.mockClear();
  mockDecline.mockClear();
  invalidate.mockClear();
  queryData["link-requests-pending"] = {
    requests: [
      { id: "lr1", kind: "FAMILY_MEMBERSHIP", direction: "PULL", requestingFamilyName: "The Smiths", targetName: "You", carryHouseholdName: null, notice: "n" }
    ]
  };
});

describe("RequestsPage", () => {
  it("lists the requesting family name and no id", () => {
    render(<RequestsPage />);
    expect(screen.getByText("The Smiths")).toBeInTheDocument();
    expect(screen.queryByText(/lr1/)).toBeNull();
  });

  it("accepts a request and invalidates the queries", async () => {
    render(<RequestsPage />);
    await userEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(mockAccept).toHaveBeenCalledWith("lr1", expect.anything());
    expect(invalidate).toHaveBeenCalled();
  });

  it("declines a request", async () => {
    render(<RequestsPage />);
    await userEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(mockDecline).toHaveBeenCalledWith("lr1", expect.anything());
  });

  it("shows an empty state when there are no requests", () => {
    queryData["link-requests-pending"] = { requests: [] };
    render(<RequestsPage />);
    expect(screen.getByText(/no pending requests/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run "app/(protected)/requests/__tests__/page.test.tsx"`
Expected: FAIL with "Failed to resolve import" for `../page`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/web/app/(protected)/requests/page.tsx
"use client";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPendingLinkRequests,
  acceptLinkRequest,
  declineLinkRequest,
  type InboxRequest
} from "@/lib/api/linkRequests";

function purposeLine(r: InboxRequest): string {
  if (r.kind === "HOUSEHOLD_LINK") {
    return `${r.requestingFamilyName} asks to link the household ${r.targetHouseholdName ?? ""}`.trim();
  }
  if (r.direction === "JOIN") {
    return `${r.targetName ?? "Someone"} asks to join ${r.requestingFamilyName}`;
  }
  return `${r.requestingFamilyName} asks to add ${r.targetName ?? "you"}`;
}

export default function RequestsPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["link-requests-pending"],
    queryFn: () => getPendingLinkRequests(getToken)
  });
  const requests = data?.requests ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["link-requests-pending"] });
  }

  const accept = useMutation({ mutationFn: (id: string) => acceptLinkRequest(id, getToken), onSuccess: invalidate });
  const decline = useMutation({ mutationFn: (id: string) => declineLinkRequest(id, getToken), onSuccess: invalidate });
  const busy = accept.isPending || decline.isPending;

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "16px" }}>
        Requests
      </h1>

      {requests.length === 0 && (
        <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>You have no pending requests.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {requests.map((r) => (
          <div
            key={r.id}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              padding: "14px 16px"
            }}
          >
            <div style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: 600 }}>
              {r.requestingFamilyName}
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "4px 0 12px" }}>
              {purposeLine(r)}
            </div>
            {r.carryHouseholdName && (
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "12px" }}>
                Also adds you to the household {r.carryHouseholdName}.
              </div>
            )}
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => accept.mutate(r.id)}
                disabled={busy}
                style={{
                  padding: "8px 18px",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--color-primary, #6366f1)",
                  color: "#fff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: busy ? "not-allowed" : "pointer"
                }}
              >
                Accept
              </button>
              <button
                onClick={() => decline.mutate(r.id)}
                disabled={busy}
                style={{
                  padding: "8px 18px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "var(--bg-card)",
                  color: "var(--text-secondary)",
                  fontSize: "13px",
                  cursor: busy ? "not-allowed" : "pointer"
                }}
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run "app/(protected)/requests/__tests__/page.test.tsx"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(protected)/requests/page.tsx" "apps/web/app/(protected)/requests/__tests__/page.test.tsx"
git commit -m "feat: P3-04 add the consent inbox page"
```

---

## Task 6: Public consent token page

**Files:**
- Create: `apps/web/app/consent/[token]/page.tsx`
- Create: `apps/web/app/consent/[token]/ConsentAccept.tsx`
- Test: `apps/web/app/consent/[token]/__tests__/ConsentAccept.test.tsx`

**Interfaces:**
- Consumes: `getConsentRequest`, `acceptConsentRequest`, `ConsentView` (Task 2).
- Produces: the server `ConsentPage` (mirrors `app/rsvp/[token]/page.tsx`) and the `ConsentAccept` client component.

The page shows the requesting family name and the consent notice. It shows an Accept control only. It shows no Decline control (spec §4.3, locked 2026-09-02). The page renders a state for each token condition: pending, accepted, declined, and a not-found state when the get throws (expired, used, or invalid). The page shows no id and no roster.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/consent/[token]/__tests__/ConsentAccept.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAccept = vi.fn();
vi.mock("@/lib/api/consent", () => ({ acceptConsentRequest: (...a: unknown[]) => mockAccept(...a) }));

import { ConsentAccept } from "../ConsentAccept";

beforeEach(() => mockAccept.mockReset());

describe("ConsentAccept", () => {
  it("shows an Accept control and no Decline control for a pending request", () => {
    render(<ConsentAccept token="tok1" initialStatus="PENDING" />);
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /decline/i })).toBeNull();
  });

  it("shows the accepted state after a successful accept", async () => {
    mockAccept.mockResolvedValue({ granted: true, status: "ACCEPTED" });
    render(<ConsentAccept token="tok1" initialStatus="PENDING" />);
    await userEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(mockAccept).toHaveBeenCalledWith("tok1");
    expect(await screen.findByText(/you are now a member/i)).toBeInTheDocument();
  });

  it("shows a resolved message when the accept returns not granted", async () => {
    mockAccept.mockResolvedValue({ granted: false, status: "EXPIRED" });
    render(<ConsentAccept token="tok1" initialStatus="PENDING" />);
    await userEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
  });

  it("shows the accepted state up front when the request is already accepted", () => {
    render(<ConsentAccept token="tok1" initialStatus="ACCEPTED" />);
    expect(screen.getByText(/you are now a member/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run "app/consent/[token]/__tests__/ConsentAccept.test.tsx"`
Expected: FAIL with "Failed to resolve import" for `../ConsentAccept`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/web/app/consent/[token]/ConsentAccept.tsx
"use client";
import { useState } from "react";
import { acceptConsentRequest } from "@/lib/api/consent";

interface Props {
  token: string;
  initialStatus: string;
}

export function ConsentAccept({ token, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(false);
  const [resolvedMessage, setResolvedMessage] = useState<string | null>(null);

  async function accept() {
    if (loading) return;
    setLoading(true);
    try {
      const result = await acceptConsentRequest(token);
      if (result.granted) {
        setStatus("ACCEPTED");
      } else {
        setResolvedMessage("This request is no longer available.");
        setStatus(result.status);
      }
    } finally {
      setLoading(false);
    }
  }

  if (status === "ACCEPTED") {
    return (
      <p style={{ textAlign: "center", fontSize: "14px", color: "var(--text-secondary)", padding: "24px 0" }}>
        You are now a member.
      </p>
    );
  }

  if (status === "DECLINED") {
    return (
      <p style={{ textAlign: "center", fontSize: "14px", color: "var(--text-muted)", padding: "24px 0" }}>
        This request was declined.
      </p>
    );
  }

  return (
    <div style={{ padding: "24px 0" }}>
      {resolvedMessage && (
        <p style={{ textAlign: "center", fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px" }}>
          {resolvedMessage}
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <button
          onClick={accept}
          disabled={loading || resolvedMessage !== null}
          style={{
            padding: "12px 28px",
            borderRadius: "8px",
            border: "none",
            background: "var(--color-primary, #6366f1)",
            color: "#fff",
            fontSize: "15px",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          {loading ? "Accepting…" : "Accept"}
        </button>
      </div>
    </div>
  );
}
```

```tsx
// apps/web/app/consent/[token]/page.tsx
import { notFound } from "next/navigation";
import { getConsentRequest } from "@/lib/api/consent";
import { ConsentAccept } from "./ConsentAccept";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function ConsentPage({ params }: Props) {
  const { token } = await params;

  let data: Awaited<ReturnType<typeof getConsentRequest>> | undefined;
  try {
    data = await getConsentRequest(token);
  } catch {
    notFound();
  }
  if (!data) notFound();

  const { familyName, targetName, status, notice } = data;

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--bg-page, #f8fafc)", padding: "24px"
    }}>
      <div style={{
        maxWidth: "480px", width: "100%", background: "var(--bg-card, #fff)",
        borderRadius: "12px", border: "1px solid var(--border, #e2e8f0)",
        padding: "32px", boxShadow: "0 4px 16px rgba(0,0,0,0.08)"
      }}>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: ".05em" }}>
          {familyName}
        </p>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 16px" }}>
          Join request
        </h1>
        {targetName && (
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "8px" }}>
            Hello, <strong>{targetName}</strong>.
          </p>
        )}
        <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "0" }}>
          {notice}
        </p>
        <ConsentAccept token={token} initialStatus={status} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run "app/consent/[token]/__tests__/ConsentAccept.test.tsx"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/consent/[token]/page.tsx" "apps/web/app/consent/[token]/ConsentAccept.tsx" "apps/web/app/consent/[token]/__tests__/ConsentAccept.test.tsx"
git commit -m "feat: P3-04 add the public consent token page (accept only)"
```

---

## Task 7: Unified add-member form

**Files:**
- Create: `apps/web/components/family/AddMemberForm.tsx`
- Modify: `apps/web/app/(protected)/family/[familyId]/page.tsx`
- Test: `apps/web/components/family/__tests__/AddMemberForm.test.tsx`

**Interfaces:**
- Consumes: `createPerson`, `addFamilyMember` (Task 3); `createLinkRequest` (Task 1); `useAuth`.
- Produces: `AddMemberForm({ familyId, households }: { familyId: string; households: { id: string; name: string }[] })`.

The form collects a first name, a last name, and an optional email or phone. The name applies to the no-contact path only. The contact path creates the person from the contact on the server, so the create-link-request call sends no name. The form shows an adult-attestation checkbox only when the user enters a contact and gives no date of birth. The form offers a carry-household control when `households` is non-empty. The form sends `carryHouseholdId` on the link-request call only.

The submit logic obeys decision 8:
- With a contact: call `createLinkRequest` with `targetEmail` or `targetPhone`, then show "Invitation sent, pending consent".
- With no contact: call `createPerson`, then `addFamilyMember` with the returned id.
- If `addFamilyMember` throws an error whose message contains `CONSENT_REQUIRED`: call `createLinkRequest` with the created `personId` as `targetPersonId`, then show "Invitation sent, pending consent" (the retry is silent).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/family/__tests__/AddMemberForm.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue("t") }) }));

const mockCreatePerson = vi.fn();
const mockAddMember = vi.fn();
vi.mock("@/lib/api/family", () => ({
  createPerson: (...a: unknown[]) => mockCreatePerson(...a),
  addFamilyMember: (...a: unknown[]) => mockAddMember(...a)
}));
const mockCreateLR = vi.fn();
vi.mock("@/lib/api/linkRequests", () => ({ createLinkRequest: (...a: unknown[]) => mockCreateLR(...a) }));

import { AddMemberForm } from "@/components/family/AddMemberForm";

beforeEach(() => {
  mockCreatePerson.mockReset();
  mockAddMember.mockReset();
  mockCreateLR.mockReset();
});

async function fillName() {
  await userEvent.type(screen.getByLabelText(/first name/i), "Jo");
  await userEvent.type(screen.getByLabelText(/last name/i), "Doe");
}

describe("AddMemberForm", () => {
  it("no contact: creates a person then adds a member", async () => {
    mockCreatePerson.mockResolvedValue({ id: "p1" });
    mockAddMember.mockResolvedValue({ id: "m1", personId: "p1" });
    render(<AddMemberForm familyId="fam1" households={[]} />);
    await fillName();
    await userEvent.click(screen.getByRole("button", { name: /add member/i }));
    expect(mockCreatePerson).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Jo", lastName: "Doe", familyGroupId: "fam1" }),
      expect.anything()
    );
    expect(mockAddMember).toHaveBeenCalledWith("fam1", "p1", expect.anything());
  });

  it("with contact: creates a link request and shows the pending message", async () => {
    mockCreateLR.mockResolvedValue({ id: "lr1", status: "PENDING" });
    render(<AddMemberForm familyId="fam1" households={[]} />);
    await fillName();
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.click(screen.getByRole("button", { name: /add member/i }));
    expect(mockCreateLR).toHaveBeenCalledWith(
      expect.objectContaining({ familyGroupId: "fam1", direction: "PULL", targetEmail: "a@b.com" }),
      expect.anything()
    );
    expect(await screen.findByText(/pending consent/i)).toBeInTheDocument();
  });

  it("no contact 409: retries silently as a link request", async () => {
    mockCreatePerson.mockResolvedValue({ id: "p1" });
    mockAddMember.mockRejectedValue(new Error("API 409: CONSENT_REQUIRED"));
    mockCreateLR.mockResolvedValue({ id: "lr1", status: "PENDING" });
    render(<AddMemberForm familyId="fam1" households={[]} />);
    await fillName();
    await userEvent.click(screen.getByRole("button", { name: /add member/i }));
    expect(mockCreateLR).toHaveBeenCalledWith(
      expect.objectContaining({ familyGroupId: "fam1", targetPersonId: "p1" }),
      expect.anything()
    );
    expect(await screen.findByText(/pending consent/i)).toBeInTheDocument();
  });

  it("shows the attestation checkbox only when a contact is entered without a date of birth", async () => {
    render(<AddMemberForm familyId="fam1" households={[]} />);
    expect(screen.queryByLabelText(/adult/i)).toBeNull();
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    expect(screen.getByLabelText(/adult/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run components/family/__tests__/AddMemberForm.test.tsx`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/web/components/family/AddMemberForm.tsx
"use client";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { createPerson, addFamilyMember } from "@/lib/api/family";
import { createLinkRequest } from "@/lib/api/linkRequests";

interface Props {
  familyId: string;
  households: { id: string; name: string }[];
}

const inputStyle = {
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid var(--border)",
  background: "var(--bg-card)",
  fontSize: "14px",
  color: "var(--text-primary)"
} as const;

export function AddMemberForm({ familyId, households }: Props) {
  const { getToken } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [attestedAdult, setAttestedAdult] = useState(false);
  const [carryHouseholdId, setCarryHouseholdId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const hasContact = email.trim() !== "" || phone.trim() !== "";
  const showAttestation = hasContact && dateOfBirth.trim() === "";

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      if (hasContact) {
        await createLinkRequest(
          {
            kind: "FAMILY_MEMBERSHIP",
            direction: "PULL",
            familyGroupId: familyId,
            targetEmail: email.trim() || undefined,
            targetPhone: phone.trim() || undefined,
            attestedAdult: attestedAdult || undefined,
            carryHouseholdId: carryHouseholdId || undefined
          },
          getToken
        );
        setMessage("Invitation sent, pending consent.");
        return;
      }

      const person = await createPerson(
        { firstName: firstName.trim(), lastName: lastName.trim(), dateOfBirth: dateOfBirth.trim() || undefined, familyGroupId: familyId },
        getToken
      );
      try {
        await addFamilyMember(familyId, person.id, getToken);
        setMessage("Member added.");
      } catch (err) {
        if (err instanceof Error && err.message.includes("CONSENT_REQUIRED")) {
          await createLinkRequest(
            {
              kind: "FAMILY_MEMBERSHIP",
              direction: "PULL",
              familyGroupId: familyId,
              targetPersonId: person.id,
              carryHouseholdId: carryHouseholdId || undefined
            },
            getToken
          );
          setMessage("Invitation sent, pending consent.");
        } else {
          throw err;
        }
      }
    } catch {
      setMessage("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: "24px", maxWidth: "480px" }}>
      <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "8px" }}>
        Add a member
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>First name
          <input aria-label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Last name
          <input aria-label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Email (optional)
          <input aria-label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Phone (optional)
          <input aria-label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Date of birth (optional)
          <input aria-label="Date of birth" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} style={inputStyle} />
        </label>

        {showAttestation && (
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--text-secondary)" }}>
            <input type="checkbox" aria-label="This person is an adult" checked={attestedAdult} onChange={(e) => setAttestedAdult(e.target.checked)} />
            This person is an adult.
          </label>
        )}

        {households.length > 0 && (
          <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>Also add to household
            <select aria-label="Also add to household" value={carryHouseholdId} onChange={(e) => setCarryHouseholdId(e.target.value)} style={inputStyle}>
              <option value="">No household</option>
              {households.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <button
        onClick={submit}
        disabled={busy}
        style={{
          marginTop: "12px",
          padding: "10px 20px",
          borderRadius: "8px",
          border: "none",
          background: "var(--color-primary, #6366f1)",
          color: "#fff",
          fontSize: "14px",
          fontWeight: 600,
          cursor: busy ? "not-allowed" : "pointer"
        }}
      >
        {busy ? "Working…" : "Add member"}
      </button>

      {message && (
        <p style={{ marginTop: "10px", fontSize: "13px", color: "var(--text-secondary)" }}>{message}</p>
      )}
    </section>
  );
}
```

Mount the form on the family page. In `apps/web/app/(protected)/family/[familyId]/page.tsx`, add the import and render the form under the members grid. Build the `households` prop from the page's `data.households`:

```tsx
import { AddMemberForm } from "@/components/family/AddMemberForm";
```

```tsx
        <MemberGrid members={allMembers} familyId={familyId} />
        <AddMemberForm
          familyId={familyId}
          households={households.map((h) => ({ id: h.household.id, name: h.household.name }))}
        />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run components/family/__tests__/AddMemberForm.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/family/AddMemberForm.tsx "apps/web/app/(protected)/family/[familyId]/page.tsx" apps/web/components/family/__tests__/AddMemberForm.test.tsx
git commit -m "feat: P3-04 add the unified add-member form"
```

---

## Task 8: Household linked-families, audit, and unlink section

**Files:**
- Create: `apps/web/components/family/HouseholdSection.tsx`
- Modify: `apps/web/app/(protected)/family/[familyId]/page.tsx`
- Test: `apps/web/components/family/__tests__/HouseholdSection.test.tsx`

**Interfaces:**
- Consumes: `getHousehold`, `getHouseholdAudit`, `unlinkHousehold`, `HouseholdDetail`, `AuditEntry` (Task 3); `useAuth`; `useQuery`, `useMutation`, `useQueryClient`.
- Produces: `HouseholdSection({ householdId, familyId }: { householdId: string; familyId: string })`.

The section shows the linked family names from `getHousehold`. It shows an Activity view (a section, not a route) with the audit entries: the actor display name, the action, and the timestamp. The section has an unlink control that calls `unlinkHousehold` with the current `familyId`. A thrown error whose message contains `LAST_LINK` shows a destroy-confirm prompt. A confirm calls `unlinkHousehold` again with `destroy: true`. The section shows names only, and no id.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/family/__tests__/HouseholdSection.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue("t") }) }));

const mockUnlink = vi.fn();
vi.mock("@/lib/api/family", () => ({
  getHousehold: vi.fn(),
  getHouseholdAudit: vi.fn(),
  unlinkHousehold: (...a: unknown[]) => mockUnlink(...a)
}));

const queryData: Record<string, unknown> = {};
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({ data: queryData[String(queryKey[0])], isLoading: false }),
  useMutation: ({ mutationFn, onSuccess, onError }: { mutationFn: (v: unknown) => Promise<unknown>; onSuccess?: () => void; onError?: (e: unknown) => void }) => ({
    mutate: async (vars: unknown) => { try { await mutationFn(vars); onSuccess?.(); } catch (e) { onError?.(e); } },
    isPending: false
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() })
}));

import { HouseholdSection } from "@/components/family/HouseholdSection";

beforeEach(() => {
  mockUnlink.mockReset();
  queryData["household"] = { id: "h1", name: "Home", linkedFamilies: [{ name: "The Smiths" }, { name: "The Roes" }], members: [] };
  queryData["household-audit"] = { entries: [{ id: "a1", actorDisplayName: "Al", actorFamilyName: "The Smiths", action: "RENAMED", changes: {}, createdAt: "2026-09-01T00:00:00Z" }] };
});

describe("HouseholdSection", () => {
  it("shows the linked family names and no id", () => {
    render(<HouseholdSection householdId="h1" familyId="fam1" />);
    expect(screen.getByText("The Smiths")).toBeInTheDocument();
    expect(screen.getByText("The Roes")).toBeInTheDocument();
    expect(screen.queryByText(/h1/)).toBeNull();
  });

  it("shows an audit entry actor name and action", () => {
    render(<HouseholdSection householdId="h1" familyId="fam1" />);
    expect(screen.getByText(/Al/)).toBeInTheDocument();
    expect(screen.getByText(/RENAMED/)).toBeInTheDocument();
  });

  it("unlinks with the current family id", async () => {
    mockUnlink.mockResolvedValue(undefined);
    render(<HouseholdSection householdId="h1" familyId="fam1" />);
    await userEvent.click(screen.getByRole("button", { name: /unlink/i }));
    expect(mockUnlink).toHaveBeenCalledWith("h1", { familyGroupId: "fam1" }, expect.anything());
  });

  it("shows a destroy confirm on LAST_LINK and destroys on confirm", async () => {
    mockUnlink.mockRejectedValueOnce(new Error("API 409: LAST_LINK"));
    render(<HouseholdSection householdId="h1" familyId="fam1" />);
    await userEvent.click(screen.getByRole("button", { name: /unlink/i }));
    const destroyBtn = await screen.findByRole("button", { name: /delete the household/i });
    mockUnlink.mockResolvedValueOnce(undefined);
    await userEvent.click(destroyBtn);
    expect(mockUnlink).toHaveBeenLastCalledWith("h1", { familyGroupId: "fam1", destroy: true }, expect.anything());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run components/family/__tests__/HouseholdSection.test.tsx`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/web/components/family/HouseholdSection.tsx
"use client";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getHousehold, getHouseholdAudit, unlinkHousehold } from "@/lib/api/family";

interface Props {
  householdId: string;
  familyId: string;
}

export function HouseholdSection({ householdId, familyId }: Props) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [confirmDestroy, setConfirmDestroy] = useState(false);

  const { data: household } = useQuery({
    queryKey: ["household", householdId],
    queryFn: () => getHousehold(householdId, getToken)
  });
  const { data: audit } = useQuery({
    queryKey: ["household-audit", householdId],
    queryFn: () => getHouseholdAudit(householdId, getToken)
  });

  const unlink = useMutation({
    mutationFn: (destroy: boolean) =>
      unlinkHousehold(householdId, { familyGroupId: familyId, ...(destroy ? { destroy: true } : {}) }, getToken),
    onSuccess: () => {
      setConfirmDestroy(false);
      queryClient.invalidateQueries({ queryKey: ["family-detail", familyId] });
    },
    onError: (err: unknown) => {
      if (err instanceof Error && err.message.includes("LAST_LINK")) setConfirmDestroy(true);
    }
  });

  const linkedFamilies = household?.linkedFamilies ?? [];
  const entries = audit?.entries ?? [];

  return (
    <section style={{ marginTop: "24px", maxWidth: "480px" }}>
      <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "8px" }}>
        Household {household?.name ? `· ${household.name}` : ""}
      </div>

      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>Linked families</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "16px" }}>
        {linkedFamilies.map((f, i) => (
          <div key={i} style={{ fontSize: "14px", color: "var(--text-primary)" }}>{f.name}</div>
        ))}
      </div>

      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>Activity</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
        {entries.map((e) => (
          <div key={e.id} style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            {e.actorDisplayName} · {e.action} · {new Date(e.createdAt).toLocaleDateString("en-US")}
          </div>
        ))}
      </div>

      {!confirmDestroy && (
        <button
          onClick={() => unlink.mutate(false)}
          disabled={unlink.isPending}
          style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)", fontSize: "13px", cursor: "pointer" }}
        >
          Unlink this family
        </button>
      )}

      {confirmDestroy && (
        <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          <p style={{ marginBottom: "8px" }}>This is the last linked family. Unlinking deletes the household.</p>
          <button
            onClick={() => unlink.mutate(true)}
            disabled={unlink.isPending}
            style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: "#dc2626", color: "#fff", fontSize: "13px", cursor: "pointer" }}
          >
            Delete the household
          </button>
        </div>
      )}
    </section>
  );
}
```

Mount the section on the family page under each household. In `apps/web/app/(protected)/family/[familyId]/page.tsx`, add the import and render a `HouseholdSection` per household:

```tsx
import { HouseholdSection } from "@/components/family/HouseholdSection";
```

```tsx
        {households.map((h) => (
          <HouseholdSection key={h.household.id} householdId={h.household.id} familyId={familyId} />
        ))}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run components/family/__tests__/HouseholdSection.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/family/HouseholdSection.tsx "apps/web/app/(protected)/family/[familyId]/page.tsx" apps/web/components/family/__tests__/HouseholdSection.test.tsx
git commit -m "feat: P3-04 add the household linked-families, audit, and unlink section"
```

---

## Task 9: Organizer skip-notices

**Files:**
- Create: `apps/web/components/events/SkipNotices.tsx`
- Modify: `apps/web/lib/api/events.ts` (widen the `sendInvitations` return type to include `skipped`)
- Modify: `apps/web/app/(protected)/events/[eventId]/invite/page.tsx` (render the notices)
- Test: `apps/web/components/events/__tests__/SkipNotices.test.tsx`

**Interfaces:**
- Consumes: nothing new — reads the `skipped` array the invite response returns.
- Produces:
  - `SkipNotice` = `{ displayName: string; reason: "MINOR_NON_MEMBER" | "NO_CONTACT" }`
  - `SkipNotices({ notices }: { notices: SkipNotice[] })`

The API `POST /events/:eventId/invitations` returns `{ invitations, skipped }`. The `skipped` array names each skipped resident of a HOUSEHOLD-scope invite. The notice names the resident only. The notice is not a blocker.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/events/__tests__/SkipNotices.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SkipNotices } from "@/components/events/SkipNotices";

describe("SkipNotices", () => {
  it("renders nothing when there are no notices", () => {
    const { container } = render(<SkipNotices notices={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names each skipped resident with a reason", () => {
    render(<SkipNotices notices={[
      { displayName: "Sam", reason: "MINOR_NON_MEMBER" },
      { displayName: "Pat", reason: "NO_CONTACT" }
    ]} />);
    expect(screen.getByText(/Sam/)).toBeInTheDocument();
    expect(screen.getByText(/Pat/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run components/events/__tests__/SkipNotices.test.tsx`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/web/components/events/SkipNotices.tsx
export interface SkipNotice {
  displayName: string;
  reason: "MINOR_NON_MEMBER" | "NO_CONTACT";
}

const REASON_TEXT: Record<SkipNotice["reason"], string> = {
  MINOR_NON_MEMBER: "is a minor who is not a member of this family",
  NO_CONTACT: "has no contact detail"
};

export function SkipNotices({ notices }: { notices: SkipNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <div style={{ marginTop: "12px", padding: "12px 14px", borderRadius: "8px", background: "var(--bg-card)", border: "1px solid var(--border)" }}>
      <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-muted)", marginBottom: "6px" }}>
        Some residents were not invited
      </div>
      {notices.map((n, i) => (
        <div key={i} style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          {n.displayName} {REASON_TEXT[n.reason]}.
        </div>
      ))}
    </div>
  );
}
```

Widen the `sendInvitations` return type in `apps/web/lib/api/events.ts`. Find the `sendInvitations` function (near line 196) and change its return type to include `skipped`:

```ts
export async function sendInvitations(
  eventId: string,
  invitees: InviteeEntry[],
  getToken: GetToken
): Promise<{ invitations: unknown[]; skipped?: { displayName: string; reason: "MINOR_NON_MEMBER" | "NO_CONTACT" }[] }> {
```

(Keep the existing body. Adjust only the return type. If the body already declares a narrower type variable, widen it to match.)

Render the notices on the invite page. In `apps/web/app/(protected)/events/[eventId]/invite/page.tsx`:

- Add the import:

```tsx
import { SkipNotices, type SkipNotice } from "@/components/events/SkipNotices";
```

- Add state near the other `useState` calls:

```tsx
  const [skipped, setSkipped] = useState<SkipNotice[]>([]);
```

- In `handleSend`, capture the result and set the notices instead of navigating away immediately when there are notices:

```tsx
    if (invitees.length > 0) {
      const result = await sendInvitations(eventId, invitees, getToken);
      const notices = (result.skipped ?? []) as SkipNotice[];
      if (notices.length > 0) {
        setSkipped(notices);
        setSending(false);
        return;
      }
    }
    router.push(`/events/${eventId}`);
```

- Render `<SkipNotices notices={skipped} />` above the action buttons (before the `<div style={{ display: "flex", gap: "12px" }}>` block).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run components/events/__tests__/SkipNotices.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full coverage gate and lint**

Run: `cd apps/web && npx vitest run --coverage`
Expected: PASS, lines coverage at or above 80%.

Run: `cd .. && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/events/SkipNotices.tsx apps/web/lib/api/events.ts "apps/web/app/(protected)/events/[eventId]/invite/page.tsx" apps/web/components/events/__tests__/SkipNotices.test.tsx
git commit -m "feat: P3-04 surface organizer skip-notices on the invite page"
```

---

## Self-Review

**Spec coverage:**
- §4.1 Requests nav item + badge → Task 4.
- §4.2 Consent inbox → Task 5.
- §4.3 Public consent token page (accept only) → Task 6.
- §4.4 Unified add-member flow → Task 7 (client functions in Tasks 1 and 3).
- §4.5 Household linked-families, audit, unlink → Task 8.
- §4.6 Organizer skip-notices → Task 9.
- §5 Client layer → Tasks 1, 2, 3.
- §6 Isolation render tests → covered in the page/component tests (no id, no roster) in Tasks 5, 6, 8.
- §7 Coverage gate → Task 9 Step 5 runs the whole-suite coverage gate; every task runs its own tests.

**Type consistency:** `getPendingLinkRequests` returns `{ requests: InboxRequest[] }` in Task 1 and the badge hook (Task 4) and inbox (Task 5) read `data.requests`. `createLinkRequest`, `createPerson`, `addFamilyMember` signatures match between Tasks 1/3 and Task 7. `unlinkHousehold` signature matches between Task 3 and Task 8.

**Open implementation notes for the reviewer:**
- The typed name in the add-member form (Task 7) applies to the no-contact path only. The contact path creates the person from the contact on the server, so the name is not sent. This follows the PR-2 API (`POST /api/v1/link-requests` takes no name). This is intentional, not a bug.
- The CONSENT_REQUIRED detection uses the thrown `apiFetch` error message (`API 409: CONSENT_REQUIRED`). If PR-2 changes that error string, update the `includes("CONSENT_REQUIRED")` check.
