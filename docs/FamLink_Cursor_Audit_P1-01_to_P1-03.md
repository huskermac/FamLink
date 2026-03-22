# FamLink — Cursor Audit Prompt: P1-01 through P1-03

Paste this entire prompt into Cursor Composer (Ctrl+Shift+I).

---

## Your Task

You are auditing the FamLink monorepo to determine exactly what was built for prompts P1-01, P1-02, and P1-03, and whether each deliverable meets its acceptance criteria. Do not generate new features. Your job is to read, check, report, and fix gaps only.

Work through every section below in order. For each check, read the actual file on disk, then report PASS, FAIL, or MISSING. After all checks, produce a remediation list of every item that needs fixing, then fix them one at a time.

---

## Section 1 — Monorepo Root

Read `package.json` at the monorepo root.

**Check 1.1** — `packageManager` field is present.
- Expected: `"packageManager": "npm@<version>"` (any valid npm version string)
- If missing: add it. Run `npm --version` to get the exact version, then set `"packageManager": "npm@<that version>"`.

**Check 1.2** — All five workspace packages are declared.
- Expected in `workspaces`: `apps/web`, `apps/mobile`, `apps/api`, `packages/shared`, `packages/db`

**Check 1.3** — `apps/web/package.json` and `apps/mobile/package.json` each have a `test` script.
- Expected: `"test": "echo \"No tests yet\" && exit 0"`
- If missing: add it to both. This prevents Turborepo from failing the test pipeline on packages with no tests yet.

---

## Section 2 — P1-01: Shared Types (AgeGateLevel)

Read `packages/shared/src/types/person.ts`.

**Check 2.1** — `AgeGateLevel` enum is present with exactly three values: `NONE`, `YOUNG_ADULT`, `MINOR`.

**Check 2.2** — `Person` interface uses `ageGateLevel: AgeGateLevel` — not `isMinor: boolean`.

**Check 2.3** — `Person` interface has `guardianPersonId: string | null`.

Read `packages/shared/src/index.ts`.

**Check 2.4** — `AgeGateLevel` is exported from the barrel file.

**Check 2.5** — No file anywhere in `packages/shared/` still references `isMinor`. Search recursively.

---

## Section 3 — P1-01: Express API Server

Read `apps/api/src/lib/env.ts`.

**Check 3.1** — Zod validates exactly these variables (all must be present):
`DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `PORT` (default "3001"), `NODE_ENV` (default "development"), `WEB_APP_URL`

**Check 3.2** — `GUEST_TOKEN_SECRET` is also validated (added by P1-03/P1-04 work — may be present).

Read `apps/api/src/server.ts`.

**Check 3.3** — The file exports an Express app but does NOT call `app.listen()`. Listen is in `index.ts` only.

**Check 3.4** — Middleware stack order is correct. Read the file and confirm this exact order:
1. `cors`
2. `helmet`
3. `express.raw()` scoped to `/api/v1/webhooks/clerk` only (added by P1-03)
4. `express.json()`
5. request logger (Morgan)
6. `clerkAuth` (added by P1-03)
7. routes
8. 404 handler
9. `errorHandler`

**Check 3.5** — `apps/api/src/middleware/` contains: `cors.ts`, `errorHandler.ts`, `requestLogger.ts`.
- Confirm `validateEnv.ts` does NOT exist here. Env validation belongs in `lib/env.ts`, not middleware.

Read `apps/api/src/routes/health.ts`.

**Check 3.6** — `GET /health` calls `checkDatabaseHealth()` from `@famlink/db`, returns `{ status, db, timestamp }`, and returns 503 on DB failure.

Read `apps/api/tsconfig.json`.

**Check 3.7** — Extends `packages/config/tsconfig.base.json` (or equivalent shared base).

Read `apps/api/.env.example`.

**Check 3.8** — Contains all required variable names including `TEST_DATABASE_URL`.

---

## Section 4 — P1-02: Clerk in Next.js

Read `apps/web/middleware.ts` (at root of `apps/web/`, not inside `src/`).

**Check 4.1** — Uses `clerkMiddleware()` from `@clerk/nextjs/server` — NOT the deprecated `authMiddleware()`.

**Check 4.2** — Public routes include all four: `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/api/v1/guest/(.*)`.
- Note: the correct path is `/api/v1/guest/` not `/api/guest/`. If the file shows `/api/guest/(.*)` without the `v1`, that is a bug — fix it.

**Check 4.3** — The `matcher` export is present.

Read `apps/web/app/layout.tsx`.

**Check 4.4** — Root layout is wrapped with `<ClerkProvider>` from `@clerk/nextjs`.

Read `apps/web/app/sign-in/[[...sign-in]]/page.tsx`.

**Check 4.5** — File exists at that exact path (catch-all route pattern required).

Read `apps/web/app/sign-up/[[...sign-up]]/page.tsx`.

**Check 4.6** — File exists at that exact path.

Read `apps/web/lib/auth.ts`.

**Check 4.7** — Exports `getCurrentUserId(): Promise<string>`.

Read `apps/web/.env.example`.

**Check 4.8** — Contains all 6 Clerk variable names: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`.

**Check 4.9** — No Clerk key values are hardcoded anywhere in `apps/web/`. Search for any string starting with `pk_` or `sk_`.

---

## Section 5 — P1-03: Clerk in Express API

Read `apps/api/src/middleware/requireAuth.ts`.

**Check 5.1** — Exports `clerkAuth` middleware that applies `clerkMiddleware()` globally.

**Check 5.2** — Exports `requireAuth` middleware that returns **401** (not 403) when `userId` is null.

**Check 5.3** — Exports `AuthedRequest` interface extending Express `Request` with `userId: string`.

Read `apps/api/src/routes/webhooks.ts`.

**Check 5.4** — Uses Svix `Webhook` class to verify signature. Fails closed — returns 400 if verification fails.

**Check 5.5** — `user.created` handler upserts Person with `ageGateLevel: 'NONE'` — NOT `isMinor`.

**Check 5.6** — `user.updated` handler performs the same upsert (idempotent).

**Check 5.7** — All other event types return `200 { received: true }` without processing.

**Check 5.8** — The raw body middleware (`express.raw()`) is applied only to this webhook route, not globally. Confirm in `server.ts`.

---

## Section 6 — P1-01/P1-03: Testing Infrastructure

Read `apps/api/jest.config.ts`.

**Check 6.1** — File exists and uses `preset: 'ts-jest'` with `testEnvironment: 'node'`.

**Check 6.2** — `testMatch` targets `**/__tests__/**/*.test.ts`.

**Check 6.3** — `globalSetup` points to a setup file (e.g., `src/__tests__/setup/globalSetup.ts`).

**Check 6.4** — `globalTeardown` points to a teardown file.

**Check 6.5** — `setupFiles` (runs BEFORE module imports) includes `loadTestEnv.ts` or equivalent.
- CRITICAL: This must be in `setupFiles`, NOT `setupFilesAfterFramework`. If it is in `setupFilesAfterFramework`, move it to `setupFiles`. The distinction matters because `lib/env.ts` calls `process.exit()` on import if env vars are missing — `setupFiles` runs before that import, `setupFilesAfterFramework` does not.

Read `apps/api/src/__tests__/setup/loadTestEnv.ts` (or wherever the env bootstrap file lives).

**Check 6.6** — Sets default values for all required env variables before server imports.

**Check 6.7** — `CLERK_WEBHOOK_SECRET` default in this file matches the value used to sign webhooks in `webhooks.test.ts`. Read both files to confirm they use the same secret string.

Read `apps/api/src/__tests__/setup/afterEach.ts`.

**Check 6.8** — Truncates all data tables after each test. Expected table list (in dependency order):
`rsvps`, `event_invitations`, `potluck_assignments`, `events`, `household_members`, `family_members`, `relationships`, `households`, `family_groups`, `persons`

Read `apps/api/src/__tests__/helpers/auth.ts`.

**Check 6.9** — Exports `TEST_CLERK_ID`, `TEST_USER_2_CLERK_ID`, `mockClerkAuth()`, and `authedRequest()`.

Read `apps/api/src/__tests__/helpers/db.ts`.

**Check 6.10** — Exports `seedTestPerson()`, `seedSecondPerson()`, `seedTestFamily()`, `seedTestEvent()`, `seedGuestPerson()`.

---

## Section 7 — P1-03 Tests

Read `apps/api/src/__tests__/middleware/requireAuth.test.ts`.

**Check 7.1** — File exists with at least 3 test cases:
- 401 when no Authorization header
- 401 when auth is invalid
- passes through (not 401) for valid auth

Read `apps/api/src/__tests__/routes/webhooks.test.ts`.

**Check 7.2** — File exists with at least 6 test cases:
- 400 for missing Svix headers
- 400 for invalid signature
- `user.created` creates Person with `ageGateLevel: 'NONE'`
- `user.created` is idempotent
- `user.updated` updates the Person
- unknown event type returns 200

**Check 7.3** — Tests use real Svix `Webhook.sign()` to generate signatures — not a mocked signature.

---

## Section 8 — TypeScript Integrity

Run `turbo type-check` (or `tsc --noEmit` individually in `apps/api` and `apps/web`).

**Check 8.1** — Zero TypeScript errors in `apps/api`.

**Check 8.2** — Zero TypeScript errors in `apps/web`.

**Check 8.3** — Zero TypeScript errors in `packages/shared`.

---

## Section 9 — ADR Compliance Spot Checks

Search the entire codebase for the following. Any hit is a bug to fix.

**Check 9.1** — No reference to `@sendgrid/mail` anywhere. Email must use Resend only.

**Check 9.2** — No reference to `isMinor` anywhere (replaced by `ageGateLevel`).

**Check 9.3** — No hardcoded Clerk keys (strings starting with `pk_live_`, `pk_test_`, `sk_live_`, `sk_test_`).

**Check 9.4** — Prisma is at version `5.16.0` in `packages/db/package.json`. Do not upgrade.

---

## Section 10 — Reporting and Remediation

After completing all checks above:

1. Print a summary table with each check number, its description, and its status (PASS / FAIL / MISSING).

2. List every failing or missing item with a one-line description of what needs to be done.

3. Fix each item, one at a time, showing the exact change made. Do not batch fixes — apply and confirm each one before moving to the next.

4. After all fixes are applied, run `turbo type-check` and confirm zero errors.

5. Print a final status: "Audit complete. All checks passing. Ready for P1-04."

---

## Important Constraints

- Do NOT run `npm install` unless a package is genuinely missing from `node_modules` and preventing compilation. Prefer editing `package.json` and noting that the developer should run `npm install`.
- Do NOT generate any new feature code. This audit covers P1-01 through P1-03 only.
- Do NOT modify the Prisma schema. It was locked in Phase 0.
- Do NOT upgrade any dependency versions. All versions are locked per ADR v0.3.
- If you find a discrepancy that you are unsure how to resolve, flag it clearly rather than guessing.

---

## Audit execution log (2026-03-21)

Executed against the repo after applying remediation. Summary: all numbered checks **PASS** except where noted below.

| Check | Status | Notes |
|--------|--------|--------|
| 1.1 | PASS | `packageManager` present in root `package.json`. |
| 1.2 | PASS | `workspaces: ["apps/*", "packages/*"]` includes all five packages. |
| 1.3 | PASS | `test` script added to `apps/web` and `apps/mobile`. |
| 2.1–2.5 | PASS | `AgeGateLevel`, `Person`, barrel export; no `isMinor` in `packages/shared`. |
| 3.1–3.2 | PASS | `env.ts` validates listed vars + `GUEST_TOKEN_SECRET`. |
| 3.3 | PASS | `createApp()` only; listen in `index.ts`. |
| 3.4 | PASS | `express.raw()` mounted only at `/api/v1/webhooks/clerk` (see `server.ts` + `webhooks.ts`). |
| 3.5 | PASS | Required middleware files present; `validateEnv.ts` absent. `guestAuth.ts` exists (P1-04). |
| 3.6 | PASS | `GET /health` uses `checkDatabaseHealth`, 503 on failure. |
| 3.7 | PASS | `apps/api/tsconfig.json` extends `packages/config/tsconfig.base.json`. |
| 3.8 | PASS | `apps/api/.env.example` includes `TEST_DATABASE_URL` and required names. |
| 4.1–4.9 | PASS | `clerkMiddleware`, public routes, matcher, `ClerkProvider`, catch-all sign-in/up, `getCurrentUserId`, `apps/web/.env.example` Clerk vars; no `pk_`/`sk_` in source under `apps/web/` (placeholders only in `.env.example`). |
| 5.1–5.8 | PASS | `clerkAuth` / `requireAuth` (401), Svix verification, `ageGateLevel: NONE`, idempotent upsert, unknown events → 200, raw body only on clerk route. |
| 6.1–6.7 | PASS | Jest + `ts-jest`; `testMatch` `**/__tests__/**/*.test.ts`; global setup/teardown under `src/__tests__/setup/`; `loadTestEnv` in `setupFiles`; webhook secret matches `webhooks.test.ts` via `process.env`. |
| 6.8 | PASS | `afterEach` truncates in FK-safe order using **PostgreSQL quoted Prisma table names** (`"RSVP"`, `"Person"`, …), not snake_case `rsvps`—matches the actual schema. |
| 6.9–6.10 | PASS | Helpers under `src/__tests__/helpers/auth.ts` and `db.ts` with expected exports. |
| 7.1–7.3 | PASS | `requireAuth` and webhook tests live under `src/__tests__/`; Svix `Webhook.sign()` used. |
| 8.1–8.3 | PASS | `npx turbo type-check` succeeds (`api`, `web`, `shared`). `turbo.json` uses `tasks` (Turbo 2.x). |
| 9.1 | PASS | No `@sendgrid/mail` in code (legacy docs may mention SendGrid). |
| 9.2 | PASS | No `isMinor` in application/source; **historical migration SQL** still mentions dropped column—do not edit migrations. |
| 9.3 | PASS | No hardcoded `pk_*` / `sk_*` in TS/TSX source; test env uses `jest_clerk_secret_*` placeholder; `.env.example` files use conventional placeholders. |
| 9.4 | PASS | Prisma `5.16.0` in `packages/db/package.json`. |

**Remediation applied in this run:** (1) `test` scripts for web/mobile; (2) `express.raw()` scoped to `/api/v1/webhooks/clerk` with router `POST /`; (3) Jest files consolidated under `src/__tests__/`; (4) `loadTestEnv` Clerk secret placeholder avoids `sk_test_*` prefix; (5) `turbo.json` `pipeline` → `tasks`; (6) `type-check` scripts for `apps/web` and `packages/shared`; (7) resumption doc paths updated for `__tests__`.

**Final status:** Audit complete for P1-01–P1-03 criteria; repo aligned with this prompt. P1-04 guest code remains; next product milestone per roadmap is P1-05+.
