# FamLink Secrets Runbook

**Purpose:** one place to see every secret FamLink uses, where each copy lives today, and the exact steps to rotate it. Built 2026-07-01 after the June 2026 emergency rotation (Railway Postgres password + GitHub PAT) required updating ~8 locations by hand with no checklist.

**Never put real secret values in this file.** Names and locations only.

## Standard rotation procedure

Applies to every SECRET-typed row below unless a row says otherwise.

1. Generate the new value at the source (vendor dashboard, or app-generated for `GUEST_TOKEN_SECRET`).
2. `infisical secrets set "<NAME>=<new-value>" --env=prod` — repeat for `dev`/`test` if the same credential is shared across environments (prefer separate dev/test credentials where the vendor supports it). Do not add `--path="/"`: on Git Bash for Windows, MSYS rewrites a literal `/` argument into the Git install path before it reaches `infisical.exe`, breaking the call with a 400 "Invalid secret path" error. Omitting `--path` uses Infisical's root-path default and avoids this entirely.
3. Railway dashboard → **FamLink API** service → Variables → update `<NAME>` → Railway redeploys automatically on variable change.
4. Locally: `npm run dev:infisical` picks up the new value automatically — no manual `.env` edit needed once Infisical is the local source.
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
