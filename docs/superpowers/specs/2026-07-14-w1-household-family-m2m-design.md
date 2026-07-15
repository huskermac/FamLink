# W1 — Household↔Family M2M Reframe (design spec)

| Field | Value |
|---|---|
| Date | 2026-07-14 (brainstorm converged; Steve-approved section-by-section) |
| Phase | P3-04 (W1 of the family-model reframe) |
| Parent design | `docs/FamLink_Design_Family_Model_Reframe.md` §3 (council-converged 2026-06-24; carry-ins B2-write-authority + membership-consent MAJOR resolved here) |
| Scope decision | **A+B+C** (Steve, 2026-07-14): schema reframe + consented-pull link flows + membership-lifecycle formalization, one spec, sequential PRs |
| Status | Awaiting Steve spec review → writing-plans |

## 1. Goal

Decouple `Household` from the single-family tenant boundary: `Household`↔`FamilyGroup` becomes
**many-to-many with a minimum of one link** (never tenantless), all new links and family
memberships are created through a **consented pull** flow (either side initiates, the
counterparty always consents; guardians consent for minors), and household PII writes are
**any-linked-admin + audit trail**. Cross-tenant visibility continues to flow *only* through
membership or accepted W3a event participation — never through a shared person or shared
household (parent-design invariant B1).

## 2. Locked product decisions (Steve, 2026-07-14)

1. **Scope:** whole reframe (A schema + B consent flows + C lifecycle) in one spec; implementation slices into sequential PRs (§10).
2. **Household write authority (council carry-in B2):** **any linked family's admin edits freely; every change is audit-logged** (who/when/what, visible to all linked families' admins). No per-change consent, no origin-family ownership.
3. **HOUSEHOLD-scoped event invitations under M2M:** residents who are members of the event's family get the normal invitation; **non-member residents are escalated to a W3a cross-family `EventParticipant` invitation** (accept-gated, `ForeignInvitedEventDTO` allowlist). No silent skips, no visibility leak.
4. **Guardian rule:** a minor's consent is given by **any ADULT holding the admin role in any family the minor already belongs to**; a minor in no family yet is consented for by the adult who created their `Person` record. No new guardian designation is built.
5. **Teens = minors:** only ADULT self-consents; TEEN and CHILD require guardian consent.
6. **Architecture:** **request→grant separation** (Approach 1). Pending consent lives in a new `LinkRequest` model; `FamilyMember`/`HouseholdFamily` rows are only ever created on acceptance — row existence = access, no status filters retrofitted into existing authz queries.
7. **SMS consent stays link-token-based:** the W3b keyword router is untouched; "reply Y" remains exclusively the event-RSVP verb. Bare-keyword link consent is out of scope (W1b if ever wanted).

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

- **Min-1 enforced at the app layer:** the unlink operation refuses to remove the last link
  (`409 LAST_LINK`) unless the caller passes `destroy: true`, which deletes the household and
  its `HouseholdMember` rows.
- `Household.familyGroupId` (and its index/FK) is **dropped**; all other `Household` fields stay.
- `HouseholdMember` (person↔household residency) is unchanged.

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

- Acceptance **transactionally** creates the grant row (`FamilyMember` with default non-admin
  roles, or `HouseholdFamily`) plus the carry-in household link when `carryHouseholdId` is set,
  and stamps `resolvedAt`/`consentedByPersonId`/`consentChannel`.
- `FamilyMember` and `HouseholdFamily` **never contain unconsented rows.** Existing
  authorization queries (`activeFamilyMembership`, `eventVisibility`, all P3-00 isolation
  checks) keep their semantics with zero new filters.
- Expiry: 30 days (same class as guest tokens). Expired requests auto-transition on read.
- Idempotent accept/decline: re-resolving an already-resolved request is a no-op returning the
  current state (webhook/token retry safety, the W3b pattern).

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

Written in the same transaction as the mutation it records. Readable by admins of all
currently-linked families. No delete/update path (append-only). Survives unlink of the actor's
family (the entry's `actorFamilyGroupId` is a snapshot, not a live FK constraint on visibility).

### 3.4 Unchanged

`FamilyMember` (roles, permissions, `suspendedAt` = suspension mechanism), `HouseholdMember`,
`EventInvitation.householdId`. CIF (`findOrCreatePersonByContact`, `mergePersons`) remains the
contact-resolution and duplicate-person path. Layer C (lifecycle) is delivered by
`LinkRequest` (creation/consent) + existing suspension/removal + CIF (claiming/merge) — no new
state machine.

## 4. Migration

Prod is small (3 families / 12 persons — checked 2026-06-25). One PR, applied together:

1. Migration 1: create `HouseholdFamily`, `LinkRequest`, `HouseholdAuditEntry`; backfill
   **exactly one** `HouseholdFamily` row per existing household from `Household.familyGroupId`
   (SQL in the migration, `linkedByPersonId` null, `linkedAt` = household `createdAt`).
2. Migration 2: drop `Household.familyGroupId` (column, FK, index).

Code switches to join-table reads in the same deploy; no dual-read window at this scale. A
migration test asserts the backfill (every household has ≥1 link; counts match).

## 5. Authorization

New `apps/api/src/lib/householdAccess.ts` replaces every
`activeFamilyMembership(household.familyGroupId, …)` call:

- `householdViewer(householdId, personId)` — active (non-suspended) membership in **any**
  linked family. Gates reads.
- `householdAdmin(householdId, personId)` — same, requiring the admin role. Gates
  writes/link/unlink/audit-read.

Both resolve through `HouseholdFamily` + `FamilyMember` in one query. Every household write
appends a `HouseholdAuditEntry` in the same transaction.

## 6. API surface

### 6.1 Household routes (reworked, `routes/households.ts`)

- `GET /households/:id` — viewer. Response adds `linkedFamilies: [{id, name}]` (family *names*
  are consented-visible across a link) and keeps residents.
- `PATCH /households/:id` — admin of any linked family; audit-logged field diff.
- `POST /households/:id/unlink` `{familyGroupId, destroy?: boolean}` — admin of **that**
  family. Last link → `409 LAST_LINK` unless `destroy: true` (deletes household +
  `HouseholdMember` rows; `DESTROYED` audit entry written first). Replaces `DELETE`.
- `GET /households/:id/audit` — admin of any linked family.

### 6.2 Link-request routes (new, `routes/linkRequests.ts`)

- `POST /families/:familyId/link-requests` — admin of the initiating side. Body selects kind:
  - membership pull: `targetPersonId` **or** a contact (email/phone → CIF
    `findOrCreatePersonByContact`), optional `carryHouseholdId` (must be linked to
    `:familyId`);
  - household link: `targetHouseholdId` (pull a household in) or `targetFamilyGroupId`
    (JOIN direction: ask another family to accept this family's link to their household).
- `GET /link-requests/pending` — consent inbox: requests where the caller is a valid
  counterparty (matrix in §7).
- `POST /link-requests/:id/accept` / `POST /link-requests/:id/decline` —
  counterparty-authorized; accept runs the transactional grant + carry-in.
- **Passive delivery:** target with no account gets a **single-use token link**
  (`{WEB_APP_URL}/consent/{token}` — guest-RSVP pattern) via email/SMS through the existing
  delivery rails: `SmsConsent` suppression honored, compliance footer + 320-char budget via
  `buildBudgetedSmsBody`. Confirming on the token page consents **and** verifies control of
  the contact (sets `phoneVerifiedAt`/`emailVerifiedAt`, as W3b's Y does).
- Minors never receive consent links; guardian consent is recorded, not impersonated
  (`consentedByPersonId` = guardian, `targetPersonId` = minor).

### 6.3 Consent counterparty matrix (§7 summary)

| Request | Counterparty who may accept/decline |
|---|---|
| PULL membership, target = active ADULT | the target person |
| PULL membership, target = TEEN/CHILD | ADULT admin of any family the minor belongs to; family-less minor → the adult who created the `Person` record |
| PULL membership, target = passive (no account) | the contact holder via token page (adult implied; DOB-unknown treated as adult only if the requester attests — see §11 open item resolution: treated as adult, requester attestation logged in the request) |
| JOIN membership (person asks family) | any admin of the target family |
| PULL household link (family A links household H it can see via a member) | any admin of another family H is linked to |
| JOIN household link (family B asks to link H) | any admin of a family H is currently linked to |

Two-sided consent holds by construction: no initiating-side admin can self-accept. When one
person legitimately holds both authorities (admin of both sides), they may act as both
requester and counterparty — both authorities are real.

## 7. Isolation invariants (extends P3-00/W3a set; each is a named test)

1. A household link exposes **only**: household data (name, address, residents' display names
   + household roles) and linked family **names** — never another family's roster, members,
   events, or ids.
2. A shared person or shared household **never** creates cross-family event visibility by
   itself (parent-design B1). Visibility flows exclusively through membership or accepted W3a
   participation.
3. `HOUSEHOLD`-scope invitations: **read-side**, `eventVisibility` grants via `householdId`
   only if the viewer is an active member of the event's family (a *tightening* of the
   current filter — the one existing query whose semantics change). **Write-side**, invitation
   creation expands the household: event-family members → normal `EventInvitation`;
   non-member residents → W3a cross-family `EventParticipant` invitation; passive/minor
   non-members are **skipped with a surfaced notice** in the response (no silent invites).
4. Consent tokens: single-use, 30-day expiry, delivery honors `SmsConsent` suppression, never
   logged (token treated like guest tokens; logs carry request ids only).
5. `LinkRequest` counterparty authorization is the only acceptance path (§6.3).
6. Consent copy (SMS/email/token page) names the requesting family by name and what is being
   consented to — and **discloses that linked families' admins can edit shared household
   data** (parent-design R2 note) — but carries no roster or ids.

## 8. Integration touch-points (blast radius)

`routes/households.ts` (rework), `routes/events.ts` (household-invite expansion),
`lib/eventVisibility.ts` (tightened household filter), `lib/aiTools.ts`
(`GetHouseholdMembers` → `householdViewer`), `lib/personIdentity.ts`, web onboarding
`HouseholdStep` (behavior unchanged: creates household + link to creator's family), web family
page, new web consent inbox + `/consent/{token}` page. Mobile: consent inbox + household
surfaces in the follow-on slice. Planning must run GitNexus impact on
`activeFamilyMembership`, `eventVisibility` internals, and the household route handlers
(blast-radius rule), on a fresh index.

## 9. Testing

- Real-DB route tests throughout (established pattern).
- Migration backfill test (§4).
- **Isolation regression pack** asserting §7 invariants 1–3 explicitly (W3a leak-test style).
- Token lifecycle: single-use, expiry, suppressed-number delivery skip.
- Guardian authorization matrix: adult-self / TEEN / CHILD / family-less minor / passive
  contact holder.
- Idempotency: double-accept, token replay, expired-request resolution.

## 10. Delivery slicing (one spec, sequential PRs — W3a precedent)

1. **PR 1 — schema core:** migrations + backfill + `householdAccess` helpers + reworked
   household routes + audit + `eventVisibility` tightening. Behavior identical for
   single-linked households; ships alone.
2. **PR 2 — consent flows API:** `LinkRequest` + routes + passive token delivery + guardian
   rules + household-invite expansion (escalation).
3. **PR 3 — web UI:** consent inbox, accept/decline, `/consent/{token}` page, household
   linked-families + audit surfaces, organizer skip-notices.
4. **PR 4 — mobile UI** (committed follow-on): consent inbox + household surfaces.

## 11. Resolved edge decisions

- **Passive target with unknown age:** treated as adult **with requester attestation** — the
  request creation UI/API requires the requester to affirm the target is an adult; the
  attestation is stored on the `LinkRequest`. (Minors must go through guardian consent; a
  passive record known to be a minor — DOB or tier says so — cannot receive a token link.)
- **Unlink of the family that created the household:** allowed like any other unlink (min-1
  still enforced); audit history is retained (§3.3).
- **Suspended admins:** `suspendedAt` members fail both `householdViewer` and
  `householdAdmin` (consistent with `activeFamilyMembership` today).
- **`carryHouseholdId` validity:** must be linked to the requesting family at accept time, or
  the carry-in is skipped (membership still granted) with the skip recorded on the request.

## 12. Out of scope (explicit)

- Bare-keyword ("reply Y") SMS consent for links — W1b if ever wanted; W3b router untouched.
- Membership state machine / event-sourced audit (Approach 3) — rejected YAGNI.
- Per-change consent or field-scoped household write rules — rejected in favor of
  any-admin + audit.
- Household-scoped AI features, emergency contacts, logistics (parent-design MINOR) — later.
- W2 entitlement interactions — none; entitlement stays per-person, unaffected by extra
  memberships (OR-coverage already handles multi-family persons).
