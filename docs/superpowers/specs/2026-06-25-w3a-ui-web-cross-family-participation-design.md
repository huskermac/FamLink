# W3a-UI (web) — Cross-Family Event Participation UI — Design

| Field | Value |
|---|---|
| Status | **DRAFT — refreshed 2026-06-30 after re-grounding against merged W3a-API + CIF, and a Codex council round (no BLOCKERs). For Steve review → writing-plans. Not authorized to build.** |
| Created | 2026-06-25 (refreshed 2026-06-30) |
| Parent | `docs/superpowers/specs/2026-06-24-w3a-cross-family-event-participation-design.md` (W3a) + `docs/superpowers/plans/2026-06-24-w3a-api-cross-family-participation.md` (W3a-API, merged) |
| Cycle split | **W3a-UI-web (this doc) now; W3a-UI-mobile = committed follow-on** |
| Related code | `apps/web/.../events/[eventId]/invite/page.tsx`, `apps/web/lib/api/events.ts`, `apps/web/.../events/[eventId]/page.tsx`, `apps/web/app/rsvp/[token]/`, `apps/api/src/routes/events.ts`, `apps/api/src/routes/guest.ts`, `apps/api/src/lib/eventAccess.ts`, `apps/api/src/lib/notificationService.ts`, `apps/api/src/lib/personIdentity.ts` |

> Refreshed because much of the original spec's "to build" already shipped with W3a-API. This version
> records what already exists, the four remaining API changes, the web surfaces, and the decisions made
> in the 2026-06-30 brainstorm + council round. Nothing is locked until Steve approves this spec.

---

## 0. Why

W3a-API shipped the backend for cross-family event participation. W3a-UI-web makes it usable on the web
client: invite cross-family people (with a role), let them accept / decline / **revive** a participation,
let organizers manage participants, and — newly in scope — **close the guest-delivery gap** so external
guests actually receive their RSVP link. Mobile is a committed follow-on.

## 1. What already exists (do NOT rebuild)

Shipped in W3a-API / CIF and verified against `apps/api/src/routes/events.ts` on 2026-06-30:

- `POST /:eventId/invitations` accepts a discriminated `invitees[]` of kind `person` | `guest` |
  `famlinkUser`(+`role`). `famlinkUser` invites are `canAdmin`-gated and send an authenticated
  accept-link notification via `NotificationService`. **Guest invites are created but dispatch nothing
  (the gap closed in §3.4).**
- `POST /:eventId/participation/accept` and `/decline` — token-bound, identity-checked
  (`inv.linkedPersonId === requester.id`). **Today both filter invitation `status: "PENDING"` only**
  (widened in §3.3).
- `POST /:eventId/participants/:personId/revoke`, `PUT /:eventId/participants/:personId/role` —
  `canAdmin`-gated; revoke sets `EventParticipant.status = REVOKED`.
- `POST/PATCH/DELETE /:eventId/items` — per-item tasks. Mutation is ownership-scoped by
  `authorizeItemMutation`: a non-admin may patch/delete only items where `createdByPersonId === self`;
  `canAdmin` may edit any. `canContribute` (owning member OR active participant) may create.
- `GET /:eventId` returns the isolation-safe `ForeignInvitedEventDTO` for an active cross-family
  participant — a flat object `{ id, title, description, startAt, endAt, locationName, locationAddress,
  locationMapUrl, eventType, participants[], tasks[] }`, with **no `familyGroupId` and no roster beyond
  attendees** (attendees = people with an RSVP or active grant on this event). Owning members get the
  full `{ event, invitations, rsvps, eventItems }` shape.

Data facts that constrain the design:

- `EventInvitation.status` is a free String: `PENDING` / `ACCEPTED` / `DECLINED`. `guestToken` is unique;
  `linkedPersonId` ties a participant invite to a Person; `role` optional.
- `ParticipantStatus` enum = `ACTIVE` | `REVOKED` only (no self-decline status).
- `NotificationService.send(recipientPersonId, …)` reads `person.email` / `person.phone` and honors
  `NotificationPreference` rows. **Guests created by `findOrCreatePersonByContact` only get
  `emailNormalized` / `phoneNormalized` (NOT raw `email`/`phone`) and have no preference rows**, so
  `send()` cannot deliver to them. The deliverable contact lives on the invitation (`guestEmail`/
  `guestPhone`). → guest delivery uses a direct send (§3.4), not `send()`.
- Guest RSVP page is `WEB_APP_URL/rsvp/{guestToken}` → `POST /api/v1/guest/invitation/:token/rsvp`,
  which updates `invitation.status` with no PENDING gate (only blocks after the event ends). Owning
  members RSVP via `PUT /:eventId/rsvp` (upsert). Both therefore already support reviving a declined
  response; participants do not (fixed in §3.3).

## 2. Scope

**In scope:**
- Invite cross-family FamLink users as participants (with a role) via the suggestions list.
- An authenticated accept / decline / **revive** page reachable from any channel's link.
- Event-detail rendering for both a cross-family participant (foreign DTO) and an owning member
  (full view + participant management).
- Two small read endpoints + one accept-widening + guest delivery (§3).

**Out of scope:**
- **§4 elevation** (auto-promoting a typed external email/phone that matches an account into a
  participant invite) — **dropped**. External email/phone stays guest-only; cross-family participant
  invites go only through the explicit suggestions list.
- **Mobile** (→ W3a-UI-mobile). Interim: a mobile user taps the link and accepts in the browser.
- **Inbound channel response** ("reply Y", STOP/opt-out, phone verification) → **W3b**. This phase
  delivers invites by text/email/push but responses come back via a tapped web link.
- **Bulk import** — deferred but kept supportable (§6).
- Cross-family photo/registry contribution (deferred per W3a spec).

## 3. API changes (4; small, isolation-safe)

### 3.1 `GET /api/v1/events/participation/preview?token=`
The accept page is reached with a token only (`/events/accept?token=`), but accept/decline are keyed by
`eventId` in the path — so preview resolves the token to the event and tells the page what to render.

- **Lookup, then identity-check, then branch on status — do NOT pre-filter by status** (council MAJOR-1).
  Resolve the invitation by `guestToken`; require `inv.linkedPersonId === requester.id` (else a generic
  "not for your account" / not-found, revealing nothing). Then branch:
  - `PENDING` or `DECLINED` → return the preview body (below) + `currentStatus`. The page shows
    Accept/Decline (PENDING) or a re-accept nudge (DECLINED).
  - `ACCEPTED` **and** the requester has an **ACTIVE** `EventParticipant` grant → return
    `currentStatus: "ACCEPTED"` + an "active" flag so the client redirects to `/events/:eventId`.
  - `ACCEPTED` **and** grant **REVOKED / absent** → return an "unavailable" signal so the client renders
    a generic "this invitation is no longer available" message (NOT a redirect into a 403 dead-end)
    (council MAJOR-2).
- **Preview body (allowlist only):** `{ eventId, eventTitle, startAt, endAt, locationName, role,
  invitedByName, currentStatus }`. `invitedByName` = the **inviter's display name** (preferred/first
  name) only — never a family name or roster-derived label (council MINOR). **No family name, no roster,
  no other fields.** Reusing the guest endpoint is rejected (it returns `familyGroup.name`).

### 3.2 `GET /api/v1/events/:eventId/participants`
For management. Returns `{ personId, displayName, role, status }[]` (includes REVOKED so admins can see
history). Gated to **owning members + event-admins** via `resolveEventAccess` `canAdmin`/`isOwningMember`;
cross-family participants get **403** (they use the foreign DTO's attendee list). `personId` is included
so admins can call the existing revoke/role endpoints.

### 3.3 Widen `participation/accept` (+ preview) to revive a declined invite
Change the accept handler's invitation filter from `status: "PENDING"` to **status ∈ {PENDING,
DECLINED}**, after the identity check, then idempotently upsert the grant to `ACTIVE` and set the
invitation `ACCEPTED`. **Never match `ACCEPTED`** — so an admin-revoked participant (invitation stays
`ACCEPTED`, grant `REVOKED`) cannot self-rejoin via the link; they need a fresh invite. Members and
guests already support revival, so no change there. (Phrasing per council NIT: the accept *mutation*
accepts only PENDING/DECLINED after identity check; preview *may inspect* ACCEPTED for UX.)

Decline stays as-is (PENDING → DECLINED; idempotent if already DECLINED). Reversing an already-ACCEPTED
active participation ("leave event") is **not** in scope this cycle.

### 3.4 Guest delivery (day-1, non-negotiable) — direct guest send
In the **guest branch** of `POST /:eventId/invitations`, after creating the invitation, directly send
the link `WEB_APP_URL/rsvp/{guestToken}` to the invitation's `guestEmail` / `guestPhone` using the
existing Resend / Twilio primitives — **bypassing** `NotificationService.send` (guests have no
deliverable Person contact / prefs). Email when `guestEmail` present, SMS when `guestPhone` present.

- **Copy/isolation constraint (council MAJOR-3):** the message body and URL contain **only** the event
  title, start time, and the RSVP link. **No** family name, roster, inviter family, participant list, or
  internal IDs.
- **Delivery semantics (council MAJOR-4):** fire-and-forget / non-fatal (a send failure must not fail
  the invite transaction), but **log** `{ invitationId, channel, success, error? }` for each attempt so
  failed sends are diagnosable. The UI reports "invitation sent" based on invitation **creation**, and
  must not falsely assert delivery success.

### 3.5 Invitees array cap (cheap hardening, council MINOR)
Since this cycle already edits the invite handler, add `.max(N)` (e.g. `N = 200`) to the
`SendInvitationsV2Schema.invitees` array (currently unbounded). Protects the transaction and pre-empts
the future bulk-import abuse/perf risk.

## 4. Web surfaces

### 4.1 Invite page (`events/[eventId]/invite/page.tsx`, extend)
- **Family members** → `person` invites (unchanged).
- **Suggestions** (cross-family connections) → `kind: "famlinkUser"` invites, each with a
  **per-suggestion "Make event admin" toggle** (default off = `PARTICIPANT`). The role control is shown
  **only when the viewer `canAdmin`**; non-admins still see suggestions but they send as plain
  participants (the API 403s a non-admin `famlinkUser` invite, so the UI just hides the control).
- **External (email/phone)** → `guest` invites, **unchanged** (no elevation, no "if they're on
  FamLink…" note). These now actually get delivered (§3.4).
- The current `handleSend` builds bare `{ personId }` / `{ guestEmail }` objects — update to the tagged
  `kind` shape the API expects.

### 4.2 Accept page (`/events/accept?token=`, new)
- Authenticated route; signed-out → Clerk sign-in returning to this URL.
- Calls `previewParticipation(token)` and renders per the §3.1 branch. **State matrix** (council MINOR):
  - **PENDING** → event summary + "Invited by X as <role>" + **Accept** / **Decline**.
  - **DECLINED** → same summary + a re-accept nudge ("You declined this earlier — re-accept?") + **Accept**.
  - **ACCEPTED + active grant** → redirect to `/events/:eventId`.
  - **ACCEPTED + revoked/absent grant**, **token not yours**, **different Clerk user**, **expired /
    canceled / deleted event**, **invalid token** → a **generic "this invitation is no longer
    available / not authorized"** state that reveals **no** event or family detail.
- Accept → `acceptParticipation(eventId, token)` → redirect to `/events/:eventId`. Decline → inline
  "You declined this invitation" confirmation + a link home.
- **Page hardening (council MINOR):** no third-party analytics/pixels on this route; do not log the full
  query string (the token); set a conservative `Referrer-Policy`.

### 4.3 Event detail (`events/[eventId]/page.tsx`, extend)
- **Cross-family participant viewer:** detect the foreign-DTO shape (flat object with `participants` +
  `tasks`, no `event` wrapper / no `familyGroupId`). Render the limited fields + attendee list + tasks
  (add / edit-own / delete-own, matching the API's ownership scoping) + an RSVP control. The client must
  **not** assume any owning-member-only field exists.
- **Owning-member viewer:** existing full view **+** a Participants section from
  `GET /:eventId/participants` (role badges; REVOKED shown muted). **Event-admins** get **Revoke** and
  **Change role** per participant. This section is never rendered for a cross-family participant (they
  never receive that endpoint — 403).

### 4.4 Client (`apps/web/lib/api/events.ts`, extend)
Add `previewParticipation`, `acceptParticipation`, `declineParticipation`, `listParticipants`,
`revokeParticipant`, `setParticipantRole`, `addItem` / `patchItem` / `deleteItem`, and the tagged
`kind` (`person` | `famlinkUser` | `guest`) + optional `role` on invite entries.

## 5. Isolation invariants (carried to the client)

- The participant viewer only ever receives the foreign DTO — no member-only fields assumed.
- `/participants` is admin/member-only; the preview endpoint returns no family identifiers and
  `invitedByName` is an inviter display name only.
- Preview and accept are identity-bound server-side (`linkedPersonId === requester.id`); the client
  never trusts the token alone.
- Revival can never override admin revocation (accept ignores `ACCEPTED` invitations / `REVOKED` grants).
- Guest delivery copy carries no family/tenant context.

## 6. Forward-compat: bulk import (deferred, NOT built this cycle)

A future slice lets a user paste a CSV/TSV blob or upload a file of name + email/phone pairs to invite
many guests at once. It is **already supported by the architecture**: each row maps to a
`{ kind: "guest", guestName, guestEmail | guestPhone }` entry in the existing array invite endpoint —
**no schema, endpoint, or model change**. Imported rows inherit CIF normalization/dedup
(`findOrCreatePersonByContact`), existing-invitation skip, guest delivery (§3.4), and the §3.5 cap.

A future import slice adds, client-side: a parser that classifies each value as email vs phone, per-row
validation surfaced before send, and a result summary ("18 invited, 2 duplicates skipped, 1 invalid")
diffed against the endpoint's returned created list. This cycle's tagged `InviteeEntry` refactor (§4.1)
is exactly the shape import reuses, so nothing here forecloses it.

## 7. Testing

- **API (vitest + supertest):**
  - preview: returns the allowlist for a matching PENDING and DECLINED invite; "active" signal for
    ACCEPTED+active grant; "unavailable" for ACCEPTED+revoked; 403/generic for a non-matching token;
    body contains no family name/roster.
  - `/participants`: returns grants (incl. REVOKED) for members/admins; 403 for a cross-family participant.
  - accept widening: a DECLINED invite re-accepts to an ACTIVE grant; an ACCEPTED+revoked invite does
    **not** re-activate via the link.
  - guest delivery: creating a guest invite triggers a direct email/SMS to the invitation contact with
    a body containing the RSVP link and **no** family name; a send failure does not fail the invite;
    the attempt is logged.
  - invitees `.max(N)` cap rejects an over-cap batch.
- **Web (vitest + testing-library):** invite page sends `famlinkUser`+role for suggestions and hides the
  role control for non-admins; accept page renders each state-matrix branch and calls accept/decline;
  event detail renders foreign DTO (participant) vs full view (member); participant management shows
  revoke/role only for admins.

## 8. Resolved decisions (2026-06-30 brainstorm + council)

1. §4 elevation — **dropped**.
2. Invite-page role UI — **per-suggestion "Make event admin" toggle, admin-gated**.
3. Decline UX — **inline confirmation + home link**.
4. Revival — **supported**; widen accept (+preview) to {PENDING, DECLINED}, never ACCEPTED, so admin
   revoke stays authoritative. Members + guests already revive via existing RSVP paths.
5. Bulk import — **deferred**, forward-compat documented (§6).
6. Responses via text/email — **delivery yes; inbound channel reply is W3b**.
7. Guest delivery gap — **closed this cycle** via direct guest send (§3.4).

Council (Codex, 2026-06-30): **no BLOCKERs**; four MAJORs + several MINORs folded in (preview
status-branching, ACCEPTED+revoked handling, guest copy isolation, guest delivery observability, accept
state matrix, page hardening, `invitedByName` scope, invitees cap).

## 9. Open items for Steve

1. Confirm the §3.5 invitees cap value (default proposed: 200).
2. Confirm `invitedByName` = inviter preferred/first name is acceptable to expose on the accept page.
3. Pre-existing note: the guest RSVP page (`/rsvp/{token}` → `getGuestInvitation`) currently returns
   `familyGroup.name` to the guest. That is a deliberate guest-facing host-name display (an invited
   guest seeing "hosted by the Smith family" is normal evite behavior), distinct from the cross-family
   *participant* isolation invariant. Flagged for awareness; no change proposed this cycle.
