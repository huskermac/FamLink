# FamLink — Cursor / dev environment checkpoint

**Purpose:** Paste or @-mention this file when resuming work so the assistant quickly recalls **local setup**, **known fixes**, and **operational quirks** without re-deriving from chat history.

**Product / phase context:** See `docs/FamLink_Resumption_Prompt.md` (PRD, ADR, Phase 1 status).

---

## Monorepo layout (high level)

| Area | Path | Role |
|------|------|------|
| Web | `apps/web` | Next.js App Router, Clerk UI, middleware |
| API | `apps/api` | Express, Clerk JWT + Svix webhooks, guest routes |
| DB package | `packages/db` | Prisma schema, `db` client, migrations |
| Shared | `packages/shared` | Shared TS types; build outputs CJS for Node |

**Package manager:** npm workspaces (root `package.json`).

---

## Versions (drift vs older docs)

Older docs may say **Next 14**; the web app was upgraded for Clerk + App Router stability:

- **Next.js:** `^15.2.x` (resolves to 15.5.x as of checkpoint)
- **@clerk/nextjs:** `^6.39.x`
- **React:** 18.2 (unchanged)

**Prisma:** Still pinned per ADR (e.g. 5.16.x in workspace) — do not upgrade casually.

---

## Environment files

- **Root** `/.env` and `/.env.local` are **gitignored**; they hold real secrets locally.
- **`apps/web/next.config.mjs`** loads **repo root** env via `@next/env` + `dotenv`, then pins `NEXT_PUBLIC_*` into `nextConfig.env` so Clerk gets keys in middleware and RSC (avoids “Missing publishableKey” and monorepo misses).
- **`NEXT_PUBLIC_CLERK_KEYLESS_DISABLED`** is forced in config (keyless server-action path disabled for local dev).
- **API** loads env via `apps/api/src/loadEnv.ts` (repo root + `apps/api/.env` patterns — verify that file if env seems wrong).

**Required for API startup (Zod in `apps/api/src/lib/env.ts`):** `DATABASE_URL`, `CLERK_*`, `CLERK_WEBHOOK_SECRET`, Resend/Twilio placeholders or real values, `GUEST_TOKEN_SECRET`, `WEB_APP_URL`, etc.

---

## Local dev commands (typical)

```bash
# Root — install everything
npm install

# DB package after schema / prisma generate
npm run build -w @famlink/db
# (build script runs: prisma generate && tsc && scripts/copy-generated.cjs)

# API
cd apps/api && npm run dev    # default PORT 3001 from env

# Web
cd apps/web && npm run dev    # http://localhost:3000
```

**Ports:** Web **3000**, API **3001** — don’t point ngrok at the wrong one.

---

## `@famlink/db` build (important)

Prisma outputs under `packages/db/src/generated/` (JS + engine). **`tsc` does not emit** that tree into `dist/`. The package **`build`** script runs **`copy-generated.cjs`** to mirror `src/generated` → `dist/generated` so `require("./generated/client")` from `dist/index.js` works.

If you see **`Cannot find module './generated/client'`**, run **`npm run build -w @famlink/db`** (or full build) after `prisma generate`.

---

## Clerk — web app

- **`/health`** is mounted **before** `clerkAuth` in `apps/api/src/server.ts` so browsers don’t get Clerk handshake **307** on health checks.
- **Layout** uses **bracket** `process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY']` to reduce stale compile-time inlining of empty `NEXT_PUBLIC_*`.
- **`apps/web/.next`:** delete after env or Next major changes if behavior looks cached.

---

## Clerk — webhooks (Express)

- **Endpoint path:** `POST /api/v1/webhooks/clerk` (raw body for Svix — see `server.ts` mount).
- **Handler:** `apps/api/src/routes/webhooks.ts` — verifies with **`CLERK_WEBHOOK_SECRET`** (`whsec_...`), handles **`user.created`** / **`user.updated`**, upserts **`Person`**.
- **Local tunnel:** `ngrok http 3001` → Clerk endpoint URL = `https://<ngrok-host>/api/v1/webhooks/clerk`.
- **Timeouts:** Usually wrong URL (3000 vs 3001), dead ngrok, or API not running; use **ngrok inspector** `http://127.0.0.1:4040`.
- **Production:** Use deployed API URL + **separate** webhook signing secret in Clerk for that endpoint.

---

## Common operational issues

| Symptom | Likely cause |
|---------|----------------|
| `EADDRINUSE :::3001` | Old `ts-node-dev` still running — stop with Ctrl+C or kill PID on that port |
| Missing Clerk publishable key | Root `.env` not loaded for Next; check `next.config.mjs` + real `pk_test_...` |
| Next “Client Functions / Server Functions” | Was keyless + Next 14; mitigated by Next 15 + keyless disabled + env |
| Webhook timeout | ngrok URL stale, tunnel to wrong port, or API down |
| `GET /` 404 on API | Expected — API root now returns small JSON pointer; use `/health` |
| Next 404 on random paths | Only defined routes exist; see `apps/web/app/not-found.tsx` |

---

## Tests

- API Jest uses **`apps/api/.env.test`** + `TEST_DATABASE_URL`; global setup runs Prisma migrate. Needs **valid local test DB** credentials or tests fail at setup.

---

## What was verified in-session (checkpoint)

- Health: `GET http://localhost:3001/health` → `status: ok`, `db: ok` (against Railway Postgres).
- Next + Clerk: home and dashboard load; Google sign-in returns Clerk `user_...` on dashboard.
- Webhooks: Clerk deliveries succeeding through ngrok to Express webhook after `CLERK_WEBHOOK_SECRET` set.

---

*Last updated: 2026-03-22 — refresh this file when major stack or env behavior changes.*
