# Contact Identity Foundation — Plan B (Merge Engine) — Design

| Field | Value |
|---|---|
| Status | **DRAFT — for Steve review → writing-plans.** |
| Created | 2026-06-26 |
| Phase tag | P3-03 |
| Parent spec | `docs/superpowers/specs/2026-06-25-contact-identity-foundation-design.md` (§6 claim/merge, §7 mergePersons) |
| Builds on | Plan A (merged, PR #4): normalization, verified-only uniqueness, `findOrCreatePersonByContact`, Clerk webhook normalized+verified email, one-time backfill |
| Branch | `p3-03-cif-plan-b-merge-engine` |

> Adds the merge/claim/reconcile layer on top of Plan A's identity backbone, so a guest who later signs up becomes **one** `Person` — **without ever fusing two real humans.** Decisions from the 2026-06-26 brainstorm are recorded inline.

---

## 0. Why

Plan A made contact identity normalized, verified-unique, and resolver-routed, but deliberately left **no merge logic**: a guest invited as a contact-only `Person` (`userId: null`) who later creates an account becomes a **second** `Person`, and nothing fuses the two. Plan B closes that gap. The hard constraint is safety: under Plan A's *verified-only* uniqueness, a guardian's email is allowed to sit on a child's **unverified** contact, so naive "merge by email" can silently fuse a child into a parent. Plan B must merge the real duplicates and refuse the dangerous ones.

## 1. Scope

**In:** (1) `mergePersons(canonicalId, duplicateId)` — transactional FK re-point + compound-unique dedupe + delete; (2) webhook **post-upsert merge** path on `user.created` with a dependent-safety gate; (3) guest reconcile (handled implicitly by 1+2); (4) structured-log observability; (5) tests.

**Out (YAGNI / later):** any in-app merge review/undo UI; a `PersonMergeLog` DB table (logs only — decided 2026-06-26); a separate lazy guest-reconcile pass (subsumed by the signup-time merge); phone-based merge (phone verification is W3b — column stays null); `user.updated` consolidation (signup-time concern).

## 2. Decisions (2026-06-26, Steve)

1. **Dependent-safety gate (the central decision):** never auto-claim/merge a candidate that looks like a dependent — `ageGateLevel != "ADULT"` **or** `guardianPersonId != null`. The verified email belongs to the guardian, not the child. Resolver-created guests default to `ADULT`/no-guardian, so they are not falsely blocked; the gate specifically protects real child/dependent records carrying a guardian's email.
2. **Cautious auto-merge + flag** for everyone else: auto-merge only on a **single** contact-only match **with name corroboration**; any ambiguity (multiple matches, or name mismatch) → leave the account `Person` as the upsert created it and emit a `needs-review` structured log. Never guess.
3. **Account is always canonical.** Merges only ever fuse a contact-only `Person` into an account `Person`. **Account↔account merges are refused** (throw + log) — never silently drop an account.
4. **Observability = structured logs only.** One audit line per merge, one `needs-review` line per ambiguous claim. No new table, no UI.
5. **Deterministic compound-unique collision rule:** on a row that would violate a compound unique after re-pointing, keep canonical's existing row, drop the duplicate's, log it.

## 3. `mergePersons(canonicalId, duplicateId): Promise<void>` (`lib/personIdentity.ts`, extend)

One Prisma transaction:

1. **Guards (pre-flight):**
   - `canonicalId === duplicateId` → no-op return.
   - Load both; if either missing → throw.
   - If **both** have `userId` (account↔account) → throw + log `refused account-account merge`. Never proceed.
2. **Re-point every Person-referencing FK** from duplicate → canonical. Authoritative set, enumerated from `schema.prisma`:
   - Self-ref: `Person.guardianPersonId` (duplicate's wards → canonical), and if duplicate itself has a guardian, leave canonical's own guardian untouched. **Guard:** never set canonical's guardian to canonical (self-guardian).
   - `FamilyMember.personId` *(compound unique `[familyGroupId, personId]`)*
   - `HouseholdMember.personId` *(compound unique `[householdId, personId]`)*
   - `NotificationPreference.personId` *(compound unique `[personId, channel, notifType]`)*
   - `Relationship.fromPersonId`, `Relationship.toPersonId` *(compound unique `[fromPersonId, toPersonId, familyGroupId, type]`; also guard a relationship from becoming self-referential canonical→canonical)*
   - `FamilyGroup.createdById`
   - `Event.createdByPersonId`, `Event.birthdayPersonId`
   - `EventInvitation.personId`, `EventInvitation.linkedPersonId`
   - `RSVP.personId` *(compound unique `[eventId, personId]`)*
   - `EventParticipant.personId` *(compound unique `[eventId, personId]`)*
   - `EventItem.createdByPersonId`, `EventItem.assignedToPersonId`
   - `EventPhoto.personId`
3. **Compound-unique dedupe:** for each compound-unique table above, before/within re-pointing, detect rows where canonical already holds the conflicting key; for those, **keep canonical's row, delete duplicate's**, and log a one-line collision note. Self-referential `Relationship`/guardian rows that would become canonical↔canonical are dropped.
4. **Delete the duplicate** `Person`.
5. **Audit log:** emit one structured line: `{ event: "person_merge", canonicalId, duplicateId, trigger, repointed: {<table>: n, …}, collisionsDropped: n }`.

**Verification idea (test-only):** the FK list is covered by a test asserting that, after a merge, the duplicate id appears in **zero** rows across every listed table (a guard against the enumeration drifting from the schema).

## 4. Webhook post-upsert merge path (`routes/webhooks.ts`, extend)

On `user.created`, **after** the existing Plan A `db.person.upsert` (which creates/updates the account `Person`, `P_acct`, with `emailNormalized` + `emailVerifiedAt = now`), run a post-upsert consolidation:

```
emailNormalized = normalizeEmail(primaryEmail)
if emailNormalized and P_acct was newly created:
  candidates = persons where emailNormalized matches AND userId is null AND id != P_acct.id
  # dependent-safety gate
  mergeable = candidates where ageGateLevel == "ADULT" AND guardianPersonId is null
  if exactly one mergeable AND name corroborates(P_acct):
      mergePersons(canonical = P_acct, duplicate = mergeable[0])   # fuses guest history into the account
  else if candidates non-empty:
      log needs-review { reason: "ambiguous" | "name-mismatch" | "dependent-only", count }
      # leave P_acct + contact-only persons as-is; never guess
```

- **Why post-upsert (not claim-first):** P_acct (verified) and the contact-only match (unverified, same `emailNormalized`) coexist legally under the *verified-only* partial unique index, so there is no insert collision; Plan A's webhook is unchanged; and `mergePersons` (§3) is the single mechanism — fully exercised and tested, not bypassed by an in-place `userId` mutation. Outcome is identical: one `Person` owning the account + the guest's invitation/RSVP history.
- **Dependent gate** filters candidates *before* the single-match test, so a child carrying the guardian's email is never the thing that gets merged (and never makes the count "ambiguous" against a real adult guest).
- **Name corroboration:** last-name match (case-insensitive, normalized) OR full-name match against the Clerk-provided first/last. Conservative — a bare email match with a different surname is *not* corroborated → `needs-review`.
- **Account↔account is impossible here** by construction (candidates require `userId: null`), so §2.3's refusal is a defense-in-depth guard inside `mergePersons`, not a path this caller can hit.
- `user.updated` is unchanged (Plan A behavior). Consolidation is signup-only.
- svix signature verification unchanged.

## 5. Guest reconcile

No separate code path. Plan A's resolver already stamps `EventInvitation.linkedPersonId` (and the contact-only `Person`) for guests; when that `Person` is merged into the account `Person` in §4, its invitation + RSVP rows re-point automatically. Reconcile is therefore **eager and free**. (A standalone lazy pass was considered and dropped — YAGNI.)

## 6. Isolation / safety

- Merge is transactional and FK-complete: no dangling references; if any step throws, the whole merge rolls back.
- The dependent-safety gate (§2.1) is the primary guard against fusing a child into a guardian.
- Account↔account is structurally refused (§2.3).
- No cross-`FamilyGroup` leakage is introduced: merge only consolidates rows already attached to the two `Person`s; it never moves a row across a family boundary it didn't already belong to. Compound-unique dedupe only ever *deletes* duplicate rows, never reassigns family/household ownership.

## 7. Testing

- **`mergePersons` (DB integration):** re-points each FK type (parametrized over the full table list); dedupes each compound-unique (FamilyMember, HouseholdMember, NotificationPreference, Relationship, RSVP, EventParticipant) by keeping canonical + dropping duplicate; deletes the duplicate; **post-merge duplicate-id-appears-nowhere** assertion across all tables; `canonical===duplicate` no-op; **account↔account refused** (throws, both survive); self-guardian / self-relationship guards.
- **Merge path (webhook, supertest):** single corroborated contact-only match → merged into the account Person (one Person, has `userId`, invitation/RSVP history preserved); **dependent (child w/ `guardianPersonId` or non-ADULT) carrying the email → NOT merged, account Person stands alone, needs-review logged**; multiple adult matches → needs-review, no merge; name mismatch → needs-review, no merge; a pre-existing account Person with the email (no contact-only candidate) → no merge attempted.
- **Reconcile:** a guest with an invitation + RSVP, then signs up → ends as one Person owning that invitation + RSVP.

## 8. Out of scope (restated)

`PersonMergeLog` table + review/undo UI; lazy reconcile pass; phone claim/merge (W3b); `user.updated` claim; W3a-UI surfaces (consume the resolver + verified flag, next cycle).

## 9. Open questions

None outstanding — the three brainstorm decisions (dependent gate, logs-only, claim-first) resolved the spec's prior open items (§12.1 backfill done in Plan A; §12.2 reconcile timing → eager via claim-first; §12.3 default country `US`, unchanged).
