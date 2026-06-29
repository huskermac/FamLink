# FamLink - Current State (shared, cross-tool)

**Canonical resume point for any agent (Claude Code, Codex, etc.).** Read this first. Process rules live in `docs/FamLink_Agent_Rules.md`. If this doc conflicts with the live code, trust the code and update this doc.

| Field | Value |
|---|---|
| Last updated | 2026-06-29 |
| Branch | `main` |
| Checkpoint | CIF Plan A production migration/backfill complete; CIF Plan B (merge engine) merged to `main` via PR #5 |
| Local verification | PASS: CI on `main` HEAD `e41a6cc` (lint/typecheck, tests, build); production Prisma deploy reported no pending migrations; Clerk contact backfill applied cleanly |

---

## Current Phase / Status

**Phase 3 - Family-Model Reframe (P3-02 / P3-03), IN PROGRESS.** Design council-converged (`docs/FamLink_Design_Family_Model_Reframe.md`). The reframe replaces the older P3 ideas (Image Pipeline, Group Chat, Layer-3 AI) which are re-sequenced behind it.

**Shipped and merged:**
- **W2** - per-person AI entitlement (P3-02, PR #1).
- **W2b** - entitlement surfacing + foreign-context AI throttle + mobile upsell (P3-02, PR #2).
- **W3a-API** - cross-family event participation backend (P3-03, PR #3): `EventParticipant` grant + roles, `resolveEventAccess`, cross-family invite/accept/decline/revoke/role, participant RSVP + per-item task contributions, `ForeignInvitedEventDTO`, participant-scoped notifications.
- **Contact Identity Foundation - Plan A (backbone)** (P3-03, PR #4, merge `f45f11c`; prod completed 2026-06-29): contact normalization helpers, additive `Person` normalized/verified contact columns, verified-only partial unique indexes, canonical `findOrCreatePersonByContact`, Clerk webhook normalized+verified email writes, guest invite resolver routing through canonical contact identity, and one-time Clerk verified-contact backfill. Spec: `docs/superpowers/specs/2026-06-25-contact-identity-foundation-design.md`; plan: `docs/superpowers/plans/2026-06-25-contact-identity-foundation-a-backbone.md`.
- **Contact Identity Foundation - Plan B (merge engine)** (P3-03, PR #5, merge `a034137`): transactional `mergePersons` (re-points every Person-referencing column incl. logical no-FK columns, compound-unique dedupe, delete; refuses to delete an account; idempotent), dependent-safety gate + full-name corroboration (`selectMergeableContactPerson`/`nameCorroborates`), and a retry-safe Clerk `user.created` post-upsert consolidation that merges a safe contact-only guest into the new account (guest invitation/RSVP history reconciles via `linkedPersonId`). Logs-only observability, no new table. Council-validated (Codex, 2 rounds) + final opus review READY TO MERGE. Spec: `docs/superpowers/specs/2026-06-26-cif-plan-b-merge-engine-design.md`; plan: `docs/superpowers/plans/2026-06-26-cif-plan-b-merge-engine.md`.

**Designed/planned but not executed:**
- **W3a-UI-web** - spec `docs/superpowers/specs/2026-06-25-w3a-ui-web-cross-family-participation-design.md` (was deferred behind the identity foundation, which is now complete — this is next).

## Reordered Roadmap (Canonical)

1. ~~Merge or PR **Contact Identity Foundation Plan A**~~ - **DONE** (PR #4 merged `f45f11c`).
2. ~~Write and execute **Contact Identity Foundation Plan B (merge engine)**~~ - **DONE** (PR #5 merged `a034137`).
3. **W3a-UI-web**. *(next)*
4. **W3a-UI-mobile**.
5. Rest of **W3b** - passive SMS onboarding (inbound Twilio webhook, "reply Y", STOP/opt-out, phone verification).
6. **W4** - Pro Organizer beta (non-family event admin + B2B billing).
7. **W1** - Household to Family M2M reframe (migration-heavy).

## Work Completed Since Last Shared-State Update

2026-06-26 CIF Plan B (merge engine) **merged to `main`** via PR #5 (merge `a034137`); feature branch `p3-03-cif-plan-b-merge-engine` deleted (local + remote). Built via brainstorm -> spec -> plan -> council (Codex, 2 rounds; caught `EventPhoto.uploadedById` not `personId` + missed `AssistantMessage.personId`) -> subagent-driven execution (3 tasks) -> final opus whole-branch review (READY TO MERGE). Plan B commits `366ac4a` (mergePersons), `4dc1c98` (selection + corroboration), `5e25395` (guarded-adult test), `6e3b8b0` (webhook consolidation), `ac20560` (review follow-ups). Verified: branch API suite 403/403 (39 files), main baseline 381/381, tsc/lint clean.

2026-06-29 CIF Plan A production item **completed** from `main` HEAD `e41a6cc`. Pushed adapter metadata cleanup (`e41a6cc`), CI run 28372051672 passed (lint/typecheck, test, build), production Prisma deploy via Railway reported `No pending migrations to apply` against Railway PostgreSQL, and `backfillClerkContacts.ts --apply` updated 1 Person with 0 errors. Post-apply dry run reported `alreadyCurrent: 1`, `wouldUpdate: 0`, `errors: 0`.

2026-06-26 CIF Plan A **merged to `main`** via PR #4 (merge `f45f11c`); feature branch `codex/p3-03-cif-plan-a` deleted (local + remote). Plan A commits:
- `599fd6a` - contact normalization helper (`normalizeEmail`, `normalizePhone`) with tests.
- `1858792` - additive `Person` normalized/verified contact fields plus migration with verified-only partial unique indexes.
- `13f3feb` - canonical `findOrCreatePersonByContact` resolver with verified-match preference.
- `d8075ed` - Clerk webhook writes `emailNormalized` and `emailVerifiedAt`.
- `43160a0` - guest event invites route through canonical resolver.
- `a6ed399` - one-time Clerk verified-contact backfill script (`apps/api/src/scripts/backfillClerkContacts.ts`, dry-run by default; use `--apply` to write).

Earlier 2026-06-24/25 stream:
- W2b shipped -> **PR #2 merged**; W3a-API shipped -> **PR #3 merged** (final review fixed a roster-leak C1 + item-write leak I1, commit `372d98f`).
- Repo cleanup (`bb3bb7e`..`4c0819d`): deleted merged branches (local + remote); removed a stray committed worktree gitlink; gitignored `.claude/worktrees/`; untracked and gitignored `.claude/settings.local.json`.
- Wrote/committed: W3a-UI-web spec (`fad140f`), Contact Identity Foundation spec (`a716488`), CIF Plan A (`715b44c`), CLAUDE.md phase update (`33d950c`).
- CI fix (`9821542`): removed an unused `nonMember` var in `events.test.ts`; CI then green on `main`.
- Prod data check (Railway): 12 persons / 3 families / 0 contact collisions / 0 emails on `Person` (emails live in Clerk). The identity migration is additive, no wipe.

## Important Commits / PRs

- CIF Plan B commits (now on `main` via PR #5): `366ac4a`, `4dc1c98`, `5e25395`, `6e3b8b0`, `ac20560`; merge `a034137`.
- CIF Plan A commits (on `main` via PR #4): `599fd6a`, `1858792`, `13f3feb`, `d8075ed`, `43160a0`, `a6ed399`; merge `f45f11c`.
- PR #1 (W2), PR #2 (W2b), PR #3 (W3a-API), PR #4 (CIF Plan A), PR #5 (CIF Plan B) - all merged to `main`.
- Recent `main`: `a034137` (PR #5 merge), `81553d4` (Plan A checkpoint), `f45f11c` (PR #4 merge), `9821542` (CI fix).

## Verification Baseline

- **CIF Plan B (2026-06-26, branch `p3-03-cif-plan-b-merge-engine`, now merged):** full API suite **403/403** (39 files); `main` pre-merge baseline 381/381; `tsc --noEmit` clean; `npm run lint` 0 errors (pre-existing warnings only). Additive — no schema migration. (Note: an implementer reported transient "33 pre-existing failures" that did NOT reproduce on a clean run — flake, not a regression.)
- **CI green at `main` HEAD `9821542`** - `lint-and-typecheck`, `test`, and `build` all passed in run 28183812961.
- CIF Plan A local verification on `codex/p3-03-cif-plan-a` (2026-06-26):
  - `npm.cmd test --workspace=@famlink/api` - PASS, 38 files / 381 tests.
  - `npm.cmd run type-check` - PASS across workspace.
  - `npm.cmd run lint` - PASS across workspace with existing warnings only.
  - `git diff --check` - PASS.
  - `mcp__gitnexus.detect_changes` vs `main` - medium branch diff risk; affected flows limited to new backfill-script chains.
- Earlier local baseline: API 368/368, web 112/112, mobile suite pass; `tsc --noEmit` clean across api/web/mobile.
- **Known non-blocking:** 34 eslint warnings in `apps/api` (mostly `@typescript-eslint/no-explicit-any` in test mocks plus stale `eslint-disable` directives); warnings do not fail CI.
- **Process note:** keep `npm run lint` in per-task/final verification loops.

## Next Recommended / Authorized Step

**W3a-UI-web** - the Contact Identity Foundation (Plans A + B) is now complete, merged, and production-applied, so the web UI for cross-family participation can build on durable identity. Spec exists (`docs/superpowers/specs/2026-06-25-w3a-ui-web-cross-family-participation-design.md`); needs an implementation plan (brainstorm/refresh -> writing-plans) before code.

## Open Blockers / Questions Needing Steve

1. W3a-UI-web spec section 8 UI choices defaulted (per-suggestion admin toggle; elevation notice copy; decline UX). Confirm or change later; no hard blocker.

## Deferred Items (and Why)

- **W3a-UI-mobile** - after W3a-UI-web (web first). (Contact Identity Foundation is now done, so this sequencing constraint is satisfied.)
- **Rest of W3b (passive SMS onboarding)** - needs inbound SMS infra plus TCPA/STOP compliance; sequenced after UI.
- **W4 (Pro Organizer), W1 (Household reframe)** - later in the reframe sequence; W1 is migration-heavy.
- **eslint warning cleanup (34)** - non-blocking; do in a sweep later.
- **Secrets manager (Infisical)** - future infra hygiene; do cheap tool-agnostic hardening first (restricted Stripe keys, rotation runbook).
- **Naming** - "KinScape"/"FamScape" taken, "FamLink" contested (Google Family Link); parked pending real USPTO/domain clearance before marketing.

## GitNexus Freshness

Up-to-date. `npx gitnexus analyze` ran 2026-06-29 on `main` HEAD `71a87c8`: 3,082 nodes / 4,255 edges / 99 clusters / 89 flows. Index at HEAD, 0 commits behind.
