# P2-12: Event Invitations — Design Spec

**Date:** 2026-05-28  
**Depends on:** P2-13 (relationship graph + invitee suggestion query)

---

## Goal

Replace the current broadcast-only event model with a full invitation system: three visibility modes, graph-aware deterministic suggestions, external-guest support with anonymous RSVP tokens, and cross-family identity matching.

---

## Architecture

Event visibility mode controls who can see and be invited to an event. Invitations are stored as `EventInvitation` records (model already exists in schema). RSVP records track attendance intent. External guests get a unique token URL for RSVP — if their email/phone matches an existing FamLink user, the invitation is linked to their Person record.

Invitee suggestions are deterministic: the API traverses the relationship graph one hop via PARTNER and FRIEND edges for every person already on the invite list.

---

## Event Visibility Modes

| Mode | Who sees the event | Who can be invited | Forwarding |
|------|-------------------|-------------------|-----------|
| `BROADCAST` | All family group members | n/a — everyone is auto-included | n/a |
| `OPEN` | Invitees only | Organizer + any invitee can add others | Invitees can forward to their connections |
| `PRIVATE` | Invitees only | Organizer only | No forwarding |

The `eventVisibility` field on `Event` already exists (`BROADCAST | OPEN | PRIVATE`). No schema change needed here.

---

## Schema Changes

### `EventInvitation` model

Extend existing model:

```prisma
model EventInvitation {
  id           String    @id @default(cuid())
  eventId      String
  event        Event     @relation(...)
  personId     String?   // null for external guests
  person       Person?   @relation(...)
  invitedById  String?   // Person who sent this invitation (null = organizer)
  guestEmail   String?   // for external guests
  guestPhone   String?   // for external guests
  guestName    String?   // for external guests
  guestToken   String?   @unique  // random token for anonymous RSVP URL
  linkedPersonId String? // set if guestEmail/phone matched an existing FamLink user
  status       String    @default("PENDING") // PENDING | ACCEPTED | DECLINED
  sentAt       DateTime?
  createdAt    DateTime  @default(now())
}
```

> `personId` = known FamLink member in any family group. `guestToken` = external guest RSVP link. `linkedPersonId` = cross-family match resolved at invite time.

### `RSVP` model

No changes — RSVP remains the attendance record. For external guests, RSVP is created when they click their token URL and respond.

---

## API Changes

### `POST /events/:id/invitations`

Creates one or more invitations. Request body:

```json
{
  "invitees": [
    { "personId": "person_abc" },
    { "personId": "person_def" },
    { "guestEmail": "mia@example.com", "guestName": "Mia Torres" },
    { "guestPhone": "+15551234567", "guestName": "Brad K." }
  ]
}
```

For each entry:
1. If `personId`: create EventInvitation linking to Person.
2. If `guestEmail` or `guestPhone`: check if it matches any existing Person's email or phone across all family groups.
   - Match found → set `personId` to matched person + set `linkedPersonId`
   - No match → create invitation with `guestEmail`/`guestPhone`, generate `guestToken`, store `guestName`
3. Send notification (email/push) to each invitee if contact info available.

Authorization:
- `BROADCAST` events: invitation creation is blocked (everyone already included)
- `OPEN` events: any current invitee or the organizer can create invitations
- `PRIVATE` events: organizer only

### `GET /events/:id/invitations`

Returns current invite list with status. Includes `via` field for graph-suggested invitees (for display: "Suggested because Jake is invited").

### `GET /events/:id/invitee-suggestions`

Proxies to `GET /persons/invitee-suggestions` from P2-13, scoped to this event's existing invite list + family group members.

Returns suggestions sorted by relationship type (PARTNER first, then FRIEND).

### `GET /rsvp/:token`

Public endpoint (no auth — must be excluded from Clerk middleware in `apps/web/middleware.ts`). Returns event summary + guest name for the token holder. Used to render the external RSVP page.

### `POST /rsvp/:token`

Public endpoint. Request body: `{ "status": "ACCEPTED" | "DECLINED" }`. Creates or updates RSVP record for this guest.

---

## Invitation Flow (UI)

### Creating an event

1. Event form already captures `eventVisibility`.
2. If `BROADCAST`: no invite step — all family members are auto-included on save.
3. If `OPEN` or `PRIVATE`: after saving the event, user lands on an "Invite people" step.

### Invite people step

1. **Family group members** — shown as a checklist (all active, non-deceased members).
2. **Graph suggestions** — below the family list, a "Suggested guests" section shows PARTNER/FRIEND connections of already-selected invitees. Each suggestion shows "Via Jake (partner)" label.
3. **External guests** — a free-entry field: type a name + email or phone → creates an external invitation on submit.
4. A "Skip" option is available to save the event without invitations and invite later.

### Invitation badge on event card / event detail

- For `BROADCAST`: no badge needed.
- For `OPEN` / `PRIVATE`: show attendee count + RSVP summary (X accepted, Y pending).

### External RSVP page (`/rsvp/[token]`)

- Public page, no login required.
- Shows: event title, date, location, organizer name.
- Two buttons: Accept / Decline.
- On submit: creates RSVP record, shows confirmation.
- If the guest token belongs to a user who is now a FamLink member (linked), redirect to the in-app event page instead.

---

## Forwarding (OPEN events)

An invitee on an OPEN event sees a "Forward invitation" button on the event detail page. Clicking it opens the same invite UI (family members + graph suggestions + external entry), but scoped to their own connections. `invitedById` on the created `EventInvitation` records is set to the forwarding person's ID.

---

## Cross-Family Identity Matching

When an external guest is invited by email or phone, the API checks `Person.email` and `Person.phone` across all family groups (not just the event's group). If a match is found:
- The invitation is created with `personId` + `linkedPersonId` set
- The matched user receives an in-app notification instead of an email/SMS
- Their RSVP is tracked against their Person record (not the anonymous token)

The match check happens at invitation creation time and is not re-run retroactively.

---

## Notifications

| Trigger | Recipient | Channel |
|---------|----------|---------|
| Invitation created (known member) | Invitee | push + in-app |
| Invitation created (external) | Invitee | email or SMS (via token URL) |
| RSVP submitted | Event organizer | push + in-app |
| Invitation forwarded | Organizer | in-app only |

Notification infrastructure (Socket.io + push tokens) already exists from P2-02/P2-05.

---

## Testing

- Unit: `createInvitation` — external guest email matches existing user → `linkedPersonId` set, notification routed in-app
- Unit: forwarding blocked on PRIVATE events
- Unit: `BROADCAST` event — invitation creation returns 400
- Integration: full OPEN event flow — create event, invite member + external guest, guest RSVPs via token URL, RSVP appears on organizer's event detail
- Integration: graph suggestions — Jake invited, Mia (Jake's PARTNER) appears in suggestions; deceased persons excluded
- Unit: `GET /rsvp/:token` returns 404 for unknown tokens

---

## Out of Scope

- RSVP reminders / follow-up nudges (Phase 3)
- AI-learned invitation suggestions (Phase 3 — P3-13)
- Waitlists or capacity limits
- Calendar export (iCal) for external guests
- SMS gateway integration (email only for MVP external invites; phone stored for matching but SMS not sent)
