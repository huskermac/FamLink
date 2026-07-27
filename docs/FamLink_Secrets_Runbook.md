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

**If you add a brand-new secret name** (not just rotate an existing one), also add it to `turbo.json`'s `globalPassThroughEnv` array. Turborepo enters Strict Environment Variable Mode the moment `globalPassThroughEnv` exists at all — any var not explicitly listed there gets silently stripped before `infisical run -- turbo dev` hands it to a child task, even though `infisical run` itself successfully injected it into the parent process. This was invisible for most secrets during the initial 2026-07-01 rollout because they also happened to exist in local `.env`/`.env.local` (which `apps/api/src/loadEnv.ts` reads independently of Infisical) — it only surfaced once a secret (`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`) existed solely in Infisical with no local fallback.

## Local environment architecture (`.env` vs Infisical vs Railway)

**Added 2026-07-25**, after a run of rotations left `.env`/`.env.local` stale (secrets were updated in Infisical + Railway but never in the local files). This section is the authoritative model; where the per-row "Stored in … local `.env`" notes in the inventory below disagree, they are **deprecated** — Infisical is the local source.

### Three stores, clear owners

| Store | Purpose | Update on rotation? |
|---|---|---|
| **Railway Variables** | production runtime source of truth | **Yes** |
| **Infisical `dev`** | local-dev secret source, injected by `npm run dev:infisical` | **Yes** |
| **`.env` / `.env.local`** | local, non-secret machine config only (local DB pointers + local URLs) | **No** — holds no rotating secrets |

Secrets therefore live in exactly **two** places: Infisical (local) + Railway (prod). `.env` holds only what is per-machine and never rotates.

### Sync direction — and a footgun

The bootstrap script `scripts/secrets/import-to-infisical.sh` pushed local `.env` **→ Infisical** during the one-time 2026-07-01 setup. **Do NOT run it again.** The authoritative direction is now **Infisical → local** (via `infisical run` at dev time, or `infisical export` on demand). Re-running the import would overwrite the good Infisical values with stale local ones.

### `DATABASE_URL` is a special case (not a rotating secret)

`DATABASE_URL` in `.env` is a **local machine pointer** (→ local `famlink_dev`), not a shared secret, and it never rotates. Keep it authoritative in `.env`. **Do not also store a `DATABASE_URL` in Infisical `dev`** — `infisical run` would inject it and shadow the local pointer, so `dev:infisical` would silently connect to the wrong database. (Prod's `DATABASE_URL` lives in Railway, composed from `${{PGPASSWORD}}` as of 2026-07-25.)

### What `.env` keeps vs. what moves to Infisical

**KEEP in root `.env`** (local, non-secret): `DATABASE_URL`, `TEST_DATABASE_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL`, the `NEXT_PUBLIC_CLERK_*` URL vars, `WEB_APP_URL`, `NODE_ENV`, `TURBO_TEAM`. **Do NOT set `PORT`** (see the template note — a global `PORT=3001` collides the web app with the API). The Clerk **publishable** key is public — fine to keep here or move to Infisical.

**REMOVE from `.env`/`.env.local`** (secrets → Infisical owns them; these currently hold DEAD rotated values): `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `RESEND_API_KEY`, `TWILIO_AUTH_TOKEN`, `GUEST_TOKEN_SECRET`, `FIREBASE_PRIVATE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `HELICONE_API_KEY`, `CLOUDFLARE_R2_*`, `REDIS_URL`, `TURBO_TOKEN`, `STRIPE_*`. (Non-secret identifiers — `TWILIO_ACCOUNT_SID`, `TWILIO_PHONE_NUMBER`, `RESEND_FROM_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `CLOUDFLARE_R2_BUCKET_NAME`, `CLOUDFLARE_R2_PUBLIC_URL` — can go either place; simplest is to let Infisical carry them so `.env` stays purely local-machine config.)

### Target reduced `.env` (template)

```dotenv
# Local machine config ONLY — no secrets. Secrets come from Infisical via `npm run dev:infisical`.
# --- Local database (Postgres 18 famlink_dev): a machine pointer, NOT a rotating secret ---
DATABASE_URL="postgresql://<localuser>:<localpw>@localhost:5432/famlink_dev"
TEST_DATABASE_URL="postgresql://<localuser>:<localpw>@localhost:5432/famlink_test"
# --- Local service URLs / non-secret config ---
# Do NOT set PORT here. It is global and `next dev` also honors it, so PORT=3001 makes
# the web app collide with the API on 3001 (EADDRINUSE) under `npm run dev:infisical`.
# The API defaults to 3001 (env.ts) and Next defaults to 3000 when PORT is unset.
NODE_ENV="development"
WEB_APP_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXT_PUBLIC_API_URL="http://localhost:3001"
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL="/dashboard"
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL="/dashboard"
TURBO_TEAM="<your-turbo-team>"
# Clerk publishable key is PUBLIC (not a secret) — keep here or move to Infisical
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
```

Fill the `<...>` locals with your real machine values (match your existing local DB creds and Clerk dev keys). Once `.env` looks like this, **`.env.local` can be emptied** — its secrets are Infisical's job now.

### How local dev behaves after the cleanup

- **`npm run dev:infisical`** → works; Infisical provides every secret. This is the standard local path.
- **Plain `npm run dev`** → will now FAIL Zod validation for the Infisical-only secrets. That's an intentional guardrail (it forces Infisical use). If you want an offline fallback instead, regenerate on demand: `infisical export --env=dev --format=dotenv > .env.local` (then re-guard the local `DATABASE_URL`, which the export may overwrite).
- **Direct `prisma` / `tsx` commands** still read `.env` for the local `DATABASE_URL` (unchanged). For prod-targeting, set `DATABASE_URL` explicitly in the shell — never rely on `.env`.

### Ongoing rule

On every rotation: update **Infisical (`dev` + any shared env)** and **Railway (prod)**. **Leave `.env` alone.** Verify with `npm run dev:infisical` → `GET /health` = 200.

## Secret inventory

> **Deprecation note (2026-07-25):** the "Stored in … local `.env`/`.env.local`" locations in the rows below are **historical**. As of the local consolidation (verified `dev:infisical` → `/health` 200 with `.env.local` contributing zero keys), local **secrets** come from **Infisical `dev`** only; root `.env` holds non-secret local config. See "Local environment architecture" above. Railway remains prod's source of truth.

### Database & cache

| Variable | Type | Consumed by | Stored in |
|---|---|---|---|
| `DATABASE_URL` | SECRET | `packages/db` (Prisma), `apps/api` | Railway "Postgres" service (source) + Railway "FamLink API" service + local root `.env`/`.env.local` + `packages/db/.env` + the `postgres` MCP server entry in `~/.claude.json` (user scope) |
| `TEST_DATABASE_URL` | not sensitive — fixed local/CI default creds | `apps/api` tests | `apps/api/.env.test` (local); CI's `test` job sets its own fixed value against a throwaway container — no rotation needed |
| `REDIS_URL` | SECRET (if the managed instance requires auth) | `apps/api` (AI rate limiting) | Railway managed Redis service (source) + Railway "FamLink API" service + local `.env` |

### Clerk (auth)

| Variable | Type | Consumed by | Stored in |
|---|---|---|---|
| `CLERK_SECRET_KEY` | SECRET | `apps/api` (JWT verify), `apps/web` (server-side) | Clerk dashboard (source) + Railway "FamLink API" service + **Vercel `fam-link-web` project env vars** + local `.env`/`.env.local`. (An earlier version of this row wrongly said `apps/web` wasn't deployed — it has been live on Vercel at `https://fam-link-web.vercel.app` since 2026-06-12; see `docs/FamLink_Production_Ops_Reference.md`.) **⚠️ Prod currently uses a Clerk TEST instance (`pk_test_`/`sk_test_`, `*.accounts.dev`) — moving to a Clerk production instance requires a real domain; tracked as a follow-up.** |
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

> **Inbound-webhook note (W3b, 2026-07):** the auth token now also validates inbound SMS webhook
> signatures (`POST /api/v1/webhooks/twilio/sms`). Rotate via secondary-token promotion (as done
> 2026-07-06) so in-flight inbound requests keep validating; after promotion, old-token signatures
> fail with 400 (Twilio retries with the new signature automatically since Twilio signs per-request).

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
| `CLOUDFLARE_R2_ACCESS_KEY_ID` / `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | SECRET | `apps/api` (photo storage) | Cloudflare dashboard → R2 → API tokens (source) + Infisical `dev`/`prod` + Railway "FamLink API" service + local `.env`. **Scoped 2026-07-02:** token `famlink-photos-scoped-2026-07` has Object Read & Write on the `famlink-photos` bucket only (Tier-1 hardening done; old broad-account token revoked). |
| `CLOUDFLARE_R2_ACCOUNT_ID` / `CLOUDFLARE_R2_BUCKET_NAME` / `CLOUDFLARE_R2_PUBLIC_URL` | not secret | `apps/api` | record only |

### Stripe (billing)

| Variable | Type | Consumed by | Stored in |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | SECRET | `apps/api` (billing) | Stripe dashboard (source) + Infisical (`dev`=test key, `prod`=live key) + Railway "FamLink API" service + local `.env`. **Prod is LIVE mode as of 2026-07-02:** restricted key `famlink-api-prod-live` (`rk_live_...`) scoped to Customers/Checkout Sessions/Subscriptions/Invoices/Customer Portal **Write** + Products **Read**, nothing else. NOTE: the older scope list (Subscriptions/Customers/Checkout Sessions/Webhooks) was too narrow — the API also creates invoices + billing-portal sessions and reads prices; the dev test key should be re-scoped to match when convenient. |
| `STRIPE_WEBHOOK_SECRET` | SECRET | `apps/api` webhook route | Stripe dashboard (source, per-endpoint signing secret) + Railway "FamLink API" service + local `.env` |
| `STRIPE_PRICE_BASE` / `STRIPE_PRICE_BASE_SEAT` / `STRIPE_PRICE_UNLIMITED` | not secret (price IDs) | `apps/api` | record only |

### CI / Turborepo

| Variable | Type | Consumed by | Stored in |
|---|---|---|---|
| `TURBO_TOKEN` / `TURBO_TEAM` | low-sensitivity (remote cache auth) | CI only | **Currently unset** — `gh secret list` showed zero repo secrets configured as of 2026-07-01; turbo remote caching is effectively disabled in CI. If enabled later, lives in GitHub repo Settings → Secrets, intentionally outside Infisical's reach (see design spec Non-goals). |
| `DATABASE_URL` (CI workflow-level `env:` block) | **currently unset**, same reason | — | `.github/workflows/ci.yml` references `secrets.DATABASE_URL` defensively but no value is configured; `prisma generate` in the `lint-and-typecheck`/`build` jobs does not require live connectivity. If this is ever set for real, add a row here to track it. |

## Known exposure: Railway Agent chat history (found 2026-07-02)

The Railway project's built-in AI-agent chat (right sidebar of the project canvas) contains a **full plaintext paste of the April 2026 `.env`** ("Please add these variables to the API" message). Values sitting in that chat history: the pre-rotation Postgres password (dead — rotated 2026-06-18), `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `GUEST_TOKEN_SECRET`, `RESEND_API_KEY`, `TWILIO_AUTH_TOKEN`, `FIREBASE_PRIVATE_KEY` — the latter six presumed still live. Same exposure class as the June 2026 transcript incident.

**RESOLVED 2026-07-06:** all six exposed secrets rotated and verified (see Audit Log). Each old value is confirmed dead (deleted/regenerated at source). All exposed values in that chat are now stale. **Still pending Steve: delete the Railway agent conversation itself** if the UI allows, so the stale paste isn't lying around.

Related findings from the same review:
- `RESEND_FROM_DOMAIN` in prod is `resend.dev` (Resend sandbox) — guest invite email cannot reach real guests until a real domain is verified in Resend. Blocked on the parked naming/domain decision.
- `NODE_ENV` in prod was `development` (leaks error internals to clients via the errorHandler dev branch) — fixed to `production` 2026-07-02.

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
| 2026-07-01 | All secrets (`dev`/`test` Infisical environments) | Steve | Initial migration from local `.env`/`.env.local`/`packages/db/.env`/`apps/api/.env.test` into Infisical via `import-to-infisical.sh` |
| 2026-07-01 | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (`dev` only) | Steve | Net-new, not a rotation — previously unset in any local file. Added existing test-mode restricted key (`rk_test_...`) + a `stripe listen`-issued webhook secret. |
| 2026-07-02 | `CLOUDFLARE_R2_ACCESS_KEY_ID` + `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | Steve + Claude | Tier-1 hardening: replaced broad-account R2 token with bucket-scoped `famlink-photos-scoped-2026-07` (Object R/W, `famlink-photos` only). Set in Infisical `dev`+`prod` (clipboard flow, values never in transcript), Railway prod updated, verified via S3 put/get/list/delete round-trip + prod redeploy healthy. Old token revoked at Cloudflare. |
| 2026-07-02 | `NODE_ENV` (Railway prod, not a secret) | Steve + Claude | Was `development` in prod since launch — errorHandler leaked error internals to clients. Set to `production`, same deploy as the R2 rotation. |
| 2026-07-02 | `STRIPE_SECRET_KEY` (prod → LIVE mode) | Steve + Claude | Stripe live cutover: account activated, live products/prices created (Family $4.99/mo `price_1TooXuEpMILkAfP5GtcOZVAf`, Active Seat $1.99/mo `price_1TooYaEpMILkAfP5CVevcjVN`, Unlimited $14.99/mo `price_1TooZVEpMILkAfP5skzRY3Bj`), new restricted live key `famlink-api-prod-live` set in Infisical `prod` + Railway (clipboard flow). Prod `PricingTier` rows updated to live **monthly** prices (fixing a latent yearly-base/monthly-seat interval mix); stale test-mode `stripeCustomerId` cleared from the one CANCELED FamilySubscription. |
| 2026-07-02 | `STRIPE_WEBHOOK_SECRET` (prod) | Steve + Claude | New live-mode webhook endpoint `famlink-api-production` (`we_1ToogsEpMILkAfP5MkA5NnyZ`) at `https://famlink-api-production.up.railway.app/api/v1/billing/webhook`, API version `2026-05-27.dahlia` (matches SDK pin), 5 events. Signing secret set in Infisical `prod` + Railway. Customer portal (live) verified: payment-method update + cancel-at-period-end ON, plan switching/quantity OFF. |
| 2026-07-06 | `RESEND_API_KEY` | Steve + Claude | Railway Agent chat exposure. Created two new keys (prod + dev) for env isolation, set in Infisical `prod`/`dev` + Railway, **old exposed key deleted** at Resend. Verified `GET /domains` → 200. |
| 2026-07-06 | `TWILIO_AUTH_TOKEN` | Steve + Claude | Railway Agent chat exposure. Rotated via **secondary-token promotion**, old primary deleted (dead). Set in Infisical `prod` + Railway. Verified account fetch → 200 (old token → 401). |
| 2026-07-06 | `CLERK_SECRET_KEY` | Steve + Claude | Railway Agent chat exposure. Clerk has no "regenerate" — used API keys page **"+ Add new key"** (dev instance), updated Infisical `prod`/`dev` + Railway + **Vercel `fam-link-web`** + local, then **deleted old key**. Zero-downtime (both keys valid until delete). Verified BAPI `GET /v1/users` → 200. |
| 2026-07-06 | `CLERK_WEBHOOK_SECRET` | Steve + Claude | Railway Agent chat exposure. Clerk/Svix signing secret isn't rollable in place — **created a new webhook endpoint** (`user.created`/`user.updated` → `/api/v1/webhooks/clerk`) to get a fresh `whsec_`, set in Infisical `prod` + Railway, **deleted the old endpoint**. Route verified live (bad-sig → 400). Pending: send a Clerk test event to confirm end-to-end 200 delivery. |
| 2026-07-06 | `GUEST_TOKEN_SECRET` | Steve + Claude | Railway Agent chat exposure. App-generated (`openssl rand -base64 48`, 64 chars) to clipboard (value never in transcript), set in Infisical `prod` + Railway. No vendor to revoke. **Destructive** — invalidated 1 outstanding PENDING guest link (a single test RSVP, "Thanksgiving 2026", no real guest); prod had 0 `EventInvitation` and 1 `RSVP` token at rotation time. |
| 2026-07-06 | `FIREBASE_PRIVATE_KEY` | Steve + Claude | Railway Agent chat exposure. **Generated new service-account private key** (dated 2026-07-06) in Firebase console, set in Infisical `prod` + Railway, **old April key deleted** (service account now shows one active key, dated today). Verified valid via a real Google OAuth access-token exchange (`admin.credential.cert(...).getAccessToken()` → token issued). |
