# Secrets Management Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the doc/script/config layer that makes Infisical adoption and key hardening possible, without touching values a Claude Code session should never see.

**Architecture:** Six Claude-executable tasks (docs, a local-only import script, npm wiring, `.env.example` notes, a governance rule, a checkpoint) each land as an independent commit on a feature branch. A trailing **Manual Steps** section (not part of the task runner) lists the dashboard/CLI actions only Steve can perform — vendor key creation, `infisical login`, running the import script, and copying rotated values into Railway.

**Tech Stack:** Markdown docs, Bash (Git Bash, already the project's shell), npm/JSON config. Infisical CLI (external tool, Steve installs).

## Global Constraints

- No task may read, print, echo, or embed a real secret value. Every file created in this plan works from *names* and *locations*, never *values*.
- `.env.example` files keep their existing placeholder shape (still function as a standalone fallback per the spec's Testing/Validation section) — only a header note is added, no values change.
- `apps/api/src/loadEnv.ts` is **not modified** — dotenv's `config()` never overwrites an already-set var, so `infisical run` naturally takes precedence with zero code change (verified in the design spec).
- CI (`.github/workflows/ci.yml`) is **not modified** — confirmed via `gh secret list` that zero GitHub repo secrets are currently configured; nothing to wire up.
- Infisical CLI syntax used below is confirmed current as of 2026-07-01 against `https://infisical.com/docs/cli/commands/secrets`, `.../commands/run`, `.../usage`, `.../overview` (Windows install: `winget install infisical`).

---

## Manual Prerequisite (Steve — before Task 1 can be fully verified, does not block Tasks 1–6)

Tasks 1–6 below can all be written and committed without this. But Task 2's script and the final boot-test in Manual Steps need it eventually:

- Install the Infisical CLI: `winget install infisical` (or `scoop bucket add org https://github.com/Infisical/scoop-infisical.git && scoop install infisical`).
- Run `infisical login` (opens a browser for OAuth against Infisical Cloud).
- Create an Infisical project named **FamLink** in the Infisical dashboard, with three environments: `dev`, `test`, `prod` (Infisical projects come with `dev`/`staging`/`prod` by default — rename/delete `staging`, or just don't use it).
- From the repo root, run `infisical init` — this writes `.infisical.json` (safe to commit, contains no secrets, links this directory to the FamLink project).

---

### Task 1: Secrets rotation runbook

**Files:**
- Create: `docs/FamLink_Secrets_Runbook.md`

**Interfaces:**
- Consumes: nothing (pure documentation, references file locations already confirmed via `.env.example` reads and `gh secret list`).
- Produces: the canonical secret inventory that Task 2 (import script), Task 4 (`.env.example` notes), and Task 5 (governance rule) all reference by path.

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b chore/secrets-management-hardening
```

Expected: `Switched to a new branch 'chore/secrets-management-hardening'`

- [ ] **Step 2: Write the runbook**

Create `docs/FamLink_Secrets_Runbook.md`:

```markdown
# FamLink Secrets Runbook

**Purpose:** one place to see every secret FamLink uses, where each copy lives today, and the exact steps to rotate it. Built 2026-07-01 after the June 2026 emergency rotation (Railway Postgres password + GitHub PAT) required updating ~8 locations by hand with no checklist.

**Never put real secret values in this file.** Names and locations only.

## Standard rotation procedure

Applies to every SECRET-typed row below unless a row says otherwise.

1. Generate the new value at the source (vendor dashboard, or app-generated for `GUEST_TOKEN_SECRET`).
2. `infisical secrets set "<NAME>=<new-value>" --env=prod --path="/"` — repeat for `dev`/`test` if the same credential is shared across environments (prefer separate dev/test credentials where the vendor supports it).
3. Railway dashboard → **FamLink API** service → Variables → update `<NAME>` → Railway redeploys automatically on variable change.
4. Locally: `infisical run --env=dev -- npm run dev:infisical` picks up the new value automatically — no manual `.env` edit needed once Infisical is the local source.
5. Confirm the new value works (health check, or the specific feature that uses it).
6. Revoke the OLD value at the source once step 5 is confirmed. Don't leave both valid longer than necessary.
7. Add a row to the Audit Log at the bottom of this file.

## Secret inventory

### Database & cache

| Variable | Type | Consumed by | Stored in |
|---|---|---|---|
| `DATABASE_URL` | SECRET | `packages/db` (Prisma), `apps/api` | Railway "Postgres" service (source) + Railway "FamLink API" service + local root `.env`/`.env.local` + `packages/db/.env` + the `postgres` MCP server entry in `~/.claude.json` (user scope) |
| `TEST_DATABASE_URL` | not sensitive — fixed local/CI default creds | `apps/api` tests | `apps/api/.env.test` (local); CI's `test` job sets its own fixed value against a throwaway container — no rotation needed |
| `REDIS_URL` | SECRET (if the managed instance requires auth) | `apps/api` (AI rate limiting) | Railway managed Redis service (source) + Railway "FamLink API" service + local `.env` |

### Clerk (auth)

| Variable | Type | Consumed by | Stored in |
|---|---|---|---|
| `CLERK_SECRET_KEY` | SECRET | `apps/api` (JWT verify), `apps/web` (server-side) | Clerk dashboard (source) + Railway "FamLink API" service + local `.env`/`.env.local`. `apps/web` is not yet deployed to a hosting provider (only `railway.toml` exists, configured for `apps/api` only) — the web-side copy is local-dev-only today. |
| `CLERK_WEBHOOK_SECRET` | SECRET | `apps/api` webhook route | Clerk dashboard (Svix signing secret, source) + Railway "FamLink API" service + local `.env` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_PUBLISHABLE_KEY` | public identifier, not secret | `apps/web` (browser), `apps/api` | Clerk dashboard; record only |

### Guest links

| Variable | Type | Consumed by | Stored in |
|---|---|---|---|
| `GUEST_TOKEN_SECRET` | SECRET (app-generated, no vendor) | `apps/api` (JWT signing for RSVP links) | Railway "FamLink API" service + local `.env`. **Rotating this invalidates every outstanding unsent guest RSVP link** — coordinate before rotating. |

### Messaging

| Variable | Type | Consumed by | Stored in |
|---|---|---|---|
| `RESEND_API_KEY` | SECRET | `apps/api` (email) | Resend dashboard (source) + Railway "FamLink API" service + local `.env` |
| `TWILIO_ACCOUNT_SID` | sensitive identifier | `apps/api` (SMS) | Twilio console + Railway "FamLink API" service + local `.env` |
| `TWILIO_AUTH_TOKEN` | SECRET | `apps/api` (SMS) | Twilio console (source) + Railway "FamLink API" service + local `.env` |
| `TWILIO_PHONE_NUMBER` | not secret | `apps/api` | record only |

### Firebase (push notifications)

| Variable | Type | Consumed by | Stored in |
|---|---|---|---|
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` | identifiers, not secret | `apps/api` (FCM) | record only |
| `FIREBASE_PRIVATE_KEY` | SECRET (service-account private key) | `apps/api` (FCM) | Firebase Console → Project settings → Service accounts (source — generates a brand-new key each time; the old one must be manually revoked there) + Railway "FamLink API" service + local `.env` |

### AI providers

| Variable | Type | Consumed by | Stored in |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | SECRET | `apps/api` (AI assistant) | Anthropic Console (source) + Railway "FamLink API" service + local `.env` |
| `OPENAI_API_KEY` | SECRET | `apps/api` | OpenAI dashboard (source) + Railway "FamLink API" service + local `.env` |
| `HELICONE_API_KEY` | SECRET | `apps/api` (observability proxy) | Helicone dashboard (source) + Railway "FamLink API" service + local `.env` |

### Cloudflare R2 (photo storage)

| Variable | Type | Consumed by | Stored in |
|---|---|---|---|
| `CLOUDFLARE_R2_ACCESS_KEY_ID` / `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | SECRET | `apps/api` (photo storage) | Cloudflare dashboard → R2 → API tokens (source) + Railway "FamLink API" service + local `.env`. **Tier-1 hardening: scope this token to only the `famlink-photos` bucket, not full account access.** |
| `CLOUDFLARE_R2_ACCOUNT_ID` / `CLOUDFLARE_R2_BUCKET_NAME` / `CLOUDFLARE_R2_PUBLIC_URL` | not secret | `apps/api` | record only |

### Stripe (billing)

| Variable | Type | Consumed by | Stored in |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | SECRET | `apps/api` (billing) | Stripe dashboard (source) + Railway "FamLink API" service + local `.env`. **Tier-1 hardening: replace with a restricted key scoped to Subscriptions/Customers/Checkout Sessions/Webhooks only — `apps/api` never needs full account access.** |
| `STRIPE_WEBHOOK_SECRET` | SECRET | `apps/api` webhook route | Stripe dashboard (source, per-endpoint signing secret) + Railway "FamLink API" service + local `.env` |
| `STRIPE_PRICE_BASE` / `STRIPE_PRICE_BASE_SEAT` / `STRIPE_PRICE_UNLIMITED` | not secret (price IDs) | `apps/api` | record only |

### CI / Turborepo

| Variable | Type | Consumed by | Stored in |
|---|---|---|---|
| `TURBO_TOKEN` / `TURBO_TEAM` | low-sensitivity (remote cache auth) | CI only | **Currently unset** — `gh secret list` showed zero repo secrets configured as of 2026-07-01; turbo remote caching is effectively disabled in CI. If enabled later, lives in GitHub repo Settings → Secrets, intentionally outside Infisical's reach (see design spec Non-goals). |
| `DATABASE_URL` (CI workflow-level `env:` block) | **currently unset**, same reason | — | `.github/workflows/ci.yml` references `secrets.DATABASE_URL` defensively but no value is configured; `prisma generate` in the `lint-and-typecheck`/`build` jobs does not require live connectivity. If this is ever set for real, add a row here to track it. |

## Secrets outside dotenv (Claude Code's own MCP config)

| Secret | Type | Consumed by | Stored in | Rotation |
|---|---|---|---|---|
| GitHub PAT | SECRET | `github` MCP server | user-scope `~/.claude.json` | Generate new classic PAT (scopes `repo, read:org, read:user`) on github.com → `claude mcp remove github -s user` → `claude mcp add github --scope user --env GITHUB_PERSONAL_ACCESS_TOKEN=<new> -- npx -y @modelcontextprotocol/server-github` → verify `✔ Connected` → revoke the old token on github.com. |
| postgres MCP connection string | SECRET | `postgres` MCP server | user-scope `~/.claude.json` | Usually the same value as `DATABASE_URL`. Check the existing invocation in `~/.claude.json` before removing (`claude mcp list` / inspect config), then `claude mcp remove postgres -s user` + re-add with the new connection string. |

These two are intentionally **not** wired through Infisical — different mechanism (`claude mcp add --env`, not dotenv-loaded), one secret each, not worth custom scripting. Possible future follow-up, not this project.

## Audit log

| Date | Secret | Rotated by | Reason |
|---|---|---|---|
| 2026-06-18 | `DATABASE_URL` (Railway Postgres password) | Steve | Exposed via `~/.claude.json` + session transcript |
| 2026-06-18 | GitHub PAT | Steve | Exposed via `~/.claude.json` + session transcript |
```

- [ ] **Step 3: Verify the file**

Run: `grep -c "^|" docs/FamLink_Secrets_Runbook.md`
Expected: a number greater than 30 (confirms the tables rendered as markdown table rows, not broken).

Run: `grep -c "^### " docs/FamLink_Secrets_Runbook.md`
Expected: `8` (8 service-group headers: Database & cache, Clerk, Guest links, Messaging, Firebase, AI providers, Cloudflare R2, Stripe).

- [ ] **Step 4: Commit**

```bash
git add docs/FamLink_Secrets_Runbook.md
git commit -m "docs: add FamLink secrets rotation runbook

One inventory of every secret (names + storage locations + rotation
steps), including the GitHub PAT / postgres-MCP entries that live
outside dotenv. Replaces the ad-hoc 8-location scavenger hunt from
the June 2026 emergency rotation."
```

---

### Task 2: One-time Infisical import script

**Files:**
- Create: `scripts/secrets/import-to-infisical.sh`

**Interfaces:**
- Consumes: nothing from other tasks (standalone script).
- Produces: a script Steve runs manually in Manual Steps, per the ownership split in the design spec. **This script is never executed by Claude** — only written, and syntax-checked without execution.

- [ ] **Step 1: Write the script**

Create `scripts/secrets/import-to-infisical.sh`:

```bash
#!/usr/bin/env bash
#
# One-time import of local secret VALUES into Infisical.
#
# Run this YOURSELF, in your own terminal, after `infisical login` and
# `infisical init` (see docs/FamLink_Secrets_Runbook.md). Do NOT run this
# via an AI coding assistant / Claude Code Bash tool — command output and
# arguments become part of that session's context, which is exactly how
# the June 2026 Postgres-password + GitHub-PAT leaks happened.
#
# Usage:
#   ./scripts/secrets/import-to-infisical.sh <dev|test|prod> <path-to-env-file>
#
# Examples:
#   ./scripts/secrets/import-to-infisical.sh dev .env
#   ./scripts/secrets/import-to-infisical.sh dev .env.local
#   ./scripts/secrets/import-to-infisical.sh test apps/api/.env.test
#
# Prod has no local file with real values by design — enter prod secrets
# by hand (`infisical secrets set NAME=value --env=prod --path="/"`),
# copying each value directly from the Railway dashboard.

set -euo pipefail

ENVIRONMENT="${1:?Usage: import-to-infisical.sh <dev|test|prod> <path-to-env-file>}"
ENV_FILE="${2:?Usage: import-to-infisical.sh <dev|test|prod> <path-to-env-file>}"

if [ ! -f "$ENV_FILE" ]; then
  echo "File not found: $ENV_FILE" >&2
  exit 1
fi

count=0
while IFS='=' read -r key value; do
  [ -z "$key" ] && continue
  case "$key" in \#*) continue ;; esac
  value="${value%\"}"
  value="${value#\"}"
  infisical secrets set "${key}=${value}" --env="$ENVIRONMENT" --path="/" > /dev/null
  count=$((count + 1))
done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE")

echo "Imported $count secrets into Infisical environment '$ENVIRONMENT' from $ENV_FILE."
echo "No values were printed above. Verify with: infisical secrets --env=$ENVIRONMENT"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/secrets/import-to-infisical.sh
```

- [ ] **Step 3: Syntax-check without executing**

Run: `bash -n scripts/secrets/import-to-infisical.sh`
Expected: no output, exit code 0 (syntax valid; this does NOT run the script or touch any secret).

- [ ] **Step 4: Commit**

```bash
git add scripts/secrets/import-to-infisical.sh
git commit -m "chore: add one-time Infisical import script

Reads KEY=VALUE pairs from a local env file and pushes them into an
Infisical environment via 'infisical secrets set', suppressing all
output so values never appear in a terminal transcript. Intended to
be run manually by Steve, never via an AI assistant's tool calls."
```

---

### Task 3: Local dev convenience script

**Files:**
- Modify: `package.json:10-18` (root)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run dev:infisical`, documented in Task 4's `.env.example` notes as the preferred local-dev entry point.

- [ ] **Step 1: Add the script**

In `package.json`, add `"dev:infisical"` alongside the existing `"dev"` key:

```json
  "scripts": {
    "dev": "turbo dev",
    "dev:infisical": "infisical run --env=dev -- turbo dev",
    "build": "npx turbo build --filter=@famlink/api",
    "start": "npx prisma migrate deploy --config=packages/db/prisma.config.ts && node apps/api/dist/index.js",
    "lint": "turbo lint",
    "test": "turbo test",
    "type-check": "turbo type-check",
    "clean": "turbo clean"
  },
```

- [ ] **Step 2: Verify the JSON is valid and the script registered**

Run: `node -e "const p = require('./package.json'); if (!p.scripts['dev:infisical']) throw new Error('missing script'); console.log('OK:', p.scripts['dev:infisical'])"`
Expected: `OK: infisical run --env=dev -- turbo dev`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add dev:infisical convenience script

'npm run dev:infisical' runs the existing dev workflow with secrets
injected from Infisical's dev environment. No code change needed —
dotenv (apps/api/src/loadEnv.ts) never overwrites an already-set
env var, so local .env files remain a working fallback."
```

---

### Task 4: `.env.example` header notes

**Files:**
- Modify: `.env.example:1-24` (root, header block)
- Modify: `apps/api/.env.example:1-15` (header block)
- Modify: `apps/web/.env.example:1-9` (header block)

**Interfaces:**
- Consumes: `docs/FamLink_Secrets_Runbook.md` (Task 1) — referenced by path only.
- Produces: nothing consumed by later tasks; this is the last file-content change.

- [ ] **Step 1: Update root `.env.example` header**

In `.env.example`, insert this note immediately after the top comment block's existing "Production (e.g. Railway)" line (after line 22, before the `# =====` separator on line 24):

```
#
# Preferred local path: install the Infisical CLI, run `infisical login`
# once, then use `npm run dev:infisical` instead of `npm run dev` — it
# injects real values from Infisical's `dev` environment automatically.
# This file remains a working fallback if you skip Infisical.
# Full inventory + rotation steps: docs/FamLink_Secrets_Runbook.md
```

- [ ] **Step 2: Update `apps/api/.env.example` header**

In `apps/api/.env.example`, insert the same note after the existing "For a full monorepo template..." line (after line 13, before the `# =====` separator on line 15):

```
#
# Preferred local path: `npm run dev:infisical` from the repo root
# injects secrets from Infisical instead of these files. Full
# inventory + rotation steps: docs/FamLink_Secrets_Runbook.md
```

- [ ] **Step 3: Update `apps/web/.env.example` header**

In `apps/web/.env.example`, insert the same note after the existing comment block (after line 8, before the `# =====` separator on line 9, which precedes the `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` line):

```
#
# Preferred local path: `npm run dev:infisical` from the repo root
# injects secrets from Infisical instead of this file. Full
# inventory + rotation steps: docs/FamLink_Secrets_Runbook.md
```

- [ ] **Step 4: Verify no values changed, only comments added**

Run: `git diff --stat .env.example apps/api/.env.example apps/web/.env.example`
Expected: only insertions (`+`), zero deletions, in all three files.

Run: `git diff .env.example apps/api/.env.example apps/web/.env.example | grep -E '^-[A-Z]'`
Expected: no output (confirms no existing `KEY=value` line was removed or altered).

- [ ] **Step 5: Commit**

```bash
git add .env.example apps/api/.env.example apps/web/.env.example
git commit -m "docs: point .env.example files at Infisical + the rotation runbook

Header-only change — no placeholder values touched. .env.example
still works standalone; Infisical is now documented as the
preferred local path."
```

---

### Task 5: Governance rule — no real secret values in a session

**Files:**
- Modify: `docs/FamLink_Agent_Rules.md:118-122`

**Interfaces:**
- Consumes: `docs/FamLink_Secrets_Runbook.md` (Task 1) — referenced by path.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the rule**

In `docs/FamLink_Agent_Rules.md`, section `## 5. Security`, add a new bullet after the existing cross-tenant-isolation bullet (after line 122, before the `---` separator on line 124):

```
- Never paste, print, or display a real secret value (API key, token, password, connection string) inside a Claude Code session or transcript. Reference which store holds it — an Infisical environment, a Railway service variable — instead of pasting the value itself, even when rotating or debugging. This is how the June 2026 Postgres-password and GitHub-PAT leaks happened (both via transcript display, not via git). See `docs/FamLink_Secrets_Runbook.md`.
```

- [ ] **Step 2: Verify placement**

Run: `grep -n -A1 "Cross-tenant isolation is a hard invariant" docs/FamLink_Agent_Rules.md`
Expected: the new bullet appears as the line immediately after the cross-tenant-isolation bullet.

- [ ] **Step 3: Commit**

```bash
git add docs/FamLink_Agent_Rules.md
git commit -m "docs: add never-paste-real-secrets rule to Agent Rules

Targets the actual root cause of the June 2026 Postgres-password and
GitHub-PAT leaks: both were exposed via session transcript display,
not via git. Points at the new secrets runbook."
```

---

### Task 6: Checkpoint

**Files:**
- Modify: `docs/FamLink_Current_State.md`

**Interfaces:**
- Consumes: the file paths created/modified in Tasks 1–5.
- Produces: nothing (terminal task).

- [ ] **Step 1: Add a "Work Completed" entry**

In `docs/FamLink_Current_State.md`, under `## Work Completed Since Last Shared-State Update`, add a new entry above the existing 2026-07-01 entry:

```
2026-07-01 **Secrets management hardening** (docs/scripts, branch `chore/secrets-management-hardening`): added `docs/FamLink_Secrets_Runbook.md` (full secret inventory + standard rotation procedure + audit log), `scripts/secrets/import-to-infisical.sh` (one-time local-values-to-Infisical import, Steve-run-only), `npm run dev:infisical` convenience script, `.env.example` header notes across all three files, and a governance rule in `FamLink_Agent_Rules.md` (never paste real secret values into a session — targets the actual cause of the June 2026 leaks). Spec: `docs/superpowers/specs/2026-07-01-secrets-management-design.md`; plan: `docs/superpowers/plans/2026-07-01-secrets-management-hardening.md`. **Pending Steve (Manual Steps, not part of this plan's task runner):** install Infisical CLI, `infisical login` + `infisical init`, create Stripe restricted key + scoped R2 token, run the import script locally, verify `npm run dev:infisical` boots the API.
```

- [ ] **Step 2: Verify**

Run: `grep -c "Secrets management hardening" docs/FamLink_Current_State.md`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add docs/FamLink_Current_State.md
git commit -m "docs: checkpoint secrets management hardening"
```

---

## Manual Steps (Steve — outside this plan's task runner)

Not dispatched to a subagent: these require dashboard logins, browser OAuth, or running a script locally so real values never enter a Claude Code session.

1. **Stripe restricted key** — Stripe dashboard → Developers → API keys → Create restricted key → grant only Subscriptions (write), Customers (write), Checkout Sessions (write), Webhook Endpoints (read) → copy the new `rk_live_…`/`rk_test_…` key → update Railway "FamLink API" service variable `STRIPE_SECRET_KEY` → update local `.env.local` (or Infisical `dev`/`prod`) → confirm billing flows still work → revoke the old broad key.
2. **Cloudflare R2 scoped token** — Cloudflare dashboard → R2 → Manage API Tokens → Create API Token → Object Read & Write → restricted to bucket `famlink-photos` only → update `CLOUDFLARE_R2_ACCESS_KEY_ID`/`CLOUDFLARE_R2_SECRET_ACCESS_KEY` in Railway + local/Infisical → confirm photo upload still works → revoke the old account-wide token.
3. **Infisical setup** — per the Manual Prerequisite above: install CLI, `infisical login`, create the FamLink project with `dev`/`test`/`prod` environments, `infisical init` in the repo root, commit the resulting `.infisical.json`.
4. **Import existing values** — run `./scripts/secrets/import-to-infisical.sh dev .env`, `./scripts/secrets/import-to-infisical.sh dev .env.local`, `./scripts/secrets/import-to-infisical.sh test apps/api/.env.test` locally. Enter `prod` values by hand (`infisical secrets set NAME=value --env=prod --path="/"`), copying each from the Railway dashboard.
5. **Verify** — run `npm run dev:infisical` from the repo root, confirm the API boots and `GET /health` responds. This proves injection works; no secret value needs to appear anywhere in that output.
