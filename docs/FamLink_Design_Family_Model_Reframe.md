# FamLink — Design: Family Model Reframe & Cross-Family Collaboration

| Field | Value |
|---|---|
| Status | **DRAFT — council round-1 done; B1+B2 resolved, B3 (planner consent) + Pro billing still open; NOT authorized to build** |
| Created | 2026-06-23 |
| Supersedes | `FamLink_Design_Cross_Family_Invitation_Visibility.md` (token-only approach — see §7) |
| Related | ADR v0.4.7; P3-00 isolation hardening; P3-02 (AI budget); `packages/db/prisma/schema.prisma` (FamilyGroup / Household / FamilyMember / Event / EventInvitation); product-direction memory 2026-06-12 (affiliate/commerce thesis) |
| Drivers | Steve (product) + Claude (design) |

> Captures the design converged in the 2026-06-23 brainstorming session so it can be
> council-reviewed and estimated. Nothing here is locked until Steve confirms after review.

---

## 0. Why

The P3-00 backlog item "cross-family invitation visibility" was a *symptom* of a deeper
modeling problem: **`FamilyGroup` conflates two distinct concepts** — the hard
isolation/billing **tenant boundary** and the human notion of **"my family."** `Household`
is trapped beneath exactly one `FamilyGroup`, which cannot represent real life (a household
routinely belongs to more than one family — e.g. a grandparent shared across two adult
children's families). This design reframes the model and defines how families collaborate
across the tenant boundary **without weakening isolation**.

## 1. Scope — four interlocking workstreams (sequenced in §10)

- **W1 — Household/Family reframe** (data model)
- **W2 — Per-person entitlement** (billing/AI; feeds P3-02)
- **W3 — Cross-family shared events** ("Approach A")
- **W4 — Non-family organizer + B2B "Pro Organizer" beta**

## 2. Principles (decided this session)

1. **`FamilyGroup` remains the explicit, opt-in tenant / billing / isolation boundary.**
   Family is NOT emergent from the relationship graph — a connected-component "family" is
   rejected because the small-world effect collapses the kinship graph into one un-billable,
   un-isolatable blob.
2. **Membership is per-person and binary/full.** No partial-visibility tiers. Joining a
   family = full inclusion, gated by human intent ("don't add someone you don't mean to
   fully include"). A person may belong to multiple families.
3. **Households are locations, not boundaries.** A `Household` is a place with residents; a
   soft sub-grouping, largely irrelevant to events/calendars/billing.
4. **Collaboration crosses the boundary at the _surface_, not the _tenant_.** Precedent:
   Slack Connect shares a channel between orgs without merging them. We share **events**,
   not families.
5. **Entitlement attaches to the person, derived at read-time, reversible by construction.**

## 3. W1 — Household / Family reframe

- **`Household`↔`Family` is many-to-many with a minimum of one family** (decided 2026-06-23,
  resolves council BLOCKER B2). A household is **never tenantless**, so authorization derives
  from the admins of any family it is linked to — no standalone household ACL needed. The
  existing `Household.familyGroupId` FK migrates to a `Household↔Family` join table; every
  current household gets exactly one link (= today's behavior), so the migration is
  backward-compatible.
  - **Shared edit/delete:** any linked family's admin may edit the household; "delete" means
    *unlink from that family*; the household is destroyed only when its **last** link is
    removed (the min-1 rule enforces this).
  - **Linking is a consented pull (decided 2026-06-23):** either side may initiate — a family
    member can pull a person/household in, **or** an active user can request to join — but the
    **counterparty must always consent** (no unilateral adds, either direction). Consent
    friction scales to user type: a **passive** user replies "Y" to an SMS/email (which
    simultaneously proves control of that contact — lightweight verification baked in); an
    **active** user confirms in-app. **Minors** cannot self-consent — a **guardian** consents
    on behalf of a ward. All links/memberships are **revocable** (a person can always leave /
    unlink).
  - **OPEN (Steve):** is "pull Grandma in" one consent (join family → household link comes
    along) or two (join family vs. share home address separately)? Lean: one.
- `FamilyMember` (per-person, multi-family membership) stays as the membership primitive.
- The **shared person is the bridge** for *durable* cross-family relationships: co-parents,
  blended families, in-laws, an engaged couple. **Correction (council round-1 BLOCKER):** a
  shared person record does **not** auto-surface one tenant's events into the other. It only
  makes the relevant people easy to bring together. Cross-tenant event visibility **always**
  flows through explicit event participation (W3), never from a shared `Person` record — and
  it derives from the *viewing adult's* membership/participation, never from a passive shared
  minor. So a co-parented child's soccer game appears in both homes only because the event is
  shared into both (W3) or created in both, not merely because the child is dual-member.
- **"MetaFamily / Associated Family"** (a standing link between Family tenants) is
  **REJECTED**: it is heavy, reintroduces transitive-visibility and billing-ownership
  ambiguity, and the durable cases it targets are already covered by shared people.

## 4. W2 — Per-person entitlement (feeds P3-02)

- **Entitlement and budget attach to the person, not the family.**
- **OR-coverage:** a person holding a paid seat in *any* family is covered everywhere they
  act.
- **No spillover:** a covered person's entitlement does NOT upgrade the free families around
  them. Only the covered person's own actions are covered; non-covered members of a free
  family get nothing. (The visible asymmetry is the intended conversion pressure.)
- **Per-person AI allowance** (not a per-family pool). Cost is bounded by
  (#covered persons × allowance) with no family-size multiplier; matches the existing
  per-user (20/user/day) limiter.
- **Reversibility guardrails:** entitlement is **derived at read-time** (never materialized
  into stored state), behind a single resolution function/flag; `FamilySubscription.
  grandfathered` is the pre-committed escape hatch if the rule ever tightens; cap per-spend.
- **Near-limit mechanics:** usage is attributable per (person × family context) via
  `AssistantMessage.personId` + `familyGroupId`, enabling:
  (a) a targeted "upgrade your family" upsell at the high-intent moment usage **in a family
  context** approaches the limit;
  (b) **degrade the unpaid/foreign context first** to protect the paying relationship;
  (c) **no spillover** to non-covered members at any point.

## 5. W3 — Cross-family shared events ("Approach A")

- The **event** is the cross-family collaboration boundary.
- An organizer invites FamLink users from other families as **full participants** (not
  read-only guests). The event carries its own shared surface — tasks, gift registry, RSVP,
  photos — scoped to *that event*.
- **Participation (not family membership) grants access** to the event's shared surface and
  **nothing else** about another family. The `ForeignInvitedEventDTO` allowlist discipline
  from the superseded design still governs what a cross-family participant may see.
- **Membership-bridge alone does NOT solve weddings:** the collaborators (both sets of
  parents, siblings, wedding party) extend beyond the bridge people, so W3 is required
  independently of the shared-person bridge.
- **Ownership (tentative — reopened by W4):** Option 1 — event owned by the organizer's
  family for billing/admin, with a cross-family participant list.

## 6. W4 — Non-family organizer + B2B "Pro Organizer" beta

- **Decouple "organizer" from "family member"** (bake in now — cheap, forward-compatible):
  an organizer is granted **event-scoped admin** on a specific event; usually a family
  member, but not necessarily.
- **Pro Organizer account (BETA):** a non-family professional (e.g. wedding planner) who can
  create/manage events and pull whole families in. Acquisition channel (planner seeds
  families → families convert), aligned with the affiliate/commerce thesis.
- **Billing insight — central, not optional:** the acquisition loop requires the **planner**
  to be the billing entity, because the families being brought in are not yet on the app or
  paying. So "planner pays" (a B2B Pro tier) is what makes the loop close.
- **Included now as a BETA launch option** (Steve's call, 2026-06-23), not deferred.

## 7. Relationship to the prior design

This **supersedes** `FamLink_Design_Cross_Family_Invitation_Visibility.md`, whose value was
capped at "token-only" (a no-op) pending a contact-verification subsystem. The reframe makes
most of that problem evaporate: durable cross-family cases → **shared people**; occasional
cases → **shared events (W3)**; true outsiders → the existing token-guest link or a
Pro-organized event. The contact-verification prerequisite leaves the critical path; it
remains relevant only if account-based foreign visibility *by raw contact match* is ever
pursued — which is **not planned**.

## 8. Isolation invariants to preserve (from P3-00)

- `FamilyGroup` stays the tenant boundary; nothing here grants cross-tenant read of family
  data beyond an explicit **event surface** a person was made a participant of.
- Cross-family participation must NOT leak: family name, member roster, attendee names of
  non-shared events, notes/photos/attachments of other events, internal IDs, or unrelated
  invitations.
- Pro Organizers get **event-scoped access only** — never family-scoped visibility.

## 9. Open questions (for the council)

1. **Event ownership when the organizer is a non-family Pro.** Planner/Pro account *owns*
   the event vs. *owns-on-behalf-of* a (possibly not-yet-paying) client family — resolve
   billing, admin, and deletion authority.
2. **Participation representation.** Extend `EventInvitation` (already carries
   guest/`linkedPersonId` fields) vs. a new `EventParticipant` model with event-scoped
   roles. Need a clean grant predicate the DTO allowlist can enforce.
3. **Pro billing model (Stripe).** Planner as Customer; per-event charge vs. subscription
   vs. seat/credit; how seeded families later convert without double-charging (interacts
   with W2 OR-coverage).
4. **Migration / blast radius.** Everything keys off `familyGroupId`. Decoupling `Household`
   + adding cross-family participation + Pro accounts is large; sequence to avoid reopening
   P3-00 isolation holes.
5. **Entitlement × shared events.** Does participation in a Pro/cross-family event confer
   any AI/premium features to participants? Default: **event-scoped only**, no entitlement
   transfer.
6. **Decomposition.** Confirm W1–W4 as separately-shippable plans vs. one mega-plan.

## 10. Proposed sequencing (revised after council round-1)

Council finding (MAJOR): **W3 does NOT depend on W1.** Original ordering made the
migration-heavy reframe a needless prerequisite. Re-sequenced:

1. **W2 — per-person entitlement** (smallest; unblocks P3-02; enabler for multi-family UX).
2. **W3 — cross-family shared events** (ships on the *current* model via an
   event-participation primitive; no Household decoupling required).
3. **W4 — Pro Organizer beta** (rides on W3's non-member organizer grant + a B2B billing
   track + **family-admin consent** — see BLOCKER B3).
4. **W1 — Household/Family reframe** (independent, migration-heavy track; gated on a
   household ownership/ACL model — see BLOCKER B2; can run in parallel or be deprioritized).

Each ships as its own plan/spec → implementation cycle.

---

## Appendix — council review trail

### Round 1 (2026-06-23, Codex/GPT reviewer)

Reviewer affirmed: tenant/event-surface separation, rejection of transitive family links,
propose-confirm requirement, and separate-workstream delivery.

**Open BLOCKERs (need Steve's product decision — design is not build-ready until resolved):**

- **B1 (W1):** A passive shared `Person` (esp. a minor) must not authorize cross-tenant
  visibility. *Disposition: ACCEPTED — fixed in §3; visibility flows via W3 participation /
  the viewing adult's membership only.*
- **B2 (W1):** A tenantless `Household` (names + addresses = PII) has no ownership / admin /
  deletion boundary. *Disposition: **RESOLVED** 2026-06-23 — `Household`↔`Family` is M2M with
  **min 1** (never tenantless; authz from any linked family's admins) + a consented-pull
  link/join flow with passive ("reply Y") vs active consent and guardian consent for minors.
  See §3. Also resolves the W1 "membership consent missing" MAJOR. This consent pattern is the
  template for B3 (planner pulls a family into an event → family admin consents).*
- **B3 (W4):** "Pull whole families in" violates event-scoped access. A planner must **never**
  enumerate a roster or enroll members; require **family-admin consent + admin-selected
  invitees**, and define snapshot-vs-follows-membership. *Disposition: ACCEPTED — needs a
  consent-flow design decision from Steve.*

**MAJORs to fold into the per-workstream specs (not blockers):**

- W2: "paid seat" is undefined — current `seatCount` is a total allowance, not per-person
  assignment; OR-coverage needs explicit seat assignment + suspended/delinquent/trial/grace
  handling.
- W2: `grandfathered` is a Stripe *pricing* flag, not an entitlement-policy escape hatch —
  use a **separate** mechanism (corrects §4).
- W2: allowance/degradation algorithm underspecified (per-person-global vs per-context,
  atomic charging of concurrent requests).
- W2/W4: define what the planner actually *buys* (billable capabilities + cost boundary).
- W1: membership creation/consent missing (acceptance, revocation, suspension, account
  claiming, duplicate-person resolution, guardian rules for minors).
- W3: participation lifecycle undefined (pending/accepted/declined/revoked/removed/expired);
  access requires an *accepted, non-revoked* grant, not a mere invitation row.
- W3: DTO allowlist covers **reads only** — tasks/RSVPs/registry/uploads/edits/deletes each
  need event-role write authorization.
- W3: participant-to-participant privacy within an event is unspecified (identity, contact,
  RSVP, photos, gift activity, minors).
- W3/W4: moderation, export, retention, transfer, cancellation, deletion authority.
- W3: notifications + Socket.io currently target family membership — cross-family delivery
  needs **participant-based** recipient calculation (must not broadcast to either tenant).

**MINOR / NIT:** households aren't truly "irrelevant" (addresses, logistics, emergency
contacts, household-scoped AI); define shared-event calendar behavior; "full participant" is
too broad — add a small role set (participant / event-admin); specify whether a Pro is a
plain `Person` with no `FamilyMember` row vs. a separate account type; give each term
(family / tenant / household / person / participant / organizer / owner) one canonical
definition.
