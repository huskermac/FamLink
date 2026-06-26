# FamLink — Current State (shared, cross-tool)

**Canonical resume point for any agent (Claude Code, Codex, …).** Read this first. Process rules live in `docs/FamLink_Agent_Rules.md`. If this doc conflicts with the live code, trust the code and update this doc.

| Field | Value |
|---|---|
| Last updated | 2026-06-26 |
| Branch | `main` (== `origin/main`, clean) |
| HEAD | `9821542` |
| CI at HEAD | ✅ green — `lint-and-typecheck`, `test`, `build` all success (run 28183812961) |

---

## Current phase / status

**Phase 3 — Family-Model Reframe (P3-02 / P3-03), IN PROGRESS.** Design council-converged (`docs/FamLink_Design_Family_Model_Reframe.md`). The reframe replaces the older P3 ideas (Image Pipeline, Group Chat, Layer-3 AI) which are re-sequenced behind it.

**Shipped & merged:**
- **W2** — per-person AI entitlement (P3-02, PR #1).
- **W2b** — entitlement surfacing + foreign-context AI throttle + mobile upsell (P3-02, PR #2).
- **W3a-API** — cross-family event participation backend (P3-03, PR #3): `EventParticipant` grant + roles, `resolveEventAccess`, cross-family invite/accept/decline/revoke/role, participant RSVP + per-item task contributions, `ForeignInvitedEventDTO`, participant-scoped notifications.

**Designed/planned but NOT executed** (specs + Plan A committed to `main`):
- **Contact Identity Foundation** (pulled ahead of W3a-UI to avoid dedup debt) — spec `docs/superpowers/specs/2026-06-25-contact-identity-foundation-design.md`; **Plan A (backbone)** `docs/superpowers/plans/2026-06-25-contact-identity-foundation-a-backbone.md` (6 tasks). **Plan B (merge engine) not yet written.**
- **W3a-UI-web** — spec `docs/superpowers/specs/2026-06-25-w3a-ui-web-cross-family-participation-design.md` (deferred behind the identity foundation).

## Reordered roadmap (canonical)

1. **Contact Identity Foundation — Plan A (backbone)** ← next
2. Contact Identity Foundation — **Plan B (merge engine)** (write + execute)
3. **W3a-UI-web**
4. **W3a-UI-mobile**
5. Rest of **W3b** — passive SMS onboarding (inbound Twilio webhook, "reply Y", STOP/opt-out, phone verification)
6. **W4** — Pro Organizer beta (non-family event admin + B2B billing)
7. **W1** — Household ↔ Family M2M reframe (migration-heavy)

## Work completed since last shared-state update

This is the **first** shared-state doc; it captures the 2026-06-24/25 stream:
- W2b shipped → **PR #2 merged**; W3a-API shipped → **PR #3 merged** (final opus review fixed a roster-leak C1 + item-write leak I1, commit `372d98f`).
- Repo cleanup (`bb3bb7e`..`4c0819d`): deleted all merged branches (local + remote); removed a stray committed worktree **gitlink** (phantom submodule) + gitignored `.claude/worktrees/`; **untracked `.claude/settings.local.json`** + gitignored it.
- Wrote/committed: W3a-UI-web spec (`fad140f`), Contact Identity Foundation spec (`a716488`), CIF Plan A (`715b44c`), CLAUDE.md phase update (`33d950c`).
- **CI fix** (`9821542`): removed an unused `nonMember` var in `events.test.ts` that was the lone eslint *error* breaking `lint-and-typecheck` since the W3a-API merge → CI now green.
- Prod data check (Railway): 12 persons / 3 families / 0 contact collisions / **0 emails on `Person`** (emails live in Clerk) → the identity migration is **additive, no wipe**.

## Important commits / PRs

- PR #1 (W2), PR #2 (W2b), PR #3 (W3a-API) — all merged to `main`.
- Recent `main`: `9821542` (CI fix) ← HEAD, `33d950c`, `715b44c`, `a716488`, `fad140f`, `4c0819d`, `a5f2086`, `bb3bb7e`, `9115a14` (PR #3 merge), `372d98f`.

## Verification baseline

- **CI green at HEAD `9821542`** — all three jobs pass.
- Local (last full runs): API **368/368**, web **112/112**, mobile suite pass; `tsc --noEmit` clean across api/web/mobile.
- **Known non-blocking:** 34 eslint **warnings** in `apps/api` (mostly `@typescript-eslint/no-explicit-any` in test mocks + a few stale `eslint-disable` directives); ~14 auto-fixable via `eslint --fix`. Warnings do not fail CI.
- **Process note:** the subagent per-task loop ran `tsc` + tests but not `eslint`, which let the CI error slip in. **Add `npm run lint` to the per-task verification loop** when executing CIF Plan A.

## Next recommended / authorized step

**Execute Contact Identity Foundation Plan A** (subagent-driven; branch off `main`; phase tag `P3-03`). NOTE: `@famlink/db` resolves to compiled `dist/` — run `cd packages/db && npx prisma generate && npm run build` after the schema task. **Not yet explicitly authorized to start** — awaiting Steve's go / sequencing decision (see blockers).

## Open blockers / questions needing Steve

1. **Sequencing:** execute CIF Plan A next (recommended), or pull **W3a-UI-web** forward for a sooner user-visible win? Raised, **not yet decided by Steve**.
2. CIF spec open items are defaulted (Clerk backfill via script; eager guest reconcile; `US` default phone country) — confirm or change. No hard blocker.
3. W3a-UI-web spec §8 UI choices defaulted (per-suggestion admin toggle; elevation notice copy; decline UX) — confirm or change. No hard blocker.

## Deferred items (and why)

- **W3a-UI-web / -mobile** — behind the Contact Identity Foundation (Steve's call: build identity first, no dedup debt).
- **Rest of W3b (passive SMS onboarding)** — needs inbound SMS infra + TCPA/STOP compliance; sequenced after UI.
- **W4 (Pro Organizer), W1 (Household reframe)** — later in the reframe sequence; W1 is migration-heavy.
- **eslint warning cleanup (34)** — non-blocking; do in a sweep later.
- **Secrets manager (Infisical)** — future infra hygiene; do cheap tool-agnostic hardening first (restricted Stripe keys, rotation runbook). See the secrets-manager memory note.
- **Naming** — "KinScape"/"FamScape" taken, "FamLink" contested (Google Family Link); parked pending real USPTO/domain clearance before any marketing.

## GitNexus freshness

✅ **Up-to-date.** `npx gitnexus status` (2026-06-26): indexed commit `9821542` == current commit. No re-analyze needed. (The "2973 symbols / 4096 relationships" figures in the `AGENTS.md`/`CLAUDE.md` GitNexus block are a stale display string predating the W3a-API merge, but the index itself is current.)
