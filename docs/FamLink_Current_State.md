# FamLink - Current State (shared, cross-tool)

**Canonical resume point for any agent (Claude Code, Codex, etc.).** Read this first. Process rules live in `docs/FamLink_Agent_Rules.md`. If this doc conflicts with the live code, trust the code and update this doc.

| Field | Value |
|---|---|
| Last updated | 2026-06-30 |
| Branch | `p3-03-w3a-ui-web` (off `main`; 11 commits `db0f2c7`..`07510ae`; **READY TO MERGE**, awaiting Steve's merge/PR decision) |
| Checkpoint | **W3a-UI-web implemented** (cross-family participation web UI + day-1 guest delivery). Built via brainstorm → spec (council-vetted) → plan (2 council rounds) → subagent-driven dev (10 tasks, per-task spec+quality review) → whole-branch opus review (READY TO MERGE, no Critical/Important). |
| Local verification | PASS: full API suite **415/415** (40 files), full web suite **125/125** (24 files), repo-root `type-check` clean, `lint` 0 errors (34 pre-existing warnings), `git diff --check` clean |

---

## Current Phase / Status

**Phase 3 - Family-Model Reframe (P3-02 / P3-03), IN PROGRESS.** Design council-converged (`docs/FamLink_Design_Family_Model_Reframe.md`). The reframe replaces the older P3 ideas (Image Pipeline, Group Chat, Layer-3 AI) which are re-sequenced behind it.

**Shipped and merged:**
- **W2** - per-person AI entitlement (P3-02, PR #1).
- **W2b** - entitlement surfacing + foreign-context AI throttle + mobile upsell (P3-02, PR #2).
- **W3a-API** - cross-family event participation backend (P3-03, PR #3): `EventParticipant` grant + roles, `resolveEventAccess`, cross-family invite/accept/decline/revoke/role, participant RSVP + per-item task contributions, `ForeignInvitedEventDTO`, participant-scoped notifications.
- **Contact Identity Foundation - Plan A (backbone)** (P3-03, PR #4, merge `f45f11c`; prod completed 2026-06-29): contact normalization helpers, additive `Person` normalized/verified contact columns, verified-only partial unique indexes, canonical `findOrCreatePersonByContact`, Clerk webhook normalized+verified email writes, guest invite resolver routing through canonical contact identity, and one-time Clerk verified-contact backfill. Spec: `docs/superpowers/specs/2026-06-25-contact-identity-foundation-design.md`; plan: `docs/superpowers/plans/2026-06-25-contact-identity-foundation-a-backbone.md`.
- **Contact Identity Foundation - Plan B (merge engine)** (P3-03, PR #5, merge `a034137`): transactional `mergePersons` (re-points every Person-referencing column incl. logical no-FK columns, compound-unique dedupe, delete; refuses to delete an account; idempotent), dependent-safety gate + full-name corroboration (`selectMergeableContactPerson`/`nameCorroborates`), and a retry-safe Clerk `user.created` post-upsert consolidation that merges a safe contact-only guest into the new account (guest invitation/RSVP history reconciles via `linkedPersonId`). Logs-only observability, no new table. Council-validated (Codex, 2 rounds) + final opus review READY TO MERGE. Spec: `docs/superpowers/specs/2026-06-26-cif-plan-b-merge-engine-design.md`; plan: `docs/superpowers/plans/2026-06-26-cif-plan-b-merge-engine.md`.

- **W3a-UI-web** - cross-family event participation web UI (P3-03, branch `p3-03-w3a-ui-web`, READY TO MERGE): **day-1 guest invitation delivery** (direct email/SMS of the `/rsvp/{token}` link, isolation-safe copy), **participant revival** (accept widened to {PENDING,DECLINED}, never ACCEPTED — admin revoke stays authoritative), identity-bound `GET /events/participation/preview`, owning-member-only `GET /:eventId/participants`, `isOwn` flag on foreign items, and web surfaces: invite-page cross-family roles (admin-gated), `/events/accept` page (state matrix), foreign-DTO participant viewer (add + delete-own tasks), and owning-member participant management. Spec: `docs/superpowers/specs/2026-06-25-w3a-ui-web-cross-family-participation-design.md`; plan: `docs/superpowers/plans/2026-06-30-w3a-ui-web-cross-family-participation.md`.

## Reordered Roadmap (Canonical)

1. ~~Merge or PR **Contact Identity Foundation Plan A**~~ - **DONE** (PR #4 merged `f45f11c`).
2. ~~Write and execute **Contact Identity Foundation Plan B (merge engine)**~~ - **DONE** (PR #5 merged `a034137`).
3. ~~**W3a-UI-web**~~ - **DONE, READY TO MERGE** (branch `p3-03-w3a-ui-web`, 11 commits, whole-branch review clean; awaiting merge/PR).
4. **W3a-UI-mobile**. *(next)*
5. Rest of **W3b** - passive SMS onboarding (inbound Twilio webhook, "reply Y", STOP/opt-out, phone verification).
6. **W4** - Pro Organizer beta (non-family event admin + B2B billing).
7. **W1** - Household to Family M2M reframe (migration-heavy).

## Work Completed Since Last Shared-State Update

2026-06-30 **W3a-UI-web built** on branch `p3-03-w3a-ui-web` (11 commits `db0f2c7`..`07510ae`), READY TO MERGE. Flow: brainstorm → spec refresh + Codex council (no BLOCKERs) → plan + 2 Codex council rounds (round 2 clean) → subagent-driven execution (10 TDD tasks, fresh implementer + spec/quality reviewer each) → whole-branch opus review (READY TO MERGE, no Critical/Important). Commits: `db0f2c7` guest delivery, `aefc391` accept-revival, `78f1669` preview endpoint, `2c08405` participants list (owning-member-only), `f7c71af` foreign-item `isOwn`, `4aba71d` web client, `1b23ae2` invite-page roles, `d60ef99` accept page, `765e2bd` accept-deps comment fix, `38b49b3` foreign viewer, `07510ae` participant mgmt. A controller re-boundary moved the `InviteeEntry`/`getEventDetails` breaking type changes into their consumer tasks (7/9) to keep the workspace type-checking at every step. Pending Steve: prod has no new migration (additive only — `isOwn` is computed, no schema change); ensure `RESEND_*`/`TWILIO_*`/`WEB_APP_URL` env vars are set in prod for guest delivery to actually send.

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

- **W3a-UI-web (2026-06-30, branch `p3-03-w3a-ui-web`):** full API suite **415/415** (40 files), full web suite **125/125** (24 files), repo-root `type-check` clean, repo-root `lint` 0 errors (34 pre-existing warnings), `git diff --check` clean. Additive only — no Prisma migration. Whole-branch opus review READY TO MERGE; all isolation invariants verified in code (foreign DTO carries no person ids; `/participants` owning-member-only; preview identity-bound + family-blind; guest copy structurally safe; revival never overrides revoke; `/events/accept` auth-gated).
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

**Merge `p3-03-w3a-ui-web`** (Steve's decision: local merge vs PR), then **W3a-UI-mobile** - port the cross-family participation surfaces to the mobile client (accept link → in-app accept, foreign-event viewer, participant RSVP/tasks). The W3a-API + web client + isolation patterns are now the reference. W3a-UI-web spec/plan: `docs/superpowers/specs/2026-06-25-w3a-ui-web-cross-family-participation-design.md` / `docs/superpowers/plans/2026-06-30-w3a-ui-web-cross-family-participation.md`.

## Open Blockers / Questions Needing Steve

1. W3a-UI-web spec section 8 UI choices defaulted (per-suggestion admin toggle; elevation notice copy; decline UX). Confirm or change later; no hard blocker.

## Deferred Items (and Why)

- **W3a-UI-web follow-ups (non-blocking, from final review):** (1) **edit-own** task contribution in the foreign viewer (Steve-approved defer; add/delete-own shipped); (2) `ForeignEventDetail` RSVP button can't reflect the viewer's existing RSVP — the foreign DTO doesn't expose self-RSVP (small DTO addition would fix); (3) edit page renders a perpetual loading skeleton if a foreign DTO loads it (unreachable in practice — no link, API rejects; render an "unavailable" state); (4) phone-channel guest delivery lacks a route-level test (per-channel logic is unit-covered); (5) invite suggestion row lost whole-row click-to-toggle (`<label>`→`<div>`; only the checkbox toggles); (6) preview makes 2 sequential DB lookups (could `Promise.all`).
- **Repo hygiene (pre-existing, discovered during W3a-UI-web):** `apps/web/src/app/` and `apps/web/src/components/` are **stale duplicate trees** — the live tree is `apps/web/app/` + `apps/web/components/`. `vitest.config.ts` `include` was incrementally widened (lib, app, components) to discover tests in the live tree. Worth a cleanup pass to delete the stale `src/` trees.
- **W3a-UI-mobile** - after W3a-UI-web (web first). (Contact Identity Foundation is now done, so this sequencing constraint is satisfied.)
- **Rest of W3b (passive SMS onboarding)** - needs inbound SMS infra plus TCPA/STOP compliance; sequenced after UI.
- **W4 (Pro Organizer), W1 (Household reframe)** - later in the reframe sequence; W1 is migration-heavy.
- **eslint warning cleanup (34)** - non-blocking; do in a sweep later.
- **Secrets manager (Infisical)** - future infra hygiene; do cheap tool-agnostic hardening first (restricted Stripe keys, rotation runbook).
- **Naming** - "KinScape"/"FamScape" taken, "FamLink" contested (Google Family Link); parked pending real USPTO/domain clearance before marketing.

## GitNexus Freshness

Re-analyzed at the end of the 2026-06-30 W3a-UI-web session (branch `p3-03-w3a-ui-web` HEAD `07510ae`) so the next session resumes against a fresh graph.

Prior note — up-to-date after the 2026-06-29 CIF Plan A production checkpoint. `npx gitnexus analyze` ran after the checkpoint commits: 3,081-3,082 doc-sensitive nodes / 4,255 edges / 98-99 clusters / 89 flows. The one-node variance came from generated adapter metadata text only; execution-flow coverage is unchanged.
