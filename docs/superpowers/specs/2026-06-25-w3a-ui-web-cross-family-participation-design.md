# W3a-UI (web) — Cross-Family Event Participation UI — Design

| Field | Value |
|---|---|
| Status | **DRAFT — for Steve review → writing-plans. Not authorized to build.** |
| Created | 2026-06-25 |
| Parent | `docs/superpowers/specs/2026-06-24-w3a-cross-family-event-participation-design.md` (W3a) + `docs/superpowers/plans/2026-06-24-w3a-api-cross-family-participation.md` (W3a-API, merged) |
| Cycle split | **W3a-UI-web (this doc) now; W3a-UI-mobile = committed follow-on** |
| Related | `events/[eventId]/invite/page.tsx`, `lib/api/events.ts`, `events/[eventId]/page.tsx`, guest-RSVP flow; W3a-API endpoints (EventParticipant, accept/decline, revoke/role, per-item tasks, ForeignInvitedEventDTO) |

> The web surface that consumes the merged W3a-API. Decisions from the 2026-06-25 brainstorm are recorded inline. Nothing is locked until Steve approves this spec.

---

## 0. Why

W3a-API shipped the backend for cross-family event participation (the `EventParticipant` grant, accept/decline/revoke/role, participant RSVP + task contributions, and the isolation-safe `ForeignInvitedEventDTO`). W3a-UI-web makes it usable: invite cross-family people (with a role), let them accept and participate, and let organizers manage participants — all on the web client. Mobile is a committed follow-on.

## 1. Scope

**In scope (W3a-UI-web):**
- Invite cross-family FamLink users as participants (with a role) via the existing suggestions list **and** via email/phone that resolves to an account.
- An authenticated accept/decline page.
- Event-detail rendering for both a cross-family participant (foreign DTO) and an owning member (full view + participant management).
- Two small supporting read endpoints (§3) and one invite-handler branch (§4).

**Out of scope:**
- **Mobile (→ W3a-UI-mobile, committed follow-on).** Interim: a mobile user taps the email/SMS accept link and accepts in the web browser.
- **Non-user → full participant** (passive onboarding / "reply Y" / contact verification) → **W3b**. Non-users invited by email/phone remain **guests** (existing token-RSVP) this cycle.
- Cross-family **photo/registry** contribution (deferred per W3a spec).

## 2. Decisions (2026-06-25, Steve)

1. **Web-first; mobile is a committed follow-on plan.**
2. **Email/phone invite elevation:** when an invited email/phone resolves to an existing FamLink account **and the inviter is an event-admin**, create a `famlinkUser` `PARTICIPANT` invite (full participant + authenticated accept) instead of a guest invite. A non-match → guest (as today). A **non-admin** inviter → guest even on a match (participant-granting is admin-gated; they cannot confer participant powers).
3. **Suggestions → participants:** people from the `invitee-suggestions` list are sent as `famlinkUser` invites with a role (default `PARTICIPANT`, optional "make event admin"), not as `person` (owning-member) invites.
4. **Accept requires authentication** (identity-bound), reachable from any channel's link.

## 3. Supporting API additions (small, isolation-safe)

- **`GET /api/v1/events/participation/preview?token=`** — the accept page must show what's being accepted, but a pending invitee has no grant yet (`GET /:eventId` would 404). Returns an allowlist preview for a PENDING `famlinkUser` invitation whose `linkedPersonId === requester.id`: `{ eventTitle, startAt, endAt, locationName, role, invitedByName }`. **No family name/roster/other fields.** Reusing the guest endpoint is rejected (it returns `familyGroup.name`, an isolation leak).
- **`GET /api/v1/events/:eventId/participants`** — for management: `{ personId, displayName, role, status }[]`. Gated to **owning members + event-admins** (cross-family participants use the foreign DTO's attendee list and get 403 here). `personId` is included so admins can call the existing revoke/set-role endpoints.

## 4. Invite handler change (`POST /:eventId/invitations`)

Extend the email/phone (`guest`) branch: after `matchPersonByContact`, **if a match is found AND the inviter `canAdmin`** → create a `famlinkUser`-shaped invitation (`linkedPersonId = match.id`, `role` default `PARTICIPANT`, `guestToken`, status PENDING) and send the **authenticated accept-link** notification. Otherwise → existing guest invitation (token RSVP). The `famlinkUser` (suggestions) path from W3a-API is unchanged. All participant-granting invites remain `canAdmin`-gated.

## 5. Web surfaces

**5.1 Invite page** (`events/[eventId]/invite`, extend existing)
- **Family members** list → `person` invites (unchanged).
- **Suggestions** list (cross-family connections) → `famlinkUser` invites; each selectable with a role (default `PARTICIPANT`, a per-invite "event admin" toggle). Surface only when the viewer `canAdmin` (participant-granting is admin-only); otherwise hide the role control and the suggestions act as before.
- **External (email/phone)** → server decides guest vs elevated participant per §4; the form gains a short note ("If they're on FamLink, they'll join as a participant").
- `InviteeEntry` / `sendInvitations` extended with `kind` (`person` | `famlinkUser` | `guest`) + optional `role`.

**5.2 Accept page** (`/events/accept?token=`, new)
- Authenticated route; if signed out → Clerk sign-in, return to this URL.
- Calls `previewParticipation(token)`; renders event summary + "Invited by X as <role>" + **Accept** / **Decline**.
- Accept → `acceptParticipation` → redirect to `/events/:id`. Decline → confirmation. Errors (token not for you / expired) → a clear message.

**5.3 Event detail** (`events/[eventId]`, extend)
- **Cross-family participant viewer:** detect the foreign-DTO shape (no `familyGroupId`); render limited fields + attendee list + tasks (with add/edit-own/delete-own) + RSVP control.
- **Owning member viewer:** existing full view **+** a Participants section from `/participants` (role badges); **event-admins** get **Revoke** and **Change role** controls per participant.

**5.4 Client** (`lib/api/events.ts`) — add `previewParticipation`, `acceptParticipation`, `declineParticipation`, `listParticipants`, `revokeParticipant`, `setParticipantRole`, `addItem`/`patchItem`/`deleteItem`, and `kind`+`role` on invites.

## 6. Isolation (carry the W3a invariants to the client)

- The participant viewer only ever receives the foreign DTO — the client must not assume member-only fields exist.
- `/participants` is admin/member-only; the preview endpoint returns no family identifiers.
- The accept page binds to the authenticated identity (server-enforced); the client never trusts the token alone.

## 7. Testing

- **Web (vitest + testing-library):** invite page sends `famlinkUser`+role for suggestions and hides role control for non-admins; accept page calls accept/decline and handles the not-for-you error; event detail renders foreign DTO (participant) vs full view (member); participant management shows revoke/role only for admins.
- **API (vitest + supertest):** preview returns the allowlist for a matching pending invite and 403/empty for a non-matching token; `/participants` returns grants for members/admins and 403 for cross-family participants; the invite-handler elevation branch creates a `famlinkUser` invite for a matched contact + admin inviter, and a guest invite otherwise.

## 8. Open questions for review

1. **Invite-page role UI:** a simple per-suggestion "event admin" toggle (default off) — acceptable, or a single event-wide "invite as admin" choice?
2. **Elevation notice copy:** the external-invite note ("if they're on FamLink, they join as a participant") — wording/placement OK, or omit to keep the form clean?
3. **Decline UX:** after decline, redirect home vs a standalone "you declined" page. (Default: simple confirmation, link home.)
