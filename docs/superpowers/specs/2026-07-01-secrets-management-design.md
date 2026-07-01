# Secrets Management Hardening — Design

**Date:** 2026-07-01
**Status:** Approved
**Related memory:** `project_secrets_manager_infisical`, `project_rotate_credentials_2026_06_14`

## Problem

FamLink has ~15–18 real secrets (DB, Clerk, Resend, Twilio, Firebase, Redis, Anthropic/OpenAI/Helicone, Cloudflare R2, Stripe, Turbo, plus a GitHub PAT and a postgres connection string used by Claude Code's own MCP config) spread across four local plaintext env files, the Railway dashboard, and `~/.claude.json`. There is no single inventory. The June 2026 emergency rotation (Railway Postgres password + GitHub PAT, both exposed via a Claude Code transcript) required updating ~8 separate locations by hand. That fan-out on every rotation is the actual pain — not the secret count itself.

## Goals

- Shrink blast radius on the two broadest-scoped keys (Stripe, Cloudflare R2).
- Produce one authoritative, human-readable inventory + rotation runbook covering every secret, including the ones outside `.env` (GitHub PAT, postgres-MCP string).
- Stand up Infisical as the single source of truth for secret *values* (dev/test/prod), without adding a runtime dependency to the production deploy path.
- Fix the recurring transcript-leak pattern going forward (governance rule, not just tooling).

## Non-goals

- Prod does **not** pull secrets from Infisical at deploy/runtime (rejected — availability coupling). Railway dashboard remains the prod runtime source of truth.
- CI does **not** get wired to Infisical. Its only secrets (`DATABASE_URL` against a throwaway test container, `TURBO_TOKEN`, `TURBO_TEAM`) are low-sensitivity and already working via GitHub Secrets; not touching a working, low-risk path.
- No Infisical integration for the GitHub PAT / postgres-MCP string used by Claude Code's own config (`~/.claude.json`). Different mechanism (`claude mcp add --env`), not dotenv-loaded. Inventoried in the runbook only; wiring is a possible future follow-up, not this project.
- No self-hosted Infisical. Free cloud tier only (rejected self-host per prior memory: adds ops burden + availability dependency for no current benefit).
- No Twilio API-subkey or Firebase IAM narrowing in this pass (diminishing returns for the dashboard effort; can be added later using the same runbook pattern).

## Architecture

### Tier 1 — Restricted keys (dashboard work, Steve-owned)
- Replace the current broad `sk_test_…` Stripe key with a **restricted key** scoped to only the operations FamLink's API actually calls (subscriptions/webhooks — exact permission set determined from `apps/api` Stripe usage at implementation time).
- Replace the Cloudflare R2 access key with one **scoped to only the `famlink-photos` bucket**, not full account access.
- Both are dashboard-only actions; Claude provides the exact click-path but cannot perform them (no browser session into Stripe/Cloudflare).

### Tier 1 — Rotation runbook (Claude-authored)
New doc: `docs/FamLink_Secrets_Runbook.md`. One row per secret: name, purpose, where it's consumed (code path), every location holding a copy (local files, Railway service, GitHub Secrets, `~/.claude.json`), and the rotation steps in order. Built from the env inventory already gathered (`.env.example` files + `ci.yml` + MCP config knowledge) — no real values needed to write it.

### Tier 2 — Infisical (reach = "central inventory", not full integration)

**Structure:** one Infisical project, **"FamLink"**, three environments: `dev`, `test`, `prod` — mirroring the existing `.env` / `.env.test` / Railway split. Secret keys use the exact same names as today's env vars (`DATABASE_URL`, `CLERK_SECRET_KEY`, etc.) — no name mapping layer, so nothing downstream needs to change to consume them.

**Local dev integration:** `apps/api/src/loadEnv.ts` needs **no code change**. It calls dotenv's `config()`, which never overwrites an already-set environment variable. Running `infisical run -- npm run dev` (from repo root, via a new root `package.json` convenience script, e.g. `dev:infisical`) injects Infisical's `dev` environment first; the existing `.env`/`.env.local` files remain a fallback for anything not yet in Infisical, and stay the onboarding template (`.env.example` unchanged in shape, with a new header note pointing to Infisical as the preferred path).

**CI:** unchanged, by design (see Non-goals). Values are still recorded in Infisical's `test`/`prod` environments purely for inventory completeness — GitHub Actions keeps reading its own Secrets store.

**Prod (Railway):** unchanged at runtime. Infisical's `prod` environment is the canonical *record* of what prod values should be. Rotation flow becomes: update in Infisical → copy the new value into the Railway dashboard (documented as a runbook step). No Railway↔Infisical integration is installed, so an Infisical outage can never block or break a prod deploy.

**One-time import:** a short script (Claude writes, Steve runs locally, already-authenticated `infisical` CLI) reads the current local `.env`/`.env.local`/`packages/db/.env`/`apps/api/.env.test` files and calls `infisical secrets set` for each key into the matching environment. This runs entirely on Steve's machine — real secret values are never pasted into or displayed inside the Claude Code session, which is the same channel that caused the June leak.

### Governance addition

Append a rule to `docs/FamLink_Agent_Rules.md` (security section): **never paste, print, or display real secret values inside a Claude Code session or transcript** — reference which store (Infisical env, Railway service) holds a value instead of pasting it, even when rotating or debugging. This directly targets the root cause of the two prior incidents (Postgres password + GitHub PAT both leaked via transcript display, not via git).

## Ownership split

| Step | Owner | Why |
|---|---|---|
| Stripe restricted key, R2 scoped token | Steve | Dashboard-only actions, no API for Claude to drive |
| `infisical login` (browser OAuth), create project + 3 environments | Steve | Interactive OAuth; one-time |
| Run the one-time import script | Steve | Must run locally so real values never enter the session |
| Copy rotated values into Railway | Steve | Railway dashboard, per rotation runbook |
| Runbook doc, import script, npm script wiring, `.env.example` header update, Agent_Rules governance note | Claude | No credentials or dashboard access required |

## Testing / Validation

- Boot `apps/api` via `infisical run -- npm run dev` (after Steve completes the import) and confirm the health endpoint responds — this proves injection works without any secret value needing to appear in output or transcript.
- Confirm `.env.example` still functions as a standalone fallback (unauthenticated `npm run dev` without Infisical still starts using local files, per existing behavior).
- No unit tests apply — this is infra/doc/config work.

## Rollout order

1. Runbook doc (Claude) — has value immediately, no dependencies.
2. Tier 1 restricted keys (Steve, using runbook's new-key section).
3. Infisical project/environments + import script (Claude writes script; Steve runs login + import).
4. Local dev wiring (`dev:infisical` script, README/`.env.example` notes) (Claude).
5. Governance rule in `FamLink_Agent_Rules.md` (Claude).
6. Verification boot test (joint — Claude runs `infisical run`, Steve has already authenticated).
