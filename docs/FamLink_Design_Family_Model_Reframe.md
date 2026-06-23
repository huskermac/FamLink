# FamLink — Design: Family Model Reframe & Cross-Family Collaboration

| Field | Value |
|---|---|
| Status | **DRAFT — pending council review + Steve approval (NOT authorized to build)** |
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

- Decouple `Household` from `FamilyGroup`: `Household` becomes a first-class entity
  (location + `HouseholdMember`s) no longer owned by exactly one family. (Migration of the
  existing `Household.familyGroupId` is an open question — see §9.4.)
- `FamilyMember` (per-person, multi-family membership) stays as the membership primitive.
- The **shared person is the bridge** for *durable* cross-family relationships: co-parents,
  blended families, in-laws, an engaged couple. A child of divorced parents is a member of
  both parents' families; their events are visible to both with **no family-to-family
  link** required.
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

## 10. Proposed sequencing

1. **W2 — per-person entitlement** (smallest; unblocks P3-02; enabler for multi-family UX).
2. **W1 — Household/Family reframe** (foundation; migration-heavy).
3. **W3 — cross-family shared events** (rides on W1 + the participation primitive).
4. **W4 — Pro Organizer beta** (rides on W3's non-member organizer grant + a B2B billing track).

Each ships as its own plan/spec → implementation cycle.
