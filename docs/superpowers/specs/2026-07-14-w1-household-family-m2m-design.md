# W1 — Household↔Family M2M Reframe (design spec)

| Field | Value |
|---|---|
| Date | 2026-07-14 (brainstorm converged, Steve approved section by section) |
| Phase | P3-04 (W1 of the family-model reframe) |
| Parent design | `docs/FamLink_Design_Family_Model_Reframe.md` §3 (council-converged 2026-06-24. This spec resolves the B2-write-authority and membership-consent MAJOR carry-ins.) |
| Scope decision | **A+B+C** (Steve, 2026-07-14): schema reframe, consented-pull link flows, and membership-lifecycle formalization. One spec, sequential PRs. |
| Status | Steve approved. §3.3 amended 2026-07-15 (PR-1 audit shape). **Amended 2026-08-07** — §2 decision 8 (consent gates a reachable autonomous party), decision 9 (`Person.createdByFamilyGroupId` provenance gate for a data-entry add), decision 10 (seat billing decoupled from consent, reconciled from actual membership). The PR-2 plan is drafted (`docs/superpowers/plans/2026-08-07-w1-pr2-consent-flows.md`) but **not execution-ready**. It needs a round-3 revision that folds in decisions 9 and 10 and the ~12 mechanical council BLOCKERs. It also needs a billing-reconciliation slice. |

## 1. Goal

Decouple `Household` from the single-family tenant boundary. `Household`↔`FamilyGroup` becomes **many-to-many with a minimum of one link** (never tenantless). A **consented pull** flow creates all new links and family memberships. Either side starts the flow. The counterparty always consents. A guardian consents for a minor. Household PII writes use **any-linked-admin authority with an audit trail**. Cross-tenant visibility flows *only* through membership or accepted W3a event participation. It never flows through a shared person or a shared household (parent-design invariant B1).

## 2. Locked product decisions (Steve, 2026-07-14)

1. **Scope:** the whole reframe (A schema, B consent flows, C lifecycle) in one spec. The implementation slices into sequential PRs (§10).
2. **Household write authority (council carry-in B2):** **any linked family's admin edits freely. The system audit-logs every change** (who, when, what, visible to all linked families' admins). The design has no per-change consent and no origin-family ownership.
3. **HOUSEHOLD-scoped event invitations under M2M:** a resident who is a member of the event's family gets the normal invitation. **The system escalates a non-member resident to a W3a cross-family `EventParticipant` invitation** (accept-gated, `ForeignInvitedEventDTO` allowlist). The design has no silent skip and no visibility leak.
4. **Guardian rule:** **any ADULT with the admin role in any family the minor already belongs to** gives a minor's consent. For a minor in no family yet, the adult who created the `Person` record gives consent. This slice builds no new guardian designation.
5. **Teens = minors:** only an ADULT self-consents. A TEEN and a CHILD need guardian consent.
6. **Architecture:** **request→grant separation** (Approach 1). A new `LinkRequest` model holds pending consent. The system creates a `FamilyMember` or `HouseholdFamily` row only on acceptance. Row existence means access. The design adds no status filter to the existing authz queries.
7. **SMS consent stays link-token-based:** this slice does not touch the W3b keyword router. "Reply Y" stays only the event-RSVP verb. Bare-keyword link consent is out of scope (W1b if ever wanted).
8. **Consent gates a *reachable autonomous party*, not the mechanical membership row (Steve, 2026-08-07 — narrows decision 6 and §3.2/§6.2/§6.3).** To build out your own family with authored records is data entry, not an act against another person. The test is **whether the target Person is reachable or acts autonomously**. Two facts on the `Person` decide it:
   - **Active account** (`userId != null`) → consent **needed**, delivered **in-app**. The target, or the guardian for a minor, accepts a `LinkRequest` from the consent inbox.
   - **Passive** (`userId == null`) **with any contact detail** (`email` or `phone` present) → consent **needed**, delivered as a **single-use token consent link** (email or SMS) to that contact. The token page consent also verifies control of the contact. It sets `emailVerifiedAt` or `phoneVerifiedAt`, as the W3b Y reply does.
   - **Passive with no contact detail** (`userId == null` and no `email` or `phone`) → **no consent, pure data entry.** The admin authored the record (a child with no contact, a deceased relative, an offline relative). The attach to a family through the existing direct path stays as-is.

   The plan carries three consequences. (a) The existing `POST /families/:familyId/members` (families.ts) is **kept only for the no-consent case**. It must **reject or route through a `LinkRequest`** any target that has an account or a contact detail (provenance-gated — see decision 9). (b) Seat billing decouples from the mutation fully — see decision 10. (c) The **passive→active** consent moment (a passive record claims an account) is **already handled at signup by CIF Plan B** (the Clerk `user.created` consolidation and merge). This slice does not re-implement it.
9. **Direct-add provenance — a `Person` gains an authoring owner (Steve, 2026-08-07, from the round-2 council).** The consent-gate exemption for "passive, no contact = data entry" is safe only if the requester's family **authored** the record. If not, an admin can attach a *foreign* passive person by a guess of their id and get their PII. `Person` gains a **`createdByFamilyGroupId String?`** column (logical). The system sets it whenever it creates a passive `Person` in a family context — onboarding member creation, or `POST /persons` by an existing user. **A data-entry direct-add is allowed only when the target's `createdByFamilyGroupId` equals the requester's family** (with passive and no-contact). The migration backfills each existing passive person to a family they are a member of now (prod is tiny — 12 persons). A `Person` with no owner or a foreign owner can be added only through a consented `LinkRequest`.
10. **Seat billing is decoupled from consent and reconciled from actual membership (Steve, 2026-08-07, from the round-2 council).** A Stripe seat charge tied to the add or accept event is race-prone and non-recoverable. Request-time authorization goes stale by accept time. A Stripe failure after the grant commits strands an accepted membership. Instead, **the consent and accept flow makes no inline Stripe call and never blocks acceptance on billing.** An **idempotent reconciliation** sets the seat count from the family's true active-member count. It sets the absolute Stripe seat quantity. Every membership change triggers it (add, remove, suspend, CIF activation). The `customer.subscription.updated` webhook reconverges it. A request-time cost *disclosure* to the requesting admin is allowed (informational, non-binding). It is not a gate and never a charge. This supersedes decision 8 consequence (b) ("moves to the acceptance step") and the existing per-mutation `checkSeatExpansion` 402-confirm on a member add. **The reconciliation is its own slice** (it can precede or accompany PR 2). **The consent PR must not call Stripe.**

## 3. Data model

### 3.1 `HouseholdFamily` (new join table)

```prisma
model HouseholdFamily {
  id              String      @id @default(cuid())
  householdId     String
  household       Household   @relation(fields: [householdId], references: [id], onDelete: Cascade)
  familyGroupId   String
  familyGroup     FamilyGroup @relation(fields: [familyGroupId], references: [id], onDelete: Cascade)
  linkedAt        DateTime    @default(now())
  linkedByPersonId String?

  @@unique([householdId, familyGroupId])
  @@index([familyGroupId])
}
```

- **The app layer enforces min-1:** the unlink operation refuses to remove the last link
  (`409 LAST_LINK`) unless the caller passes `destroy: true`. `destroy: true` deletes the
  household and its `HouseholdMember` rows.
- The migration **drops** `Household.familyGroupId` and its index and FK. All other `Household` fields stay.
- `HouseholdMember` (person↔household residency) does not change.

### 3.2 `LinkRequest` (new — the single pending-consent model)

```prisma
model LinkRequest {
  id                  String    @id @default(cuid())
  kind                String    // FAMILY_MEMBERSHIP | HOUSEHOLD_LINK
  direction           String    // PULL (family invites target in) | JOIN (target asks family)
  familyGroupId       String    // the family being joined (membership) or being linked (household)
  targetPersonId      String?   // FAMILY_MEMBERSHIP
  targetHouseholdId   String?   // HOUSEHOLD_LINK
  carryHouseholdId    String?   // "one consent": membership acceptance also links this household
  requestedByPersonId String
  status              String    @default("PENDING") // PENDING|ACCEPTED|DECLINED|EXPIRED|CANCELLED
  consentedByPersonId String?   // self, or guardian for minors
  consentChannel      String?   // IN_APP | SMS | EMAIL
  token               String?   @unique // passive delivery only; single-use
  expiresAt           DateTime
  createdAt           DateTime  @default(now())
  resolvedAt          DateTime?

  @@index([familyGroupId, status])
  @@index([targetPersonId, status])
  @@index([targetHouseholdId, status])
}
```

- Acceptance creates the grant row **in one transaction** (`FamilyMember` with default
  non-admin roles, or `HouseholdFamily`). It also creates the carry-in household link when
  `carryHouseholdId` is set. It stamps `resolvedAt`, `consentedByPersonId`, and `consentChannel`.
- `FamilyMember` and `HouseholdFamily` **never contain unconsented rows.** The existing
  authorization queries (`activeFamilyMembership`, `eventVisibility`, all P3-00 isolation
  checks) keep their meaning with no new filter.
  - **Amended 2026-08-07 (Steve) — §2 decision 8:** "unconsented" means a *reachable
    autonomous party*. A `FamilyMember` for a **passive `Person` with no contact detail**
    (`userId == null`, no `email` or `phone`) is authored data, not an unconsented binding. The
    system can create it directly. Consent is needed only when the target has an active account
    **or** a contact detail (see §6.2/§6.3 for the channel). `HouseholdFamily` links are always
    consent-gated. A household link always crosses to another family's admins.
- Expiry: 30 days (the same class as guest tokens). An expired request auto-transitions on read.
- Idempotent accept and decline: a second resolution of an already-resolved request is a no-op
  that returns the current state (webhook and token retry safety, the W3b pattern).

### 3.3 `HouseholdAuditEntry` (new — append-only)

```prisma
model HouseholdAuditEntry {
  id                 String   @id @default(cuid())
  householdId        String
  actorPersonId      String
  actorFamilyGroupId String
  action             String   // UPDATED | LINKED | UNLINKED | RESIDENT_ADDED | RESIDENT_REMOVED | DESTROYED
  changes            Json?    // field-level diff for UPDATED
  createdAt          DateTime @default(now())

  @@index([householdId, createdAt])
}
```

The system writes it in the same transaction as the mutation it records. Admins of all
currently-linked families can read it. It has no delete or update path (append-only). It
survives an unlink of the actor's family. The entry's `actorFamilyGroupId` is a snapshot, not a
live FK constraint on visibility.

**Amended 2026-07-15 (Steve, final PR-1 review) — §3.3/§7.1 conflict resolved in the
restrictive direction.** The PR-1 plan read this section's "readable by admins of all
currently-linked families" literally. That reading returns the *raw* `actorPersonId` and
`actorFamilyGroupId` columns to every admin viewer. On a two-link household, that hands family
A's admin family B's family id and a foreign person id. It contradicts §7 invariant 1 ("never
another family's roster, members, events, or ids"). Steve resolved the conflict for invariant
1. The audit log stays readable by admins of every currently-linked family (access does not
change). But the **response** discloses `actorPersonId` and `actorFamilyGroupId` only when the
viewer is an active member of that entry's `actorFamilyGroupId`. Otherwise it carries only the
actor's display name and family name, with the id fields absent (not `undefined`). This
endpoint had no consumer at the time of the fix, so the shape change is free.

One nuance follows from the entry as a snapshot, not a live FK (this section, above).
`actorFamilyName` can name a family that is **no longer linked** to the household at read time.
For example, an admin unlinks, then a viewer of a still-linked family reads that historical
entry later. This is accepted, not a defect. Invariant 1 permits family **names** across a
link. The audit log is a historical record of who acted, not a live capability grant.

### 3.4 Unchanged

`FamilyMember` (roles, permissions, `suspendedAt` = the suspension mechanism), `HouseholdMember`,
and `EventInvitation.householdId` do not change. CIF (`findOrCreatePersonByContact`,
`mergePersons`) stays the contact-resolution and duplicate-person path. `LinkRequest` (creation
and consent), the existing suspend and remove paths, and CIF (claim and merge) deliver Layer C
(lifecycle). The design adds no new state machine.

## 4. Migration

Prod is small (3 families, 12 persons — checked 2026-06-25). One PR applies both migrations together:

1. Migration 1: create `HouseholdFamily`, `LinkRequest`, and `HouseholdAuditEntry`. Backfill
   **exactly one** `HouseholdFamily` row per existing household from `Household.familyGroupId`
   (SQL in the migration, `linkedByPersonId` null, `linkedAt` = household `createdAt`).
2. Migration 2: drop `Household.familyGroupId` (column, FK, index).

The code switches to join-table reads in the same deploy. The deploy has no dual-read window at
this scale. A migration test asserts the backfill (every household has ≥1 link, counts match).

## 5. Authorization

A new `apps/api/src/lib/householdAccess.ts` replaces every
`activeFamilyMembership(household.familyGroupId, …)` call:

- `householdViewer(householdId, personId)` — active (non-suspended) membership in **any**
  linked family. It gates reads.
- `householdAdmin(householdId, personId)` — the same, with the admin role. It gates writes,
  link, unlink, and audit-read.

Both resolve through `HouseholdFamily` and `FamilyMember` in one query. Every household write
appends a `HouseholdAuditEntry` in the same transaction.

## 6. API surface

### 6.1 Household routes (reworked, `routes/households.ts`)

- `GET /households/:id` — viewer. The response adds `linkedFamilies: [{id?, name}]`. Family
  **names** are consented-visible across a link. The response includes the `id` **only for a
  family the viewer is an active member of** (invariant 1: no foreign family id. The only
  id-consuming operation, unlink, always targets the caller's own family). *(Amended
  2026-07-14, council round 1 — the original `{id, name}` contradicted invariant 1.)*
- `PUT /households/:id` — admin of any linked family. The system audit-logs the field diff.
  *(Amended 2026-07-14: the existing route verb is PUT with partial-update semantics. Kept.)*
- Household **creation** (`POST /families/:familyId/households`) writes the household, its
  initial `HouseholdFamily` link, and a `LINKED` audit entry in one transaction. *(Amended
  2026-07-14, council round 1 — creation is a mutation, and the system audits every mutation.)*
- `POST /households/:id/unlink` `{familyGroupId, destroy?: boolean}` — admin of **that**
  family. The last link → `409 LAST_LINK` unless `destroy: true` (deletes the household and
  `HouseholdMember` rows. The system writes a `DESTROYED` audit entry first). It replaces `DELETE`.
- `GET /households/:id/audit` — admin of any linked family.

### 6.2 Link-request routes (new, `routes/linkRequests.ts`)

- `POST /families/:familyId/link-requests` — admin of the initiating side. The body selects the kind:
  - membership pull: `targetPersonId` **or** a contact (email or phone → CIF
    `findOrCreatePersonByContact`), with optional `carryHouseholdId` (it must be linked to
    `:familyId`).
    - **Amended 2026-08-07 (Steve) — §2 decision 8:** a membership pull is needed (and this
      route is the only path) **only when the resolved target is a reachable autonomous
      party** — an active account (`userId != null`, in-app consent) or a passive record with
      a contact detail (token consent). A pull whose target resolves to a **passive `Person`
      with no contact detail** is not an autonomous party. The caller must use the direct
      data-entry attach (`POST /families/:familyId/members`). This route must reject it,
      because it cannot deliver a consent request.
  - household link: `targetHouseholdId` (pull a household in) or `targetFamilyGroupId`
    (JOIN direction: ask another family to accept this family's link to their household).
- `GET /link-requests/pending` — the consent inbox. It returns requests where the caller is a
  valid counterparty (matrix in §7).
- `POST /link-requests/:id/accept` and `POST /link-requests/:id/decline` —
  counterparty-authorized. Accept runs the transactional grant and the carry-in.
- **Passive delivery:** a target with no account gets a **single-use token link**
  (`{WEB_APP_URL}/consent/{token}` — the guest-RSVP pattern) through email or SMS on the
  existing delivery rails. The delivery honors `SmsConsent` suppression and uses the compliance
  footer and the 320-char budget through `buildBudgetedSmsBody`. The token page consent also
  verifies control of the contact. It sets `phoneVerifiedAt` or `emailVerifiedAt`, as the W3b Y
  reply does.
- A minor never receives a consent link. The system records guardian consent and never
  impersonates the minor (`consentedByPersonId` = guardian, `targetPersonId` = minor).

### 6.3 Consent counterparty matrix (§7 summary)

| Request | Counterparty who can accept or decline |
|---|---|
| PULL membership, target = active ADULT | the target person |
| PULL membership, target = TEEN/CHILD | ADULT admin of any family the minor belongs to. Family-less minor → the adult who created the `Person` record |
| PULL membership, target = passive **with a contact detail** (no account) | the contact holder through the token page (adult implied. DOB-unknown treated as adult only if the requester attests — see §11: treated as adult, and the request logs the requester attestation) |
| Attach, target = passive **with no contact detail** (no account) | **no consent — data entry.** Not a `LinkRequest`. Created directly through `POST /families/:familyId/members`. *(Amended 2026-08-07, Steve — §2 decision 8.)* |
| JOIN membership (person asks family) | any admin of the target family |
| PULL household link (family A links household H it can see through a member) | any admin of another family H is linked to |
| JOIN household link (family B asks to link H) | any admin of a family H is currently linked to |

Two-sided consent holds by construction. No initiating-side admin can self-accept. When one
person legitimately holds both authorities (admin of both sides), they can act as both
requester and counterparty. Both authorities are real.

## 7. Isolation invariants (extends the P3-00/W3a set. Each is a named test.)

1. A household link exposes **only** two things: household data (name, address, residents'
   display names, and household roles) and linked family **names**. It never exposes another
   family's roster, members, events, or ids.
2. A shared person or a shared household **never** creates cross-family event visibility by
   itself (parent-design B1). Visibility flows only through membership or accepted W3a
   participation.
3. `HOUSEHOLD`-scope invitations. **Read-side:** `eventVisibility` grants through `householdId`
   only if the viewer is an active member of the event's family. This *tightens* the current
   filter. It is the one existing query whose meaning changes. **Write-side:** invitation
   creation expands the household. An event-family member → a normal `EventInvitation`. A
   non-member resident → a W3a cross-family `EventParticipant` invitation. The system **skips a
   passive or minor non-member and surfaces a notice** in the response (no silent invite).
4. Consent tokens: single-use, 30-day expiry. Delivery honors `SmsConsent` suppression. The
   system never logs a token (it treats a token like a guest token, and logs carry request ids
   only).
5. `LinkRequest` counterparty authorization is the only acceptance path (§6.3).
6. Consent copy (SMS, email, token page) names the requesting family by name and states what
   the consent covers. It also **discloses that linked families' admins can edit shared
   household data** (parent-design R2 note). It carries no roster and no ids.

## 8. Integration touch-points (blast radius)

`routes/households.ts` (rework), `routes/events.ts` (household-invite expansion),
`lib/eventVisibility.ts` (tightened household filter), `lib/aiTools.ts`
(`GetHouseholdMembers` → `householdViewer`), `lib/personIdentity.ts`, the web onboarding
`HouseholdStep` (behavior does not change: it creates the household and the link to the
creator's family), the web family page, and a new web consent inbox and `/consent/{token}`
page. Mobile: the consent inbox and household surfaces come in the follow-on slice. The
planning step must run GitNexus impact on `activeFamilyMembership`, the `eventVisibility`
internals, and the household route handlers (blast-radius rule), on a fresh index.

## 9. Testing

- Real-DB route tests throughout (the established pattern).
- Migration backfill test (§4).
- **Isolation regression pack** that asserts §7 invariants 1–3 explicitly (the W3a leak-test style).
- Token lifecycle: single-use, expiry, suppressed-number delivery skip.
- Guardian authorization matrix: adult-self, TEEN, CHILD, family-less minor, passive contact holder.
- Idempotency: double-accept, token replay, expired-request resolution.

## 10. Delivery slicing (one spec, sequential PRs — W3a precedent)

1. **PR 1 — schema core:** migrations, backfill, `householdAccess` helpers, reworked household
   routes, audit, and the `eventVisibility` tightening. Behavior is identical for a
   single-linked household. It ships alone.
2. **PR 2 — consent flows API:** `LinkRequest`, routes, passive token delivery, guardian rules,
   and the household-invite expansion (escalation).
3. **PR 3 — web UI:** consent inbox, accept and decline, the `/consent/{token}` page, household
   linked-families and audit surfaces, and organizer skip-notices.
4. **PR 4 — mobile UI** (committed follow-on): consent inbox and household surfaces.

## 11. Resolved edge decisions

- **Passive target with unknown age:** treated as an adult **with requester attestation**. The
  request-creation UI and API need the requester to affirm that the target is an adult. The
  `LinkRequest` stores the attestation. (A minor must go through guardian consent. A passive
  record known to be a minor — DOB or tier shows it — cannot receive a token link.)
- **Unlink of the family that created the household:** allowed like any other unlink (min-1
  still enforced). The system retains the audit history (§3.3).
- **Suspended admins:** a `suspendedAt` member fails both `householdViewer` and
  `householdAdmin` (consistent with `activeFamilyMembership` today).
- **`carryHouseholdId` validity:** it must be linked to the requesting family at accept time.
  If not, the system skips the carry-in (it still grants membership) and records the skip on
  the request.

## 12. Out of scope (explicit)

- Bare-keyword ("reply Y") SMS consent for links — W1b if ever wanted. The W3b router stays untouched.
- A membership state machine or event-sourced audit (Approach 3) — rejected, YAGNI.
- Per-change consent or field-scoped household write rules — rejected for any-admin plus audit.
- Household-scoped AI features, emergency contacts, and logistics (parent-design MINOR) — for later.
- W2 entitlement interactions — none. Entitlement stays per-person and does not change with
  extra memberships (OR-coverage already handles a multi-family person).
