# W3a-UI-mobile — Cross-Family Event Participation on Mobile — Design

| Field | Value |
|---|---|
| Status | **DRAFT — brainstormed with Steve 2026-07-06, all decisions below Steve-approved in session. For Steve spec review → writing-plans. Not authorized to build.** |
| Created | 2026-07-06 |
| Parent | `docs/superpowers/specs/2026-06-25-w3a-ui-web-cross-family-participation-design.md` (W3a-UI-web, shipped PR #6) |
| Cycle split | **PR 1 = participant slice; PR 2 = organizer slice** (see §8) |
| Related code | `apps/mobile/app/(tabs)/events/index.tsx`, `apps/mobile/app/(tabs)/events/[eventId].tsx`, `apps/mobile/hooks/useEvents.ts`, `apps/mobile/lib/api.ts`, `apps/api/src/routes/events.ts`, `apps/api/src/lib/eventAccess.ts`, `apps/api/src/routes/calendar.ts`, `apps/web/lib/api/events.ts` (reference), `apps/web/components/events/ForeignEventDetail.tsx` (reference) |

---

## 0. Why

W3a-UI-web shipped cross-family participation on the web. Mobile is the committed follow-on. Exploration
found the mobile client is not merely missing the feature — it is **broken and blind** with respect to it:

1. **The foreign DTO crashes mobile.** `[eventId].tsx` destructures `{ event, rsvps, eventItems }`;
   a cross-family participant receives the flat `ForeignInvitedEventDTO` (no `event` wrapper), so
   `event.title` throws.
2. **Foreign events are unreachable on mobile.** `calendar/upcoming` is family-scoped and **no endpoint
   lists cross-family participations**. Web sidesteps this via the accept-redirect URL; mobile has no URL
   bar. Without a discovery endpoint a mobile user can never navigate to a foreign event.
3. **Universal links are domain-blocked.** Invite links are `https://WEB_APP_URL/...`; iOS/Android
   app-link verification requires the real domain (same parked blocker as Clerk-prod/Resend). The
   `famlink://` scheme exists but nothing delivers scheme links.
4. **Pre-existing bug:** mobile `useClaimItem` sends `PUT /events/:id/potluck`; the API route is
   POST-only — mobile item-claiming is broken today.
5. **Mobile is not in CI** — the jest suite runs locally only.

## 1. Decisions (Steve, 2026-07-06 brainstorm)

1. **Accept flow = browser-accept + in-app viewing (Q1-A).** Invitee taps the SMS/email link, accepts on
   the shipped web accept page; the event then appears in the mobile app. **No deep-link / in-app accept
   this cycle**; that is a fast-follow once the real domain lands. No invite token ever enters mobile.
2. **Scope = full web parity (Q2-C).** Participant side (viewer, RSVP, tasks, discovery) **and** organizer
   side (invite screen incl. cross-family suggestions with roles + external guests, participant
   management).
3. **Discovery presentation = merged list with badge (Q3-A).** One chronological events list; foreign
   events carry a "Guest" badge.
4. **Items migration = full (Q4-A).** Mobile moves to the `POST/PATCH/DELETE /items` model; claim becomes
   a PATCH assign; the dead `/potluck` PUT client path is deleted.
5. **CI = add a mobile job (Q5-A).** lint + typecheck + jest; **no coverage threshold** (no existing
   mobile coverage baseline).
6. **Architecture = mobile-local port, two sequential PRs (approach decision).** Follow existing mobile
   patterns (domain hooks + expo-router screens + jest-expo); DTO types defined locally as today. A shared
   web/mobile client package was considered and rejected (YAGNI; refactor tax on an unrelated app).

## 2. Scope

**In scope:**
- Two additive API changes (§3).
- Mobile participant experience: discovery in the events list, foreign-event viewer, RSVP with own-status
  display, task add/delete-own (§4).
- Mobile own-event items migration to the `/items` model, fixing the broken claim (§4.2).
- Mobile organizer experience: invite screen (members + suggestions/roles + external guests), participant
  management (§5).
- Mobile CI job (§7).

**Out of scope:**
- In-app accept / deep links / universal links (domain-blocked; fast-follow).
- Task **edit-own** in the foreign viewer (web parity — web deferred it too).
- Cross-family photo contribution (deferred per W3a parent spec; foreign DTO carries no photos).
- Inbound SMS responses (W3b), bulk import (web spec §6), shared client package extraction.
- Web adoption of `myRsvp` / `/participating` (endpoints are built for both, web UI adoption is a later
  slice).

## 3. API changes (2, additive, no migrations)

GitNexus impact (2026-07-06): `toForeignInvitedEventDTO` and `resolveEventAccess` upstream = **LOW**
(consumed only by `routes/events.ts`). Web clients tolerate additive JSON fields.

### 3.1 `GET /api/v1/events/participating` (new — discovery)

Returns upcoming events where the requester holds an **ACTIVE `EventParticipant` grant** on an event
**outside the requester's own families**. Defensive dedupe: exclude any event whose `familyGroupId` is in
the requester's family memberships (those come from `calendar/upcoming`; never return an event twice).

- Query: `days` (default 30, clamped 1–90) — same window semantics as `calendar/upcoming`
  (`startAt >= now && startAt <= now + days`), so the client merge is coherent.
- Response: `{ events: [{ id, title, startAt, endAt, locationName, eventType }], generatedAt }` —
  **allowlist only. No `familyGroupId`, no family name, no roster, no inviter.** Sorted `startAt` asc.
- Auth: standard `requireAuth` + `requirePerson`. REVOKED grants never match.

### 3.2 `myRsvp` on `ForeignInvitedEventDTO`

Add the requester's own RSVP status — `myRsvp: "YES" | "NO" | "MAYBE" | null` — to the foreign DTO
(`toForeignInvitedEventDTO` gains the requester's RSVP row as input). Strictly the viewer's own data;
isolation-safe. This also fixes web deferred-item #2 (foreign RSVP button can't reflect current status);
web UI adoption is a later slice.

## 4. Mobile participant slice (PR 1)

### 4.1 Client layer (`hooks/`)

- **Types:** add `ForeignInvitedEventDTO` (flat: `id, title, description, startAt, endAt, locationName,
  locationAddress, locationMapUrl, eventType, participants[], tasks[], myRsvp`). `useEvent(eventId)`
  returns `EventDetail | ForeignInvitedEventDTO`; discriminator `isForeignEvent(data)` = response lacks
  the `event` wrapper (`"event" in data`), matching web detection.
- **`useParticipatingEvents(days)`** → §3.1. The events list merges this with `useEvents` client-side.
- **Items mutations:** `useAddItem` (POST `/items`), `usePatchItem` (PATCH `/items/:itemId`),
  `useDeleteItem` (DELETE `/items/:itemId`). **Claim = `usePatchItem` with
  `{ assignedToPersonId: me }`.** `useClaimItem` and the `/potluck` PUT are **deleted**.
- Existing react-query invalidation pattern throughout (mutations invalidate `["event", eventId]` /
  `["events", ...]`).

### 4.2 Screens

- **Events list (`events/index.tsx`, extend):** merge own + participating into one chronological list.
  Foreign cards get a **"Guest" badge** (styled like the existing 🎂 Birthday tag) and navigate to the
  same `/events/[eventId]` route. **Partial-failure isolation:** if either query errors, render the other
  list anyway (one failing query must not blank the screen).
- **Event detail (`events/[eventId].tsx`, rework):** becomes a thin route that branches on
  `isForeignEvent` into two new components under `apps/mobile/components/events/`:
  - **`ForeignEventDetail` (new):** renders only DTO fields — title, time, location (+ map link),
    description, event type; attendee display names; tasks with **add + delete-own** (delete-own =
    `createdByPersonId === myPersonId`; server `authorizeItemMutation` enforces); RSVP row highlighting
    `myRsvp`, writing via existing `PUT /rsvp`. **No photos, no invite/manage affordances.** Typed
    against the DTO so owner-only fields are compile errors.
  - **`OwnEventDetail` (extracted from today's screen):** existing layout; items migrated to the
    `/items` model — claim via PATCH (bug fix), **add item** and **delete-own** added for web parity.
    RSVP + photos unchanged.
  - **Failure state:** 403/404 on a previously-visible foreign event → generic **"This event is no
    longer available"** (no family detail), replacing the bare "Event not found" for that path.

## 5. Mobile organizer slice (PR 2)

### 5.1 Invite screen (`app/(tabs)/events/[eventId]/invite.tsx`, net-new)

Reached via an **Invite** button on `OwnEventDetail` (any member sees it; the API enforces role rules).
Three sections, porting the web invite page:

1. **Family members** — roster checkboxes → `{ kind: "person", personId }`.
2. **Suggestions** (`GET /:eventId/invitee-suggestions`) → `{ kind: "famlinkUser", personId, role }`,
   each with a **"Make event admin" toggle rendered only when the viewer `canAdmin`** (non-admins send
   plain participants; the API 403s non-admin `famlinkUser` invites, so the control is hidden not
   disabled — same rule as web).
3. **External guest** — name + email/phone → `{ kind: "guest", guestName, guestEmail | guestPhone }`.
   Delivery is server-side (web spec §3.4, live). UI reports **"invitation sent"** on creation; never
   asserts delivery success.

One **Send** builds the tagged `invitees[]`; per-row results (e.g. "already invited" skips) surface in a
summary line. Client fns mirror `apps/web/lib/api/events.ts` signatures (`useSendInvitations`,
`useInviteeSuggestions`).

### 5.2 Participant management (`OwnEventDetail`, extend)

**Participants section** fed by `GET /:eventId/participants` (owning members + event-admins only; 403 for
foreign participants): display name + role badge, REVOKED muted (history). **Event-admins only** get
per-row **Revoke** (confirm via `Alert.alert`, matching the photo-delete pattern) and **role toggle**
(participant ⇄ event-admin) via existing endpoints. Non-admin members see the list read-only. `canAdmin`
is derived client-side **exactly the way the web invite page derives it** (family-admin membership role /
event creator, from data the client already has) — the plan must copy web's derivation, not invent one;
no new endpoint.

## 6. Isolation invariants (mobile obligations)

1. `ForeignEventDetail` is typed against the DTO — owner-only fields are compile errors, not runtime
   absences.
2. Discovery summaries are allowlist-only; the badge is "Guest", never a family name.
3. Organizer surfaces (Invite button, Participants section) exist only in `OwnEventDetail`; the server
   403s back them up.
4. Failure states are generic ("no longer available") and reveal nothing about the event or family.
5. No invite token is handled, logged, or stored on mobile this cycle (accept is browser-only).

## 7. Testing & CI

- **API (vitest + supertest, PR 1):** `/participating` returns only ACTIVE cross-family grants (never
  own-family events, never REVOKED, respects `days` clamp); response body is allowlist-only; `myRsvp`
  reflects the requester's RSVP and leaks nothing else.
- **Mobile hooks (jest):** `useParticipatingEvents` merge + error isolation; items mutations hit correct
  endpoints/methods (regression-locks the PUT→PATCH claim fix); invitation payload building (tagged
  kinds + role).
- **Mobile screens (jest + @testing-library/react-native):** list badges foreign rows and survives one
  query failing; detail branches on shape; foreign viewer shows no owner affordances and highlights
  `myRsvp`; invite screen hides the role toggle for non-admins; participants section shows actions only
  for admins; generic failure state renders on 403/404.
- **CI:** new `mobile` job — `lint` + `tsc --noEmit` + `jest` — added in **PR 1** (no coverage
  threshold). Existing API/web jobs unchanged.
- Per-task and final verification per agent rules: full API + web + mobile suites, repo-root
  `type-check`, repo-root `lint` (the eslint-only-error lesson).

## 8. Delivery

- **PR 1 — participant slice:** §3 API additions → §4.1 hooks → §4.2 events list + detail rework →
  §7 CI job.
- **PR 2 — organizer slice:** §5.1 invite screen → §5.2 participant management. Depends only on merged
  PR 1 (`main`).
- Each PR: subagent-driven TDD execution, council-reviewed plan, whole-branch review before merge —
  the W3a-UI-web workflow.

## 9. Forward-compat notes (not built)

- **Deep links / in-app accept:** the `famlink://` scheme is configured; once the real domain exists,
  universal links (`WEB_APP_URL/events/accept?token=` → app) plus an in-app accept screen can reuse the
  shipped `participation/preview` endpoint unchanged. Nothing this cycle forecloses it.
- **Web discovery adoption:** web can consume `/participating` and `myRsvp` in a later slice to fix its
  own foreign-event re-findability gap and RSVP display (web deferred item #2).

## 10. Open items for Steve

None — all brainstorm questions were resolved in session (§1). Pre-existing environment note: guest
*email* delivery remains sandbox-blocked (`resend.dev`) until the domain decision; SMS delivery is live.
This affects the invite screen's external-guest email path in production identically to web today.
