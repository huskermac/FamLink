# FamLink - Current State (shared, cross-tool)

**Canonical resume point for any agent (Claude Code, Codex, etc.).** Read this first. Process rules live in `docs/FamLink_Agent_Rules.md`. If this doc conflicts with the live code, trust the code and update this doc.

| Field | Value |
|---|---|
| Last updated | 2026-06-26 |
| Branch | `codex/p3-03-cif-plan-a` |
| Checkpoint | CIF Plan A implementation through `a6ed399`; shared-state checkpoint committed after implementation |
| Local verification | PASS: API tests, root type-check, root lint, `git diff --check` |

---

## Current Phase / Status

**Phase 3 - Family-Model Reframe (P3-02 / P3-03), IN PROGRESS.** Design council-converged (`docs/FamLink_Design_Family_Model_Reframe.md`). The reframe replaces the older P3 ideas (Image Pipeline, Group Chat, Layer-3 AI) which are re-sequenced behind it.

**Shipped and merged:**
- **W2** - per-person AI entitlement (P3-02, PR #1).
- **W2b** - entitlement surfacing + foreign-context AI throttle + mobile upsell (P3-02, PR #2).
- **W3a-API** - cross-family event participation backend (P3-03, PR #3): `EventParticipant` grant + roles, `resolveEventAccess`, cross-family invite/accept/decline/revoke/role, participant RSVP + per-item task contributions, `ForeignInvitedEventDTO`, participant-scoped notifications.

**Implemented on active branch, not merged yet:**
- **Contact Identity Foundation - Plan A (backbone)** on `codex/p3-03-cif-plan-a`: contact normalization helpers, additive `Person` normalized/verified contact columns, verified-only partial unique indexes, canonical `findOrCreatePersonByContact`, Clerk webhook normalized+verified email writes, guest invite resolver routing through canonical contact identity, and a one-time Clerk verified-contact backfill script. Spec: `docs/superpowers/specs/2026-06-25-contact-identity-foundation-design.md`; plan: `docs/superpowers/plans/2026-06-25-contact-identity-foundation-a-backbone.md`.

**Designed/planned but not executed:**
- **Contact Identity Foundation Plan B (merge engine)** - not yet written.
- **W3a-UI-web** - spec `docs/superpowers/specs/2026-06-25-w3a-ui-web-cross-family-participation-design.md` (deferred behind the identity foundation).

## Reordered Roadmap (Canonical)

1. Merge or PR **Contact Identity Foundation Plan A** from `codex/p3-03-cif-plan-a`.
2. Write and execute **Contact Identity Foundation Plan B (merge engine)**.
3. **W3a-UI-web**.
4. **W3a-UI-mobile**.
5. Rest of **W3b** - passive SMS onboarding (inbound Twilio webhook, "reply Y", STOP/opt-out, phone verification).
6. **W4** - Pro Organizer beta (non-family event admin + B2B billing).
7. **W1** - Household to Family M2M reframe (migration-heavy).

## Work Completed Since Last Shared-State Update

2026-06-26 CIF Plan A implementation on `codex/p3-03-cif-plan-a`:
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

- Active branch `codex/p3-03-cif-plan-a`: `a6ed399`, `43160a0`, `d8075ed`, `13f3feb`, `1858792`, `599fd6a`.
- PR #1 (W2), PR #2 (W2b), PR #3 (W3a-API) - all merged to `main`.
- Recent `main`: `9821542` (CI fix), `33d950c`, `715b44c`, `a716488`, `fad140f`, `4c0819d`, `a5f2086`, `bb3bb7e`, `9115a14` (PR #3 merge), `372d98f`.

## Verification Baseline

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

Create a PR or make a merge decision for **Contact Identity Foundation Plan A** (`codex/p3-03-cif-plan-a`). After Plan A lands, write and execute **Contact Identity Foundation Plan B (merge engine)**, then return to **W3a-UI-web**.

## Open Blockers / Questions Needing Steve

1. Decide whether to merge/PR `codex/p3-03-cif-plan-a` now or request review changes first.
2. Decide when to run `apps/api/src/scripts/backfillClerkContacts.ts --apply` against production after deployment/migration.
3. CIF Plan B merge policy details still need a written plan before execution.
4. W3a-UI-web spec section 8 UI choices defaulted (per-suggestion admin toggle; elevation notice copy; decline UX). Confirm or change later; no hard blocker.

## Deferred Items (and Why)

- **W3a-UI-web / W3a-UI-mobile** - behind Contact Identity Foundation to avoid dedup debt.
- **Rest of W3b (passive SMS onboarding)** - needs inbound SMS infra plus TCPA/STOP compliance; sequenced after UI.
- **W4 (Pro Organizer), W1 (Household reframe)** - later in the reframe sequence; W1 is migration-heavy.
- **eslint warning cleanup (34)** - non-blocking; do in a sweep later.
- **Secrets manager (Infisical)** - future infra hygiene; do cheap tool-agnostic hardening first (restricted Stripe keys, rotation runbook).
- **Naming** - "KinScape"/"FamScape" taken, "FamLink" contested (Google Family Link); parked pending real USPTO/domain clearance before marketing.

## GitNexus Freshness

Up-to-date. `npx.cmd gitnexus analyze` ran 2026-06-26 on `codex/p3-03-cif-plan-a`: 3,028 nodes / 4,189 edges / 96 clusters / 88 flows. `AGENTS.md` and `CLAUDE.md` GitNexus blocks were refreshed to match.
