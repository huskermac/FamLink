# FamLink — Design: Cross-Family Invitation Visibility

| Field | Value |
|---|---|
| Status | **DRAFT — backlog (not authorized to build)** |
| Created | 2026-06-19 |
| Authoring | Claude (draft) + Codex/GPT (review) — two-model council, 2 review rounds |
| Related | ADR-15 (content moderation), `eventVisibility.ts` (P3-00 M2), `EventInvitation` model, guest-token view (`guest.ts`) |

> This design was produced as a council dry-run. It captures the converged design so
> the feature is ready to estimate/build when greenlit. It is **not** an approved
> decision and nothing here is locked until Steve confirms.

---

## 1. Goal

When a member of family **X** invites an external guest by email/phone, and that contact
matches an existing FamLink person **B** (a member of family **Y**), B should see the
"foreign" event (family X's event) in B's **own** upcoming-events list — unless B has
declined — **without weakening family isolation**.

- Accepted or no-response → visible to B.
- Declined → hidden (reversible).

## 2. Current state (verified in code)

- `EventInvitation`: `personId` (internal invitee), `linkedPersonId` (set when a guest
  email/phone matched an existing person via the global contact match), `status`
  (PENDING | ACCEPTED | DECLINED | TENTATIVE), `guestToken`.
- `eventVisibility.ts > invitedOrParticipantFilter` already grants read access when
  `invitations.some.linkedPersonId == personId` — **but** every consumer
  (`loadEventForMember`, `visibleEventsWhere`) first requires
  `activeFamilyMembership(event.familyGroupId, personId)`. A linked person in another
  family is blocked before `linkedPersonId` is consulted, so the link is currently inert.
- Upcoming/calendar lists are family-scoped: a person only sees events in families they
  belong to.
- A token-based foreign view already exists for guests (`guest.ts`): a limited event
  projection (title, time, location, attendee display names, the guest's own RSVP).

## 3. Core security reframing

**A raw contact match must NOT, by itself, grant cross-family read access.** Emails and
phone numbers get recycled, changed, mistyped, and are often unverified. This feature
removes the membership gate that currently makes `linkedPersonId` inert, so the grant
predicate must be strict:

> **Grant predicate (authoritative):** B may see event E in family Y only if E has an
> **active** invitation whose **normalized contact snapshot** (the `guestEmail` /
> `guestPhone` recorded on the invitation) exactly equals a contact that B **currently
> owns and has verified**, and that contact is **uniquely owned** (no other person has it
> verified). `personId` / `linkedPersonId` alone MUST NEVER authorize.

**Prerequisite:** a contact-verification mechanism on `Person` contacts (verified flag +
normalization + uniqueness). If that subsystem is not built, this feature ships
**token-only** (current external-guest behavior) and the account-based foreign view is
gated off.

## 4. Access derivation — always live

Access is computed live from the invitation on every request; nothing is cached. It
therefore revokes **immediately** when any of these change:

- invitation revoked by the host (`revokedAt` set) or deleted,
- invitation status set to DECLINED,
- event deleted or canceled,
- B's matching contact unlinked or its verification revoked,
- B's account deleted.

> Note: revocation is a **host** action distinct from the invitee's DECLINE, so it needs
> its own state — add `revokedAt: DateTime?` to `EventInvitation` (an invitation is
> *active* when `revokedAt IS NULL`). Deleting an event cascades to remove its invitations.

## 5. Query: cross-family invited events

`invitedCrossFamilyEvents(personId)` returns events where ALL hold:

- an **active** invitation (`revokedAt IS NULL`) for the event satisfies the **grant
  predicate** (§3) for `personId`,
- invitation `status != DECLINED`,
- the event exists and is not canceled,
- `event.familyGroupId NOT IN` B's **active** family ids (suspended/inactive membership
  does not count),
- the event is not over: `endAt >= now` OR (`endAt IS NULL` AND `startAt >= now`)
  (includes currently-ongoing events).

## 6. Upcoming list

`union(memberEvents, invitedCrossFamilyEvents)`, deduped by event id with **member access
taking precedence** — if B is both a member and invited, B gets the full member view,
never the limited one. Foreign entries are flagged `source: "invitation"`.

## 7. Detail access — separate loader + enforced DTO

Do **not** extend `loadEventForMember` (a dual full/limited return risks existing callers
serializing member-only fields). Add a distinct `loadForeignInvitedEvent(eventId,
personId)` that enforces the grant predicate and returns a dedicated
`ForeignInvitedEventDTO` via an explicit allowlist projection — the member serializer is
never reachable on this path.

**`ForeignInvitedEventDTO` allowlist:** `id`, `title`, `startAt`, `endAt`,
`locationName`, B's own RSVP/invitation status, and an attendee **count** only.

**Explicitly excluded (must not cross the family boundary):** family name, member roster,
attendee names, notes, photos, attachments, creator contact info, internal IDs of others,
and any unrelated invitations.

## 8. RSVP / invitation management

- An RSVP write targets exactly the invitation resolved by the grant predicate for
  `(person, event)`; reject if none.
- **One person can match multiple invited contacts** (e.g. invited by both email and
  phone). Resolve deterministically to **one logical invitation per `(event, person)`**:
  B counts as invited if *any* active, non-declined invitation satisfies the grant; RSVP
  writes canonicalize to a single invitation (deterministic pick — e.g. earliest
  `sentAt`) and the others mirror its status.
- **DECLINE is reversible:** it hides the event from the upcoming list but the invitation
  record remains; a "my invitations" endpoint (resolved by the **same grant predicate**)
  lets B set ACCEPTED/TENTATIVE again. TENTATIVE is treated as visible.

## 9. PRIVATE events

A PRIVATE event B was explicitly + verified-invited to remains visible to B (the verified
invitation is the grant), served via the same limited DTO.

## 10. Test obligations

- Boundary tests proving NONE of {roster, attendee names, notes, photos, family name,
  internal IDs, unrelated invitations} cross the family boundary.
- Grant predicate: unverified / non-unique / mismatched-snapshot contacts do **not**
  authorize; `linkedPersonId`-only does **not** authorize.
- Member-precedence dedup; inactive-membership excluded.
- Decline → un-decline; each revocation path (host revoke, event cancel/delete, contact
  unlink, verification revoke, account delete) removes access immediately.
- Contact reassignment; duplicate invitations across email/phone; ongoing-event window.

## 11. Deferred

- Notifying the matched person of the cross-family invite — deferred until the
  verified-contact grant is proven safe.
- The contact-verification subsystem is a **prerequisite**; absent it, ship token-only.

---

## Appendix — council review trail

- **Round 1 (v1):** VERDICT REVISE. Major catches: contact-match-as-auth without
  verification; no revocation/lifecycle; overloading `loadEventForMember` risks member-
  field leakage; undefined foreign projection; RSVP authz; ongoing-event window.
- **Round 2 (v2):** big blockers confirmed resolved; converged to three refinements —
  explicit canceled/revoked filters, multi-contact RSVP determinism, and the
  snapshot-vs-verified-contact grant comparison. All folded into this v3.
