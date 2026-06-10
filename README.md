# FamLink

**The Family Operating System** — a private, relationship-aware coordination platform for extended families: shared events and RSVPs, a family calendar with automatic birthdays, a family graph (people, households, relationships), guest participation without accounts, photo sharing, an AI family assistant, and seat-based subscriptions.

Governing documents: [PRD v0.1](docs/FamLink_PRD_v0_1.md) (what and why) and [ADR v0.4](docs/FamLink_ADR_v0_4.md) (how — the authoritative technical reference).

## Stack

| Layer | Technology |
|---|---|
| Web | Next.js (App Router), TanStack Query, Tailwind CSS |
| Mobile | Expo + Expo Router, NativeWind (wedge features only — events + calendar) |
| API | Node.js + Express (TypeScript), Socket.io, Zod validation |
| Data | PostgreSQL via Prisma 7 (`packages/db` is the canonical home), Redis (AI rate limiting) |
| Auth | Clerk (web/mobile/API) + signed guest tokens for no-account participation |
| AI | Vercel AI SDK + Anthropic Claude, Helicone observability — propose/confirm on all writes |
| Services | Stripe (billing), Resend (email), Twilio (SMS), Firebase FCM (push), Cloudflare R2 (photos) |
| Hosting | Vercel (web) + Railway (API, Postgres, Redis) |
| Tooling | Turborepo + npm workspaces, ESLint 9 (flat config at repo root), Vitest (API/web), Jest + jest-expo (mobile) |

## Repository layout

```
apps/
  api/        Express REST API (/api/v1/*), Socket.io, Stripe + Clerk webhooks, billing cron
  web/        Next.js app (protected app shell, onboarding, public RSVP pages)
  mobile/     Expo app (auth, family, events, calendar, assistant tabs)
packages/
  db/         Prisma schema, migrations, seed, generated client (@famlink/db)
  shared/     Shared TypeScript types (@famlink/shared)
  config/     Shared ESLint/tsconfig presets
docs/         PRD, ADR, prompt libraries, session checkpoints
```

## Getting started

Prereqs: Node 22, npm 10+, a PostgreSQL database, Redis (for the API), and accounts/keys for Clerk (required) plus the services above (placeholders work for booting; see `.env.example`).

```bash
npm ci

# Environment — the API validates ALL variables at startup and exits if any
# are missing. Copy the template and fill it in (real secrets go in .env.local):
cp .env.example .env

# Database — generate client + run migrations + seed pricing tiers
npm run build --workspace=@famlink/db
cd packages/db && npx prisma migrate deploy && npm run db:seed && cd ../..

# Run everything (web on :3000, API on :3001, Expo dev server)
npm run dev
```

Env loading order for the API is documented at the top of `.env.example` (`apps/api/.env` → root `.env` → root `.env.local`; first file that sets a key wins).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | All dev servers via Turborepo |
| `npm run build` | Production build (API target) |
| `npm run lint` | ESLint across every workspace (errors fail; warnings reported) |
| `npm run type-check` | TypeScript across the repo |
| `npm test` | All test suites |

## Testing

- **API** (`apps/api`): Vitest integration tests against a real Postgres database. Set `TEST_DATABASE_URL` in `apps/api/.env.test` (see `apps/api/.env.test.example`); the global setup runs migrations automatically. The suite seeds and truncates per test.
- **Web** (`apps/web`): Vitest + Testing Library (jsdom).
- **Mobile** (`apps/mobile`): Jest + jest-expo (not yet run in CI).

CI (GitHub Actions) runs lint + type-check, then the API and web suites against a Postgres service container, on Node 22. Pushes to `main` additionally build.

## Conventions

- Commit format: `feat: P3-XX <short description>` (`chore:`/`fix:` as appropriate) — see [CLAUDE.md](CLAUDE.md) for all development rules.
- Consult the ADR before any architectural decision; update it before changing a locked decision.
- Zod validation at every API boundary; authorization checks treat suspended members as non-members; all AI writes require human confirmation.

## Deployment

- **Web** deploys to Vercel.
- **API** deploys to Railway (`railway.toml` / `railpack.json`); the root `start` script runs `prisma migrate deploy` before booting. Set the same env names from `.env.example` in the Railway service.
- Stripe and Clerk webhooks must point at `/api/v1/billing/webhook` and `/api/v1/webhooks/clerk` respectively (raw-body routes with signature verification).
