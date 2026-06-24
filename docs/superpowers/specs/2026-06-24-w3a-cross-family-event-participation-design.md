# W3a — Cross-Family Event Participation (existing FamLink users) — Design

| Field | Value |
|---|---|
| Status | **APPROVED (Steve, 2026-06-24; §11 decisions resolved) → writing-plans next. Not authorized to build until the plan is reviewed.** |
| Created | 2026-06-24 |
| Parent design | `docs/FamLink_Design_Family_Model_Reframe.md` §5 (W3), §8 (isolation), §9 (open questions) |
| Workstream | W3 split into **W3a (this doc)** + **W3b (committed next phase, see §10)** |
| Related | `Event` / `EventInvitation` / `RSVP` / `EventItem` / `EventPhoto` (schema.prisma); P2-12 token-guest invites; `NotificationService` (Twilio/Resend/FCM) |

> Captures the design converged in the 2026-06-24 brainstorming session. Decisions are recorded inline; nothing is locked until Steve approves this spec.

---

## 0. Why

The reframe established that **the event is FamLink's cross-tenant collaboration boundary** — the one place data is shared across the `FamilyGroup` tenant line without merging tenants (Slack-Connect-style). W3a delivers that for **existing FamLink users**: an organizer can invite a member of *another* family to fully participate in an event (RSVP + contribute to the shared surface), with hard isolation everywhere else. This is the differentiator no funded competitor has (per the competitive dossier): a true cross-household graph, not a single-home organizer.

## 1. Scope

**In scope (W3a):**
- A first-class participation grant (`EventParticipant`) with two roles.
- Invite → accept/decline → revoke lifecycle for cross-family participants who **already have FamLink accounts**.
- Channel-agnostic, one-tap **authenticated** acceptance (email / SMS link / push / in-app).
- Authorization for the event's shared surface (**RSVP, tasks/`EventItem`**) by event role. **Photos and gift-registry contribution/visibility for cross-family participants are deferred** (decision 2026-06-24, §11).
- A read allowlist (`ForeignInvitedEventDTO`) and participant-scoped notifications.

**Out of scope (→ W3b, committed next phase, §10):** passive SMS "reply **Y**" acceptance (inbound webhook), onboarding **non-users** into participation, contact verification/normalization. **Deferred to a later increment:** cross-family **photo upload** and **gift-registry** contribution/visibility — W3a's cross-family surface is RSVP + tasks (owning-family members still use photos/registry as today). **Also untouched:** the existing P2-12 token-guest path for accountless outsiders (still works as-is); cross-family recurring-event semantics beyond current same-family recurrence.

## 2. Principles (from the reframe, applied here)

1. Access is conferred **only** by an `ACTIVE EventParticipant` grant — never an invitation row, family membership, contact match, or shared-`Person` record.
2. Grants are **snapshots**: inviting a person grants exactly that person; later-added members of their family are never auto-included.
3. Participation grants the **event surface and nothing else** about another family (§8 isolation).
4. **No entitlement transfer:** participating in another family's event confers event-scoped access only — no AI/premium features.
5. The event is **owned/billed/administered by the organizer's family** (reframe §5 Option 1).

## 3. Data model

**New `EventParticipant`** (the canonical grant):
- `id`, `eventId` (→ Event, cascade), `personId` (→ Person, cascade), `role` (`EventRole`: `PARTICIPANT` | `EVENT_ADMIN`), `status` (`ParticipantStatus`: `ACTIVE` | `REVOKED`), `invitedById` (Person who invited), `createdAt`, `updatedAt`.
- `@@unique([eventId, personId])`; indexes on `eventId`, `personId`.

**`EventInvitation`** gains one nullable column: `role` (`EventRole?`) — the *proposed* role, copied onto the `EventParticipant` at accept. All existing fields (internal `personId`/`householdId`, guest token fields, `linkedPersonId`, `status`) are unchanged.

**Enums:** `EventRole { PARTICIPANT, EVENT_ADMIN }`, `ParticipantStatus { ACTIVE, REVOKED }`.

Migration is **additive**: one new table + two enums + one nullable column. No backfill (existing events have no cross-family participants); existing same-family behavior is unchanged.

## 4. Lifecycle & accept flow

1. **Invite** — an **event-admin** (see §5) invites an existing FamLink user from another family. Creates an `EventInvitation` with `linkedPersonId` = the invited person, `status = PENDING`, `role` = proposed. A notification is sent on the invitee's available channels (email / SMS / push / in-app) via `NotificationService`, each carrying a one-tap accept link.
2. **Accept** — the invitee opens the link on **any channel** and accepts **as their authenticated FamLink identity** (web *or* mobile; sign in if not already). On accept: create `EventParticipant(status=ACTIVE, role)`, set invitation `status=ACCEPTED`. The grant binds to the authenticated person — a forwarded/leaked link cannot grant participation to someone else.
3. **Decline** — invitation `status=DECLINED`; no grant created.
4. **Revoke / remove** — an event-admin revokes → `EventParticipant.status=REVOKED` (row retained for audit; access cut immediately). A revoked person can be re-invited (new invitation).

**Accept-method decision (revisit point):** W3a ships the channel-agnostic **one-tap authenticated link** as the universal accept method (an SMS invite reads *"Tap to accept: <link>"* — zero typing, no app required). Literal SMS **"reply Y"** acceptance is **deferred to W3b**, where the inbound-SMS webhook + STOP/opt-out compliance are built once (they're needed there for non-user onboarding anyway). Reply-Y is secure-by-construction (a reply must originate from the invited number), so it slots in cleanly later. *This is the one knob most likely to change on review.*

## 5. Authorization & roles

The event **creator** and the **owning family's admins** are event-admins implicitly (no `EventParticipant` row needed — they authorize via family membership as today). A **cross-family** participant authorizes via their `ACTIVE EventParticipant` grant; they may be granted `EVENT_ADMIN`.

Grant predicate (new): `activeEventParticipant(personId, eventId) → { role } | null`. Authorization for any event-scoped action = (owning-family admin) **OR** (matching active grant with sufficient role).

| Action | Owning-family admin / `EVENT_ADMIN` | `PARTICIPANT` | Non-participant |
|---|---|---|---|
| View event core + shared surface | ✅ | ✅ (via DTO) | ❌ |
| RSVP (own) | ✅ | ✅ | ❌ |
| Add task (`EventItem`) | ✅ | ✅ | ❌ |
| Edit/delete **own** contribution | ✅ | ✅ | — |
| Edit/delete **others'** contributions | ✅ | ❌ | ❌ |
| Edit core event details | ✅ | ❌ | ❌ |
| Invite / remove participants, set roles | ✅ | ❌ | ❌ |

"Own contribution" = the `EventItem`/`RSVP` whose creator `personId` matches the actor. **Cross-family photo upload and gift-registry contributions are deferred** (decision 2026-06-24); W3a's cross-family contribution surface is tasks + RSVP. Owning-family members continue to use photos/registry on their own events as today.

## 6. What a foreign participant sees — `ForeignInvitedEventDTO`

Reads by a cross-family participant are shaped by an **allowlist** DTO (extends the discipline from the superseded invitation design). 

**Included:** event `title`, `description`, `startAt`/`endAt`, `location*`, `eventType`; the shared surface they may access (**tasks**; photos/registry deferred per §1); and the **participant list as display names + RSVP status** (you must see who's coming to collaborate).

**Excluded (hard isolation, reframe §8):** the owning family's name and member roster beyond participants; any *other* events; non-participant attendees; notes/photos/attachments of other events; internal IDs (family/household/person IDs not required by the surface); unrelated invitations. Writes are **not** governed by the DTO — each write goes through the §5 role checks.

**Participant-to-participant privacy:** participants see each other's **display name + RSVP status** and shared-surface contributions only. No contact info, no family affiliation details, no cross-linking to other events.

## 7. Notifications

Recipient lists for shared-event notifications are computed from the **participant set** (owning-family members on the event + active `EventParticipant`s), **never** from either tenant's full membership. A cross-family event update must never broadcast to either whole family. Reuses `NotificationService`; Socket.io event delivery is likewise participant-scoped.

## 8. Isolation invariants to preserve (from P3-00 / reframe §8)

- `FamilyGroup` stays the tenant boundary; W3a grants cross-tenant read of **one event's surface** only, to people with an active grant.
- No leak of: family name, member roster (beyond participants), other events, non-participant attendees, internal IDs, unrelated invitations.
- Cross-family participation never confers AI/premium entitlement.
- Every event-surface write is authorized by the §5 predicate; the DTO governs reads only.

## 9. Testing approach

- **Unit:** `activeEventParticipant` grant predicate (active vs revoked vs none); role resolution; snapshot behavior (adding a member to the foreign family does not create a grant).
- **Routes:** invite → accept → grant; decline; revoke cuts access; each cross-family write surface (RSVP, tasks) tested for `PARTICIPANT` vs `EVENT_ADMIN` vs non-participant (403s where expected); own-vs-others contribution edits; cross-family **photo/registry writes are rejected** in W3a (deferred).
- **DTO allowlist:** assert a foreign participant's event read contains the allowed fields and **omits** family name, roster beyond participants, other events, and internal IDs.
- **Notifications:** assert recipient calculation is participant-scoped (no tenant-wide broadcast).
- **Isolation regression:** a non-participant (incl. a member of the organizer's *other* families) gets 403 on read/write.

## 10. W3b — committed next-phase follow-on (NOT this spec, but planned)

Recorded here so it is explicitly accounted for, per Steve (2026-06-24): **W3b will ship passive onboarding** — invite a **non-user** by phone/email; they accept via **inbound SMS "reply Y"** (or an email link), which onboards them (contact verification/normalization, identity creation) and mints an `EventParticipant` on W3a's primitive. W3b builds: the **inbound Twilio webhook**, reply parsing (Y/N/**STOP**), invite matching, **SMS opt-out/TCPA compliance + consent records**, and contact verification (the reframe's prerequisite subsystem). It depends on W3a and gets its own spec → plan → build cycle.

## 11. Decisions resolved (2026-06-24, Steve)

1. **Accept method:** ✅ one-tap authenticated link on every channel in W3a; literal SMS "reply **Y**" deferred to W3b (§4, §10).
2. **Both roles in W3a:** ✅ `PARTICIPANT` *and* `EVENT_ADMIN` ship in W3a, including promoting a cross-family participant to `EVENT_ADMIN` (§5).
3. **Contribution surface:** ✅ W3a cross-family contributions = **tasks + RSVP only**; cross-family **photo upload + gift-registry** contribution/visibility **deferred** to a later increment (§1, §5, §6).
