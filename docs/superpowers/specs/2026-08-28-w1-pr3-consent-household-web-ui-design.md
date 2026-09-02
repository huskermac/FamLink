# W1 PR-3 — Consent and Household Web UI (design spec)

Date: 2026-08-28. Phase: P3-04.

Parent spec: `docs/superpowers/specs/2026-07-14-w1-household-family-m2m-design.md` (§6 API
surface, §7 isolation invariants). This spec covers the web UI only. PR-1 and PR-2 built the
API. This slice consumes it and adds no endpoint.

## 1. Goal

Give the web app the consent and household surfaces for the W1 Household↔Family reframe. A
family admin can start a membership consent request. A counterparty can accept or decline a
request from an inbox or a public token page. A member can see the families that a household
links to and can see the household activity log.

## 2. Locked scope (Steve, 2026-08-28)

Steve locked the scope in this brainstorm session.

- **Scope B — core plus membership-request create UI.** The mandatory core is the counterparty
  and display surfaces. PR-3 adds the requester-side create UI for membership requests only.
- **Consent inbox placement — a new top-level "Requests" navigation item** with a
  pending-count badge.
- **Add-member flow — one unified form.** The form applies decision 8 to choose a consent
  request or a data-entry add. The user sees only the outcome.
- **Household-link create UI — deferred** to a later slice. The household display, the audit
  view, and the unlink control still ship in the core.
- **Onboarding consent routing — deferred** to its own slice. `InviteStep` keeps its current
  behavior in this PR.

## 3. API surface consumed (no change in this PR)

PR-2 built these endpoints. The route names below match the live code. Some names differ from
the parent design. This spec uses the live names.

- `GET /api/v1/link-requests/pending` — the consent inbox list.
- `POST /api/v1/link-requests/:id/accept` and `POST /api/v1/link-requests/:id/decline`.
- `POST /api/v1/link-requests` — create a membership request. The family id goes in the request
  body as `familyGroupId`. This is the live route. The parent design named
  `/families/:familyId/link-requests`. The code put the family id in the body instead.
- `POST /api/v1/families/:familyId/members` — the direct data-entry add. The body needs an
  existing `personId`. It returns `409 CONSENT_REQUIRED` when the target is a reachable party.
- `POST /api/v1/persons` — create a Person. The body takes a name and an optional
  `familyGroupId`. A create with `familyGroupId` and no account stamps `createdByFamilyGroupId`,
  which makes the record a data-entry record that the family owns.
- The public consent token endpoints for the get and the accept of `/consent/{token}`. The
  public path has an accept endpoint only. It has no decline endpoint.
- `GET /api/v1/households/:id` — returns `linkedFamilies: [{id?, name}]`.
- `GET /api/v1/households/:id/audit` and `POST /api/v1/households/:id/unlink`.

## 4. Surfaces

### 4.1 Navigation

Add a top-level `Requests` item to `apps/web/lib/nav.ts`. The item shows a pending-count badge.
The count comes from `GET /link-requests/pending`. The badge shows on both the sidebar and the
top navigation. A zero count hides the badge.

### 4.2 Consent inbox

New route `app/(protected)/requests/page.tsx`. It lists the pending `LinkRequest` records where
the caller is a valid counterparty (parent spec §7 matrix). Each row shows the requesting
family name and the request purpose. The purpose text names the kind:

- a membership request that adds the caller,
- a guardian-consent request for a named minor,
- a household-link request.

Each row has an Accept control and a Decline control. The controls call the accept and decline
endpoints. On success the row resolves to its new state. The page shows names only. It shows no
family id and no roster (invariants 1 and 6). An empty inbox shows an empty state.

### 4.3 Consent token page

New public route `app/consent/[token]/page.tsx`. It uses the same pattern as `app/rsvp/[token]`.
A passive target with no account uses this page. The page shows the requesting family name and
the consent scope. The page also shows the disclosure that admins of linked families can edit
shared household data (invariant 6).

The Accept control verifies control of the contact on the server. The server sets
`emailVerifiedAt` or `phoneVerifiedAt`, the same as the W3b "Y" reply. The Accept control then
grants the membership. The page needs no login.

**The public path has an accept endpoint only (Steve, 2026-09-02).** The token page shows an
Accept control. It shows no Decline control. A passive target who does not want to join ignores
the link. The request expires after the time-to-live. A later slice can add a public decline
endpoint and a Decline control. That slice is a small additive change.

The page renders a state for each token condition: valid, expired, already used, accepted,
declined, and invalid. The declined state and the accepted state come from the get response.
The page never shows a roster or an id (invariants 4 and 6).

### 4.4 Unified add-member flow

The family page has no add-member control today. This slice adds a new add-member form to the
family page. The form collects a name and an optional email or phone. The form shows an
adult-attestation checkbox only when the user enters a contact and the age is unknown (parent
spec §11).

The submit logic obeys decision 8. The endpoint names are the live names from §3.

- If the user enters a contact, the form calls `POST /api/v1/link-requests`. The body sets
  `familyGroupId`, `kind: "FAMILY_MEMBERSHIP"`, `direction: "PULL"`, and the contact as
  `targetEmail` or `targetPhone`. The server creates the passive Person from the contact. The
  form then shows "Invitation sent, pending consent".
- If the user enters no contact, the form first calls `POST /api/v1/persons` with the name and
  the `familyGroupId`. The server returns a Person id. The form then calls
  `POST /api/v1/families/:id/members` with that `personId`.
- If `POST /api/v1/families/:id/members` returns `409 CONSENT_REQUIRED`, the form calls
  `POST /api/v1/link-requests` with the `personId` as `targetPersonId`. The form then shows
  "Invitation sent, pending consent" (decision on 2026-09-02: the retry is silent).

The form offers an optional `carryHouseholdId` control when the family has a household. The
control reads "also add to household {name}". The form sends `carryHouseholdId` on the
link-request call only. The direct member-add path does not carry a household in.

### 4.5 Household linked-families and audit

The household card on the family page shows the linked family names from `GET /households/:id`.
An Activity view shows the audit log from `GET /households/:id/audit`. Each audit entry shows
the actor display name, the action, and the timestamp. The view shows an id only for the
viewer's own family (parent spec §3.3, amended 2026-07-15).

The unlink control ships in the core. It calls `POST /households/:id/unlink`. A last-link
response of `409 LAST_LINK` shows a destroy-confirm prompt.

### 4.6 Organizer skip-notices — DEFERRED (Steve, 2026-09-02)

The API returns a `skipped` notice list only for a HOUSEHOLD-scope invitation. The web invite
page has no household-invitee entry kind. Its `InviteeEntry` union supports a person, a
FamLink-user, and a guest only. So the web invite flow can never make the API return a skip
notice. This surface is not reachable in a web-only slice.

This surface waits for the web household-invite UI. That UI is out of the scope of this slice.
When it ships, it adds the household-invitee kind and the skip-notice surface together.

## 5. Client layer

Add `apps/web/lib/api/linkRequests.ts` for the pending list, create, accept, and decline calls.
Add `apps/web/lib/api/consent.ts` for the token get, accept, and decline calls. Add the
household additions (`linkedFamilies`, audit, unlink) to `apps/web/lib/api/family.ts`. Each
client function uses `apiFetch` and the Clerk `getToken`, the same as the current clients. The
pages use React Query hooks, the same as the current pages.

## 6. Isolation invariants (named tests)

The parent spec §7 defines the full set. This PR does a test of the web render of each surface.

- The inbox, the token page, and the audit view show names only. They show no foreign family id
  and no roster.
- The audit view shows an id only for the viewer's own family.
- The token page carries no roster and no id.
- A skip-notice names only a resident of the organizer's own household context.

## 7. Testing

- Component and page tests for each surface, the same as the current web test pattern.
- Client-function tests for each new client function.
- The coverage gate is 80% lines through `npx vitest run --coverage` in `apps/web`. Per-task
  verification runs the coverage gate, not a single targeted file (the PR #6 lesson).

## 8. Out of scope (explicit)

- Household-link create UI — a later slice.
- Onboarding consent routing — its own slice. `InviteStep` keeps its current behavior.
- Mobile consent and household surfaces — PR-4.
- Live SMS or email delivery — the delivery stays mocked or logged until a real domain and a
  verified number exist.

## 9. Locked UI decisions (Steve, 2026-09-02)

Steve locked these decisions at the spec review.

- **Badge refresh — refetch on navigation and on window focus.** The pending-count query uses
  the React Query default. It refetches when the user navigates or gives focus to the tab. It
  does no background poll.
- **Add-member 409 behavior — silent retry.** If `POST /families/:id/members` returns
  `409 CONSENT_REQUIRED`, the form calls the link-request endpoint without a prompt. It then
  shows "Invitation sent, pending consent". The form never tells the requester that the target
  is a reachable or registered party (invariants 1 and 6).
- **The Activity view renders as a section on the household detail, not a separate route.**
- **The Requests navigation item uses a mail glyph.**
- **The inbox groups pending requests by newest first.**
