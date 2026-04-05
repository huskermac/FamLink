# FamLink

**The Family Operating System**

Cursor Prompt Library | Phase 1: Auth, Graph & Event Hub

Version 0.2 — Working Draft

March 2026 | CONFIDENTIAL

---

| Field | Value |
|---|---|
| Governing ADR | FamLink ADR v0.3 (authoritative — use this version for all Phase 1 prompts) |
| Governing PRD | FamLink PRD v0.1 |
| Prerequisite | Phase 0 complete; all migrations applied; Johnson family seed data loaded |
| Build Orders | 3 (Auth), 4 (Family Graph API), 5 (Invitation System), 6 (Event Hub API), 7 (Calendar API), 8 (Notification Service), 11 (Frontend Auth + Onboarding) |
| Prompt Range | P1-01 through P1-12 |
| Version | v0.2 — Comprehensive Jest/Supertest test suite added (P1-01 through P1-11); fixed P1-01 validateEnv.ts phantom file; fixed P1-02 guest route path; added Phase 2 frontend testing note to P1-12 |
| External Accounts | Clerk, Resend, Twilio, Firebase — all must be provisioned before relevant prompts |

---

# 1. Purpose & How to Use This Document

This document contains the sequenced Cursor prompt library for FamLink Phase 1. Phase 1 builds the complete backend API, authentication layer, notification infrastructure, and onboarding frontend. Each prompt is designed to be pasted directly into Cursor's Composer, producing a discrete, testable unit of the codebase.

## 1.1 The Claude → Cursor → Claude Workflow

| Phase | Tool | Action |
|---|---|---|
| Plan | Claude | Read this document. Understand the prompt objective, context, and acceptance criteria before opening Cursor. |
| Build | Cursor | Paste the prompt into Cursor Composer (Ctrl+Shift+I). Review generated code. Accept or iterate within Cursor. |
| Review | Claude | Paste the generated code back into Claude with: "Review this output against the FamLink ADR v0.3 and the acceptance criteria for [Prompt ID]." |

## 1.2 Critical Rules

- Never skip a prompt. Each prompt depends on the deliverables of the ones before it. The build dependency chain is strict.
- Do not modify the stack. All technology choices are LOCKED in ADR v0.3. If Cursor suggests an alternative library or pattern, reject it and reference the ADR.
- TypeScript strict mode is non-negotiable. Every file generated must compile with zero TypeScript errors.
- Claude review is mandatory. The review step catches architectural drift before it compounds. Do not merge without it.
- Commit after each prompt. Each accepted prompt output is a separate Git commit with a message referencing the Prompt ID (e.g., `feat(api): P1-01 Express API server foundation`).
- ADR v0.3 governs. If any conflict exists between this document and ADR v0.3, the ADR wins. Flag the conflict and resolve before proceeding.

---

# 2. Phase 0 → Phase 1 Handoff Notes

Phase 0 is complete. The following items are confirmed before Phase 1 begins.

## 2.1 Phase 0 Deliverables Confirmed

| Item | Status | Notes |
|---|---|---|
| Turborepo monorepo scaffold | DONE | apps/web, apps/mobile, apps/api, packages/shared, packages/db |
| Shared TypeScript types | DONE | @famlink/shared — all enums and interfaces |
| GitHub Actions CI | DONE | Lint, type-check, build on every PR |
| Prisma + Railway PostgreSQL | DONE | Connection verified; health check working |
| Core identity schema migration | DONE | persons, family_groups, households, family_members, household_members |
| Relationship graph migration | DONE | relationships table; RECIPROCAL_TYPES helper |
| Event/RSVP schema migration | DONE | events, event_invitations, rsvps, potluck_assignments |
| Johnson family seed data | DONE | 7 persons, full relationship graph, Thanksgiving event, dev-guest-token-dave |

## 2.2 Schema Change: age_gate_level (Applied Post-Phase 0)

Schema change applied — shared types must be updated in P1-01. After Phase 0 completed, ADR v0.3 resolved Open Q#4 (minor handling). The persons table was migrated: the `isMinor` boolean field was replaced with `age_gate_level` (enum: NONE, YOUNG_ADULT, MINOR) and a nullable `guardian_person_id` field was added. The database migration has been applied. However, the shared types in `packages/shared/src/types/person.ts` still reference `isMinor: boolean` and must be updated. P1-01 includes this fix as its first deliverable.

## 2.3 External Accounts Required for Phase 1

| Service | Account | Used In | Notes |
|---|---|---|---|
| Clerk | clerk.com | P1-02, P1-03 | Publishable key + Secret key required; webhook signing secret for P1-03 |
| Resend | resend.com | P1-10, P1-11 | API key required; domain verification recommended before P1-10 |
| Twilio | twilio.com | P1-10, P1-11 | Account SID + Auth Token + phone number required |
| Firebase | firebase.google.com | P1-11 | Service account JSON required for FCM push notifications |

---

# 3. Phase 1 Overview

Phase 1 covers ADR Build Orders 3, 4, 5, 6, 7, 8, and 11. It delivers a fully functional backend API with authentication, the complete family graph, event management, calendar, notifications, and the web onboarding flow.

| Prompt | Build Order | Depends On | Deliverable |
|---|---|---|---|
| P1-01 | 3 | P0-08 complete | Express API server foundation: server setup, middleware, health endpoint, env validation. Fix age_gate_level shared types. Testing infrastructure (Jest + Supertest). |
| P1-02 | 3 | P1-01 | Clerk integration in Next.js: middleware, ClerkProvider, sign-in/sign-up pages, protected routes |
| P1-03 | 3 | P1-01, P1-02 | Clerk integration in Express API: JWT auth middleware, user sync webhook (Clerk → Person table) |
| P1-04 | 3 | P1-03 | Guest token system: signed JWT generation, validation middleware, guest endpoints for Reluctant Members |
| P1-05 | 4 | P1-03 | Persons API: CRUD endpoints for person records, profile management |
| P1-06 | 4 | P1-05 | Family groups and households API: create/read/update family groups, households, and memberships |
| P1-07 | 4 | P1-06 | Relationships API: create with auto-reciprocal, read graph, delete both directions |
| P1-08 | 6 | P1-07 | Event Hub API: events CRUD, event invitations, RSVP management, potluck assignments, guest RSVP endpoints |
| P1-09 | 7 | P1-08 | Shared Calendar API: calendar views by month/week/list, birthday auto-population, upcoming events digest |
| P1-10 | 5 | P1-04, P1-08 | Invitation service: Resend email invitations, Twilio SMS invitations, RSVP link generation, guest token embedding |
| P1-11 | 8 | P1-10 | Notification service: unified dispatcher, Resend + Twilio + FCM channels, preference enforcement, all notification types |
| P1-12 | 11 | P1-03, P1-06, P1-10 | Frontend — Auth + Onboarding: sign up, sign in, create family flow, invite first members flow |

---

# 4. Prompts

## Prompt P1-01 — Express API Server Foundation

| Field | Value |
|---|---|
| Prompt ID | P1-01 |
| Build Order | Build Order 3 (partial) |
| Depends On | P0-08 complete and committed |
| Objective | Set up the apps/api Express server with TypeScript, core middleware, health endpoint, and environment variable validation. Fix the age_gate_level shared type change from ADR v0.3. Set up the Jest + Supertest testing infrastructure. |

### Context for Cursor

We are building the FamLink API server (`apps/api/`). The stack is:
- Node.js + Express with TypeScript strict mode (ADR-03)
- Prisma 5.16.0 ORM connecting to Railway PostgreSQL (ADR-04)
- Clerk for authentication — JWT middleware added in P1-03 (ADR-05)
- Zod for all request/response validation (ADR-03)
- REST API versioned at `/api/v1/` (ADR-03)

All files must be TypeScript. No JavaScript. Strict mode enabled. The monorepo root is `famlink/`. The API lives at `apps/api/`. `packages/db` exports the Prisma singleton as `{ db }`.

### Cursor Prompt

**Part A — Update shared types for age_gate_level (ADR v0.3 change):**

In `packages/shared/src/types/person.ts`, replace the `isMinor` boolean field with:

```typescript
export enum AgeGateLevel {
  NONE = "NONE",
  YOUNG_ADULT = "YOUNG_ADULT",
  MINOR = "MINOR",
}

export interface Person {
  id: string
  userId: string | null
  firstName: string
  lastName: string
  preferredName: string | null
  dateOfBirth: string | null
  ageGateLevel: AgeGateLevel  // replaces isMinor boolean
  guardianPersonId: string | null  // nullable FK to another Person
  profilePhotoUrl: string | null
  createdAt: string
  updatedAt: string
}
```

Export `AgeGateLevel` from `packages/shared/src/index.ts` barrel.

**Part B — Express API server:**

In `apps/api/`, create the following structure:

```
apps/api/
  src/
    server.ts         — Express app factory (exported for testing)
    index.ts          — Entry point: creates server, starts listener
    middleware/
      cors.ts         — CORS config (allow web app origin from env)
      errorHandler.ts — Global error handler middleware
      requestLogger.ts — Morgan HTTP request logging
    routes/
      health.ts       — GET /health route
      index.ts        — Router that mounts all /api/v1/* routes
    lib/
      env.ts          — Validated env config exported as const env
  package.json
  tsconfig.json
```

`apps/api/src/lib/env.ts`: Use Zod to parse and validate `process.env` at startup. Required variables:

```
DATABASE_URL          string
CLERK_SECRET_KEY      string
CLERK_WEBHOOK_SECRET  string
RESEND_API_KEY        string
TWILIO_ACCOUNT_SID    string
TWILIO_AUTH_TOKEN     string
TWILIO_PHONE_NUMBER   string
PORT                  string (default "3001")
NODE_ENV              string (default "development")
WEB_APP_URL           string (e.g. http://localhost:3000)
```

Export as: `export const env = { … }`. Throw a descriptive error and exit if any required variable is missing.

`apps/api/src/server.ts`: Create and export an Express app with this middleware stack (in order):
1. cors middleware (from cors.ts) — must run before all routes
2. `helmet()` — security headers
3. `express.json()` — JSON body parsing, limit: "10mb"
4. requestLogger (morgan "dev" in development, "combined" in production)
5. Mount router from `routes/index.ts` at "/"
6. 404 handler — returns `{ error: "Not found" }` with status 404
7. errorHandler middleware — last in stack

`apps/api/src/routes/health.ts`: GET `/health`
- Calls `checkDatabaseHealth()` from `@famlink/db`
- Returns 200 `{ status: "ok", db: "ok", timestamp: ISO string }` if db healthy
- Returns 503 `{ status: "error", db: "error", timestamp: ISO string }` if db unhealthy

`apps/api/src/routes/index.ts`: Create an Express Router. Mount `/health` from health.ts (no `/api/v1` prefix — health is top-level). Export the router. (Additional route groups will be added in P1-05 through P1-12.)

`apps/api/src/middleware/errorHandler.ts`: Standard Express error handler (4 arguments: err, req, res, next). In development: return `{ error: err.message, stack: err.stack }`. In production: return `{ error: "Internal server error" }`. Always log the error to `console.error`. HTTP status: `err.status` if present, otherwise 500.

`apps/api/package.json`:
- name: `"@famlink/api"`
- scripts: `dev: ts-node-dev --respawn --transpile-only src/index.ts`, `build: tsc`, `start: node dist/index.js`, `type-check: tsc --noEmit`
- dependencies: express, cors, helmet, morgan, zod
- devDependencies: @types/express, @types/cors, @types/morgan, @types/node, typescript, ts-node-dev
- Workspace dependency: `"@famlink/db": "*"`, `"@famlink/shared": "*"`

`apps/api/tsconfig.json`: Extend `packages/config/tsconfig.base.json`. Set `outDir: "./dist"`, `rootDir: "./src"`.

`apps/api/.env.example`: Include all variables defined in `env.ts` with placeholder values. Do NOT run `npm install`. Generate files only.

**Part C — Testing Infrastructure:**

Set up Jest + Supertest so all Phase 1 API prompts (P1-03 through P1-11) can generate and run tests against a real test database.

Add to `apps/api/package.json` devDependencies: jest, ts-jest, supertest, @types/jest, @types/supertest

Add to `apps/api/package.json` scripts:
- `test: jest --runInBand`
- `test:watch: jest --watch`
- `test:coverage: jest --coverage`

`apps/api/jest.config.ts`:

```typescript
import type { Config } from 'jest';
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  globalSetup: '<rootDir>/src/tests/setup/globalSetup.ts',
  globalTeardown: '<rootDir>/src/tests/setup/globalTeardown.ts',
  setupFilesAfterFramework: ['<rootDir>/src/tests/setup/afterEach.ts'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/tests/**'],
};
export default config;
```

`apps/api/src/tests/setup/globalSetup.ts`: Verify `TEST_DATABASE_URL` is set; throw descriptively if missing. Run `prisma migrate deploy` using `TEST_DATABASE_URL` to ensure schema is current.

`apps/api/src/tests/setup/globalTeardown.ts`: Disconnect Prisma client after all tests complete.

`apps/api/src/tests/setup/afterEach.ts`: After each test, truncate all data tables in dependency order (CASCADE):

```typescript
const tables = ['rsvps','event_invitations','potluck_assignments','events',
  'household_members','family_members','relationships','households',
  'family_groups','persons'];
for (const table of tables) {
  await db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
}
```

`apps/api/src/tests/helpers/auth.ts`: Export:
- `TEST_CLERK_ID: string = 'user_test_clerk_id_001'`
- `TEST_USER_2_CLERK_ID: string = 'user_test_clerk_id_002'`
- Export `mockClerkAuth(userId: string): jest.SpyInstance` — Mocks `getAuth` from `@clerk/express` to return `{ userId }`.
- Export `authedRequest(app: Express, clerkId?: string)`: supertest agent — Returns supertest agent with `Authorization: Bearer mock-token-for-<clerkId>`. Default clerkId is `TEST_CLERK_ID`.

`apps/api/src/tests/helpers/db.ts`:
- Export `seedTestPerson(overrides?)`: Creates Person with `userId: TEST_CLERK_ID`, `ageGateLevel: NONE`.
- Export `seedSecondPerson()`: Creates Person with `userId: TEST_USER_2_CLERK_ID`.
- Export `seedTestFamily(adminPersonId)`: Creates FamilyGroup + FamilyMember as ADMIN+ORGANIZER. Returns `{ familyGroup, membership }`.
- Export `seedTestEvent(familyGroupId, createdByPersonId, overrides?)`: Creates Event with future `startAt`.
- Export `seedGuestPerson(overrides?)`: Creates Person with `userId: null`.

Add `TEST_DATABASE_URL=postgresql://postgres:password@localhost:5432/famlink_test` to `apps/api/.env.example`.

### Acceptance Criteria

| | Acceptance Criterion |
|---|---|
| ☐ | AgeGateLevel enum exported from @famlink/shared with three values: NONE, YOUNG_ADULT, MINOR |
| ☐ | Person interface uses `ageGateLevel: AgeGateLevel` and `guardianPersonId: string | null` — `isMinor` boolean is removed |
| ☐ | packages/shared barrel (index.ts) exports AgeGateLevel |
| ☐ | `apps/api/src/lib/env.ts` validates all 9 required environment variables with Zod; throws on missing values |
| ☐ | `apps/api/src/server.ts` exports an Express app — does not call `app.listen()` (that is index.ts only) |
| ☐ | Middleware stack order is correct: cors → helmet → json → logger → routes → 404 → errorHandler |
| ☐ | GET /health returns `{ status: 'ok', db: 'ok', timestamp }` on success; 503 on DB failure |
| ☐ | `apps/api/tsconfig.json` extends `packages/config/tsconfig.base.json` |
| ☐ | `apps/api/.env.example` is present with all required variable names |
| ☐ | `tsc --noEmit` passes with zero errors in apps/api context |
| ☐ | No JavaScript files — TypeScript only throughout |
| ☐ | `apps/api/jest.config.ts` present and configured for ts-jest with `testEnvironment: 'node'` |
| ☐ | Test setup files present: globalSetup.ts, globalTeardown.ts, afterEach.ts |
| ☐ | afterEach.ts truncates all 10 data tables in correct dependency order |
| ☐ | Test helpers present: `src/tests/helpers/auth.ts` and `src/tests/helpers/db.ts` |
| ☐ | TEST_DATABASE_URL added to .env.example |
| ☐ | `npm test` runs without error (zero tests at this stage is acceptable) |

> **Claude Review Prompt — P1-01:** Paste `apps/api/src/server.ts`, `lib/env.ts`, `middleware/errorHandler.ts`, `routes/health.ts`, and the updated `packages/shared/src/types/person.ts` into Claude with: "Review P1-01 output against ADR v0.3. Check: (1) middleware stack order matches ADR-03, (2) env validation covers all services referenced in ADR-07, (3) age_gate_level type change is correctly implemented per ADR-05 v0.3 change, (4) no isMinor references remain anywhere."

---

## Prompt P1-02 — Clerk Integration in Next.js

| Field | Value |
|---|---|
| Prompt ID | P1-02 |
| Build Order | Build Order 3 |
| Depends On | P1-01 complete and committed |
| Objective | Integrate Clerk authentication into apps/web: middleware, ClerkProvider wrapper, sign-in and sign-up pages, and protected routes. |

### Context for Cursor

We are working in `apps/web/` — the Next.js 14 App Router application (ADR-01). Authentication is provided by Clerk (ADR-05). We are using `@clerk/nextjs`. The Clerk application is already provisioned. Environment variables are available. Google OAuth and Apple OAuth are enabled in the Clerk dashboard. The app uses TypeScript strict mode throughout.

### Cursor Prompt

Install `@clerk/nextjs` in `apps/web`.

`apps/web/.env.local` (document only — do not commit):
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/onboarding
```

`apps/web/.env.example`: Add all 6 Clerk variables with placeholder values.

`apps/web/middleware.ts` (at root of apps/web, not inside src/): Use `clerkMiddleware()` from `@clerk/nextjs/server`. Public routes (no auth required):
- `/` — marketing/landing page
- `/sign-in(.*)` — Clerk sign-in flow
- `/sign-up(.*)` — Clerk sign-up flow
- `/api/v1/guest/(.*)` — Guest RSVP endpoints

All other routes require authentication. Export the Clerk config matcher:
```
matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)','/(api|trpc)(.*)']
```

`apps/web/app/layout.tsx`: Wrap the root layout with `<ClerkProvider>`. ClerkProvider props: `publishableKey` from `process.env`, `afterSignInUrl`, `afterSignUpUrl`.

`apps/web/app/sign-in/[[...sign-in]]/page.tsx`: Import and render `<SignIn />` from `@clerk/nextjs`. Center the component on the page. Use the catch-all route pattern for Clerk's multi-step flows.

`apps/web/app/sign-up/[[...sign-up]]/page.tsx`: Import and render `<SignUp />` from `@clerk/nextjs`. Center the component on the page. Use the catch-all route pattern.

`apps/web/app/dashboard/page.tsx` (placeholder only): A protected page. Use `auth()` from `@clerk/nextjs/server` to get the userId. If not authenticated, redirect to `/sign-in`. Render a minimal placeholder: "Dashboard — {userId}" for now. This page will be replaced in P1-12.

`apps/web/app/onboarding/page.tsx` (placeholder only): A protected page. Show a minimal placeholder: "Onboarding — coming soon." This page will be replaced in P1-12.

`apps/web/lib/auth.ts`: Export a helper: `getCurrentUserId(): Promise<string>`. Implementation: calls `auth()` from `@clerk/nextjs/server`, throws an error if userId is null. This will be used throughout the app to get the authenticated user.

### Acceptance Criteria

| | Acceptance Criterion |
|---|---|
| ☐ | `apps/web/middleware.ts` uses `clerkMiddleware()` — not the deprecated `authMiddleware()` |
| ☐ | Public routes include `/sign-in(.*)`, `/sign-up(.*)`, `/`, and `/api/guest/(.*)` |
| ☐ | ClerkProvider wraps the root `layout.tsx` with the correct `publishableKey` |
| ☐ | Sign-in page uses `[[...sign-in]]` catch-all route — required for Clerk's multi-step flow |
| ☐ | Sign-up page uses `[[...sign-up]]` catch-all route |
| ☐ | Dashboard placeholder page calls `auth()` and redirects to `/sign-in` if unauthenticated |
| ☐ | `apps/web/.env.example` contains all 6 Clerk environment variable names |
| ☐ | `apps/web/lib/auth.ts` exports `getCurrentUserId()` helper |
| ☐ | `tsc --noEmit` passes with zero errors in apps/web context |
| ☐ | No Clerk secret key or publishable key is hardcoded — all from `process.env` |

> **Claude Review Prompt — P1-02:** Paste `apps/web/middleware.ts` and `apps/web/app/layout.tsx` into Claude with: "Review P1-02 output against ADR v0.3 ADR-05. Check: (1) middleware uses clerkMiddleware not deprecated authMiddleware, (2) /api/guest/* is correctly public for Reluctant Member RSVPs, (3) sign-in and sign-up use catch-all routes, (4) no Clerk keys are hardcoded."

---

## Prompt P1-03 — Clerk Integration in Express API

| Field | Value |
|---|---|
| Prompt ID | P1-03 |
| Build Order | Build Order 3 |
| Depends On | P1-01 and P1-02 complete and committed |
| Objective | Add Clerk JWT authentication middleware to the Express API and create the Clerk webhook endpoint that syncs new Clerk users to the Person table. |

### Context for Cursor

We are working in `apps/api/`. Clerk is the auth provider (ADR-05). The Express server is running (P1-01). The Prisma db singleton is available from `@famlink/db`. When a user signs up via Clerk, a webhook fires and we must create a corresponding Person record in our database. All API routes except `/health` and `/api/v1/webhooks/*` require a valid Clerk JWT in the Authorization header.

### Cursor Prompt

Install `@clerk/express` in `apps/api`.

`apps/api/src/middleware/requireAuth.ts`: Import `clerkMiddleware` and `getAuth` from `@clerk/express`. Export two middlewares:

1. `clerkAuth` — Apply `clerkMiddleware()` globally (added to server.ts middleware stack before routes, after cors/helmet/json/logger). This makes Clerk's auth context available on every request.
2. `requireAuth` — A middleware function that:
   - Calls `getAuth(req)` to extract auth state
   - If `userId` is null/undefined: return 401 `{ error: "Unauthorized" }`
   - If `userId` is present: attach to req as `(req as AuthedRequest).userId`
   - Calls `next()`

Export an `AuthedRequest` interface extending Express Request:
```typescript
interface AuthedRequest extends Request {
  userId: string
}
```

`apps/api/src/routes/webhooks.ts`: `POST /api/v1/webhooks/clerk`

This endpoint receives Clerk webhook events and syncs user data to the persons table.

Webhook verification:
- Use the Svix library (install `svix`) to verify the webhook signature.
- Read `CLERK_WEBHOOK_SECRET` from env.
- Verify using svix Webhook class: `wh.verify(rawBody, headers)`
- If verification fails: return 400 `{ error: "Invalid signature" }`
- Raw body is required for verification — use `express.raw()` middleware ONLY on this route (not on the global JSON middleware).

Handle these Clerk event types:

`user.created`:
- Extract: `clerkUserId` (data.id), `email` (data.email_addresses[0].email_address), `firstName` (data.first_name), `lastName` (data.last_name), `profilePhotoUrl` (data.image_url)
- Create a Person record using `db.person.upsert`: `where: { userId: clerkUserId }`, `create: { userId, firstName, lastName, ageGateLevel: "NONE", profilePhotoUrl }`, `update: { firstName, lastName, profilePhotoUrl }`
- Return 200 `{ received: true }`

`user.updated`:
- Same upsert as user.created — keeps names and photo in sync.
- Return 200 `{ received: true }`

All other event types: return 200 `{ received: true }` (acknowledge without processing).

Error handling: wrap in try/catch; return 500 on unexpected errors.

`apps/api/src/routes/index.ts`: Add the webhook router: `router.use('/api/v1/webhooks', webhooksRouter)`. IMPORTANT: The webhook route must use `express.raw()` for body parsing, not `express.json()`. The cleanest approach: in `server.ts`, add `express.raw({ type: 'application/json' })` ONLY for the `/api/v1/webhooks/clerk` path, before the global `express.json()` middleware.

Update `apps/api/src/server.ts`: Add `clerkAuth` middleware to the middleware stack, after logger and before routes. Add the raw body middleware for `/api/v1/webhooks/clerk` before `express.json()`.

Middleware stack order becomes: **cors → helmet → raw(webhooks only) → json → logger → clerkAuth → routes → 404 → errorHandler**

### Acceptance Criteria

| | Acceptance Criterion |
|---|---|
| ☐ | `clerkAuth` middleware applies `clerkMiddleware()` globally so auth context is available on all requests |
| ☐ | `requireAuth` middleware returns 401 if userId is null — not 403 |
| ☐ | `AuthedRequest` interface extends Express Request with `userId: string` |
| ☐ | `POST /api/v1/webhooks/clerk` verifies Svix signature before processing any event |
| ☐ | Webhook returns 400 if signature verification fails — does not process unverified events |
| ☐ | `user.created` event creates a Person with `ageGateLevel: 'NONE'` (not `isMinor`) |
| ☐ | `user.updated` event upserts the Person — idempotent, safe to replay |
| ☐ | Raw body middleware applies only to `/api/v1/webhooks/clerk`, not to all routes |
| ☐ | Middleware stack order in server.ts is correct per the spec above |
| ☐ | `tsc --noEmit` passes with zero errors in apps/api context |

### Tests — P1-03

Create `apps/api/src/tests/middleware/requireAuth.test.ts`:

- `it returns 401 when no Authorization header is present`: Do not call mockClerkAuth (getAuth returns `{ userId: null }`). `GET /api/v1/persons/me` → expect 401.
- `it returns 401 when Clerk JWT is invalid or expired`: Mock getAuth to return `{ userId: null }`. `GET /api/v1/persons/me` → expect 401.
- `it attaches userId to req and calls next() for valid auth`: Apply `mockClerkAuth(TEST_CLERK_ID)`. `GET /api/v1/persons/me` → expect status !== 401.

Create `apps/api/src/tests/routes/webhooks.test.ts`: Use real Svix Webhook to generate test signatures.

- `it returns 400 if Svix signature headers are missing`: POST without svix-id, svix-timestamp, svix-signature headers → 400
- `it returns 400 if Svix signature is invalid (wrong secret)`: POST with headers signed with wrong secret → 400
- `it user.created: creates Person with ageGateLevel NONE`: POST valid user.created payload → 200 `{ received: true }`. DB: person.ageGateLevel = 'NONE'.
- `it user.created: is idempotent (two calls produce one record)`: POST same user.created payload twice → 200 both times. DB: exactly one Person record.
- `it user.updated: updates firstName and lastName`: Seed person, POST user.updated with first_name: 'Updated'. DB: person.firstName = 'Updated'.
- `it unknown event type returns 200 without DB writes`: POST `{ type: 'session.created' }` → 200 `{ received: true }`. DB: person count unchanged.

### Acceptance Criteria — Tests

| | |
|---|---|
| ☐ | `src/tests/middleware/requireAuth.test.ts` with 3 test cases |
| ☐ | `src/tests/routes/webhooks.test.ts` with 6 test cases |
| ☐ | Webhook tests use real Svix signature generation — not a mock |
| ☐ | `user.created` idempotency test confirms exactly ONE DB record |
| ☐ | `npm test` passes with zero failures |

> **Claude Review Prompt — P1-03:** Paste `apps/api/src/middleware/requireAuth.ts`, `routes/webhooks.ts`, and the updated `server.ts` into Claude with: "Review P1-03 against ADR v0.3 ADR-05. Check: (1) raw body middleware is scoped only to the webhook route, (2) Svix verification is present and fails closed, (3) Person upsert uses ageGateLevel not isMinor, (4) middleware stack order is correct, (5) requireAuth correctly returns 401 for unauthenticated requests."

---

## Prompt P1-04 — Guest Token System

| Field | Value |
|---|---|
| Prompt ID | P1-04 |
| Build Order | Build Order 3 |
| Depends On | P1-03 complete and committed |
| Objective | Implement the signed JWT guest token system that allows Reluctant Members to RSVP and view events without creating a Clerk account. |

### Context for Cursor

We are working in `apps/api/`. The guest token system is a first-class architectural requirement (ADR-05). Reluctant Members (Uncle Dave persona) must be able to RSVP with a single link click — no account, no login. Guest tokens are signed JWTs separate from Clerk auth. They are generated when an invitation is sent and validated on guest endpoints. Guest endpoints live at `/api/v1/guest/*` and are NOT protected by `requireAuth`. The token encodes the minimum information needed to record a guest action.

### Cursor Prompt

Install `jsonwebtoken` and `@types/jsonwebtoken` in `apps/api`.

`apps/api/src/lib/guestToken.ts`: Add `GUEST_TOKEN_SECRET` to `env.ts`. Define the `GuestTokenPayload` interface:

```typescript
interface GuestTokenPayload {
  personId: string       // The Person record for this invitee
  scope: "RSVP" | "VIEW" | "JOIN"  // Permission scope
  resourceId: string     // eventId (RSVP/VIEW) or familyGroupId (JOIN)
  resourceType: "EVENT" | "FAMILY"
}
```

Export these functions:

`generateGuestToken(payload: GuestTokenPayload, expiresIn: string): string`
- Sign payload with `GUEST_TOKEN_SECRET` using HS256
- `expiresIn`: "48h" for event RSVPs, "7d" for family join invitations
- Include `iat` (issued at) in payload automatically (jwt default)
- Return the signed token string

`verifyGuestToken(token: string): GuestTokenPayload`
- Verify and decode the token using `GUEST_TOKEN_SECRET`
- Throw a descriptive error if invalid, expired, or tampered
- Return the decoded payload

`apps/api/src/middleware/guestAuth.ts`: Export `requireGuestToken` middleware:
- Read token from query param `?token=…` OR `Authorization` header Bearer value
- Prefer query param (used in SMS/email RSVP links)
- If no token: return 401 `{ error: "Guest token required" }`
- Call `verifyGuestToken(token)`
- If invalid/expired: return 401 `{ error: "Invalid or expired token" }`
- Attach decoded payload to request: `(req as GuestRequest).guest`
- Call `next()`

Export `GuestRequest` interface extending Express Request:
```typescript
interface GuestRequest extends Request {
  guest: GuestTokenPayload
}
```

`apps/api/src/routes/guest.ts`: These routes are accessible without a Clerk session. All routes validate the guest token via `requireGuestToken` middleware.

`GET /api/v1/guest/event`
- Reads: `req.guest.resourceId` (eventId), `req.guest.resourceType`
- Validates: resourceType must be "EVENT"
- Fetches event from DB with family group info, RSVP list (names only, not personal details), and the guest's own RSVP status
- Returns: `{ event, rsvpStatus, potluckAssignment }`

`POST /api/v1/guest/rsvp`
- Reads: `req.guest.personId`, `req.guest.resourceId` (eventId)
- Body schema (Zod): `{ status: "YES" | "NO" | "MAYBE" }`
- Upserts an RSVP record: `where: { eventId_personId: { eventId, personId } }`, `create: { eventId, personId, status, guestToken: token, respondedAt: now }`, `update: { status, respondedAt: now }`
- Returns: `{ rsvp, event: { title, startAt, location } }`

Add to `apps/api/src/routes/index.ts`:
```
router.use('/api/v1/guest', guestRouter)
```
(No `requireAuth` on this router — guest routes are public by design.)

Update `apps/api/.env.example`: Add `GUEST_TOKEN_SECRET=`

### Acceptance Criteria

| | Acceptance Criterion |
|---|---|
| ☐ | `GuestTokenPayload` interface has `personId`, `scope`, `resourceId`, `resourceType` fields |
| ☐ | `generateGuestToken` signs with HS256 and accepts an `expiresIn` parameter |
| ☐ | `verifyGuestToken` throws — does not return null — on invalid/expired tokens |
| ☐ | `requireGuestToken` reads token from query param first, then Authorization header |
| ☐ | `requireGuestToken` returns 401 (not 403) for missing or invalid tokens |
| ☐ | `GuestRequest` interface extends Express Request with `guest: GuestTokenPayload` |
| ☐ | `GET /api/v1/guest/event` does not expose other guests' personal details |
| ☐ | `POST /api/v1/guest/rsvp` uses upsert — recording the same RSVP twice is safe |
| ☐ | `POST /api/v1/guest/rsvp` validates status with Zod — rejects values outside YES/NO/MAYBE |
| ☐ | Guest routes are mounted WITHOUT `requireAuth` middleware |
| ☐ | `GUEST_TOKEN_SECRET` is added to `env.ts` validation and `.env.example` |
| ☐ | `tsc --noEmit` passes with zero errors |

### Tests — P1-04

Create `apps/api/src/tests/lib/guestToken.test.ts`:

- `it round-trips a valid payload (generate + verify)`: `generateGuestToken(payload, '48h')` → `verifyGuestToken` → decoded matches original payload
- `it throws on expired token`: `generateGuestToken(payload, '0s')`, await 10ms, `verifyGuestToken` → throws
- `it throws on tampered token (last 5 chars replaced)`: Tampered token → `verifyGuestToken` → throws
- `it throws if signed with wrong secret`: `jwt.sign` with 'wrong-secret' → `verifyGuestToken` → throws
- `it 48h RSVP token encodes correct exp - iat (~172800s)`: Decode token, expect `exp - iat` within 100s of `48*3600`

Create `apps/api/src/tests/middleware/guestAuth.test.ts`:

- `it returns 401 { error: 'Guest token required' } if no token`: GET `/api/v1/guest/event` without token → 401
- `it returns 401 { error: 'Invalid or expired token' } for bad token`: GET `/api/v1/guest/event?token=bad.token` → 401
- `it reads token from query param ?token=`: Valid token in query param → expect status !== 401
- `it reads token from Authorization: Bearer header`: Valid token in header → expect status !== 401

Create `apps/api/src/tests/routes/guest.test.ts`: Seed: guest person (userId null), family, event.

- `it GET /api/v1/guest/event returns event for valid RSVP-scope token`: → 200 `{ event, rsvpStatus: null }`
- `it GET /api/v1/guest/event returns 400 for FAMILY resourceType`: Token with `resourceType FAMILY` → 400
- `it GET /api/v1/guest/event returns 401 for expired token`: → 401
- `it GET /api/v1/guest/event does not expose other guests email or phone`: Seed second person with RSVP YES. Response must not contain email or phone fields.
- `it POST /api/v1/guest/rsvp records YES and returns event summary`: body: `{ status: 'YES' }` → 200, DB: RSVP created
- `it POST /api/v1/guest/rsvp is idempotent (POST YES then NO = one RSVP with NO)`: DB: exactly ONE RSVP with status NO
- `it POST /api/v1/guest/rsvp returns 400 for invalid status`: body: `{ status: 'SURE' }` → 400
- `it POST /api/v1/guest/rsvp returns 403 for VIEW-scope token`: Token with scope VIEW → 403

### Acceptance Criteria — Tests

| | |
|---|---|
| ☐ | `src/tests/lib/guestToken.test.ts` with 5 test cases incl. expiry and tamper |
| ☐ | `src/tests/middleware/guestAuth.test.ts` — covers both query param and header token sources |
| ☐ | `src/tests/routes/guest.test.ts` with 8 test cases |
| ☐ | Guest event test confirms no email or phone in response |
| ☐ | RSVP idempotency test confirms exactly ONE DB record |
| ☐ | VIEW-scope RSVP attempt returns 403 |
| ☐ | `npm test` passes with zero failures |

> **Claude Review Prompt — P1-04:** Paste `lib/guestToken.ts`, `middleware/guestAuth.ts`, and `routes/guest.ts` into Claude with: "Review P1-04 against ADR v0.3 ADR-05 guest token spec. Check: (1) verifyGuestToken throws not returns null, (2) requireGuestToken prefers query param over header, (3) guest RSVP endpoint returns 403 for VIEW scope, (4) event endpoint strips personal data from RSVP list, (5) no requireAuth on guest router."

---

## Prompt P1-05 — Persons API

| Field | Value |
|---|---|
| Prompt ID | P1-05 |
| Build Order | Build Order 4 |
| Depends On | P1-03 complete and committed |
| Objective | Create the authenticated CRUD endpoints for person records, including profile reads and updates. Persons can be created without a Clerk account to support children and Reluctant Members. |

### Context for Cursor

We are working in `apps/api/src/routes/`. All routes here require authentication via `requireAuth` middleware (ADR-05). The Person model in Prisma includes `ageGateLevel` and `guardianPersonId` (ADR v0.3). A person with `userId = null` is a family member without an account (child, guest, or Reluctant Member). The authenticated user can only read/write persons within family groups they belong to.

### Cursor Prompt

Create `apps/api/src/routes/persons.ts`. Define Zod schemas:

`CreatePersonSchema`:
- `firstName`: string, min 1
- `lastName`: string, min 1
- `preferredName`: string optional
- `dateOfBirth`: string optional (ISO date YYYY-MM-DD)
- `ageGateLevel`: enum ["NONE", "YOUNG_ADULT", "MINOR"], default "NONE"
- `guardianPersonId`: string optional (cuid)
- `profilePhotoUrl`: string optional (url)

`UpdatePersonSchema`: `CreatePersonSchema.partial()`

Endpoints (all require `requireAuth`):

`GET /api/v1/persons/me`
- Get the current user's Person record using userId from auth
- If no Person record exists for this Clerk userId: return 404 `{ error: "Person record not found — complete onboarding" }`
- Returns: Person record

`GET /api/v1/persons/:personId`
- Fetch a person by ID
- Authorization: requester must share at least one family group with the requested person. If not: return 403.
- Returns: Person record (omit guardianPersonId unless requester is the guardian or an admin of the family)

`POST /api/v1/persons`
- Create a new Person record for a family member without an account (e.g., adding a child, or adding Uncle Dave before he joins)
- `userId` is NOT set — this creates an account-less person record
- Body: `CreatePersonSchema`
- Returns 201: created Person record

`PUT /api/v1/persons/:personId`
- Update a person's profile
- Authorization: requester must be the person themselves (userId match) OR an admin of a shared family group
- Body: `UpdatePersonSchema`
- Returns: updated Person record

`GET /api/v1/persons/me/families`
- Get all family groups the current user belongs to
- Returns: array of `{ familyGroup, role, joinedAt }`

Add to `apps/api/src/routes/index.ts`:
```
router.use('/api/v1/persons', requireAuth, personsRouter)
```

### Acceptance Criteria

| | Acceptance Criterion |
|---|---|
| ☐ | `GET /api/v1/persons/me` returns 404 with a helpful message if no Person record exists (new user before onboarding) |
| ☐ | `GET /api/v1/persons/:id` returns 403 if requester shares no family group with the requested person |
| ☐ | `POST /api/v1/persons` creates a Person with `userId: null` — does not use the requester's Clerk userId |
| ☐ | `PUT /api/v1/persons/:id` enforces authorization — only self or family admin can update |
| ☐ | All bodies validated with Zod — invalid input returns 400 with a descriptive error |
| ☐ | `ageGateLevel` field uses the string enum values from ADR v0.3: NONE, YOUNG_ADULT, MINOR |
| ☐ | All routes are mounted under `requireAuth` — no unauthenticated access |
| ☐ | `tsc --noEmit` passes with zero errors |

### Tests — P1-05

Create `apps/api/src/tests/routes/persons.test.ts`. Use `authedRequest` + `mockClerkAuth` + db helpers throughout.

`GET /api/v1/persons/me`:
- it returns 404 with onboarding message when no Person record exists
- it returns 200 with person record when found

`GET /api/v1/persons/:personId`:
- it returns 200 when requester shares a family group with target
- it returns 403 when requester shares no family with target
- it returns 404 for nonexistent personId

`POST /api/v1/persons`:
- it creates person with `userId: null` (account-less family member)
- it returns 400 for missing required fields
- it returns 400 for invalid ageGateLevel value (e.g. 'CHILD')

`PUT /api/v1/persons/:personId`:
- it allows a user to update their own profile
- it allows a family ADMIN to update another family member
- it returns 403 when non-admin tries to update another member

`GET /api/v1/persons/me/families`:
- it returns all family groups with role and joinedAt

### Acceptance Criteria — Tests

| | |
|---|---|
| ☐ | `src/tests/routes/persons.test.ts` with all 12 test cases |
| ☐ | GET /me 404 test confirms error message contains 'onboarding' |
| ☐ | POST persons confirms `userId` is null on created record |
| ☐ | Cross-family 403 seeds two distinct families |
| ☐ | `npm test` passes with zero failures |

> **Claude Review Prompt — P1-05:** Paste `routes/persons.ts` into Claude with: "Review P1-05 against ADR v0.3. Check: (1) GET /me returns 404 not 500 for missing Person records, (2) authorization checks prevent cross-family data access, (3) ageGateLevel uses correct enum string values, (4) creating a person without userId correctly supports the Reluctant Member and minor profile patterns from ADR-05."

---

## Prompt P1-06 — Family Groups and Households API

| Field | Value |
|---|---|
| Prompt ID | P1-06 |
| Build Order | Build Order 4 |
| Depends On | P1-05 complete and committed |
| Objective | Create CRUD endpoints for family groups, households, and their memberships. The family group is the top-level container for the extended family. |

### Context for Cursor

We are working in `apps/api/src/routes/`. All routes require `requireAuth`. A `FamilyGroup` is the extended family container. A `Household` is a physical living unit within a family group. When a user creates a family group, they are automatically added as a `FamilyMember` with role ADMIN and role ORGANIZER. The Prisma models are `FamilyGroup`, `FamilyMember`, `Household`, and `HouseholdMember`.

### Cursor Prompt

Create `apps/api/src/routes/families.ts`. Define Zod schemas:

`CreateFamilySchema`: `name`: string, min 2, max 100

`UpdateFamilySchema`:
- `name`: string optional
- `aiEnabled`: boolean optional
- `defaultVisibility`: enum ["PRIVATE","HOUSEHOLD","FAMILY","INVITED","GUEST"] optional

`CreateHouseholdSchema`:
- `name`: string, min 1
- `street`, `city`, `state`, `zip`: string optional
- `country`: string optional, default "US"

`UpdateHouseholdSchema`: `CreateHouseholdSchema.partial()`

`AddMemberSchema`:
- `personId`: string (cuid)
- `roles`: array of string, min 1 (e.g. ["MEMBER"])
- `permissions`: array of string, default []

`AddHouseholdMemberSchema`:
- `personId`: string (cuid)
- `role`: string optional (e.g. "HEAD_OF_HOUSEHOLD", "DEPENDENT")

**Family Group Endpoints:**

`POST /api/v1/families`
- Get the requester's Person record (by Clerk userId)
- If not found: 400 `{ error: "Complete onboarding before creating a family" }`
- Create FamilyGroup with `createdById = person.id`
- Automatically create a FamilyMember record for the creator: `roles: ["ADMIN", "ORGANIZER"]`, `permissions: ["VIEW_EVENTS", "CREATE_EVENTS", "INVITE_MEMBERS", "MANAGE_MEMBERS", "MANAGE_SETTINGS"]`
- Returns 201: `{ familyGroup, membership }`

`GET /api/v1/families/:familyId`
- Authorization: requester must be a FamilyMember of this family
- Returns: `{ familyGroup, members: [{ person, roles, joinedAt }], households: [{ household, members: [person] }] }`

`PUT /api/v1/families/:familyId`
- Authorization: requester must have ADMIN role in this family
- Body: `UpdateFamilySchema`
- Returns: updated FamilyGroup

`POST /api/v1/families/:familyId/members`
- Authorization: requester must have `INVITE_MEMBERS` permission
- Body: `AddMemberSchema`
- The personId must already exist as a Person record
- Create FamilyMember record
- Returns 201: FamilyMember record

`DELETE /api/v1/families/:familyId/members/:personId`
- Authorization: requester must be ADMIN or be removing themselves
- Cannot remove the last ADMIN
- Delete FamilyMember record
- Returns 204

**Household Endpoints:**

`POST /api/v1/families/:familyId/households`
- Authorization: requester must be a FamilyMember with `CREATE_EVENTS` permission (or ADMIN)
- Body: `CreateHouseholdSchema`
- Returns 201: Household record

`PUT /api/v1/households/:householdId`
- Authorization: requester must be ADMIN of the household's family
- Body: `UpdateHouseholdSchema`
- Returns: updated Household

`POST /api/v1/households/:householdId/members`
- Authorization: requester must be ADMIN of the household's family
- Body: `AddHouseholdMemberSchema`
- The personId must already be a FamilyMember of the parent family
- Create HouseholdMember record
- Returns 201: HouseholdMember record

`DELETE /api/v1/households/:householdId/members/:personId`
- Authorization: requester must be ADMIN or the member themselves
- Delete HouseholdMember record
- Returns 204

Add to `apps/api/src/routes/index.ts`:
```
router.use('/api/v1/families', requireAuth, familiesRouter)
```

### Acceptance Criteria

| | Acceptance Criterion |
|---|---|
| ☐ | `POST /api/v1/families` automatically creates the creator as ADMIN + ORGANIZER FamilyMember |
| ☐ | `POST /api/v1/families` returns 400 (not 500) if the requester has no Person record |
| ☐ | `GET /api/v1/families/:id` returns 403 if requester is not a family member |
| ☐ | `DELETE /api/v1/families/:familyId/members/:personId` prevents removing the last ADMIN |
| ☐ | `POST /api/v1/households/:id/members` validates that personId is already a FamilyMember of the parent family |
| ☐ | All permission checks use the roles/permissions stored on FamilyMember — no hardcoded user IDs |
| ☐ | All Zod schemas validate inputs and return 400 with descriptive errors on failure |
| ☐ | `tsc --noEmit` passes with zero errors |

### Tests — P1-06

Create `apps/api/src/tests/routes/families.test.ts`:

`POST /api/v1/families`:
- it creates FamilyGroup + creator as ADMIN + ORGANIZER: 201
- it returns 400 if requester has no Person record (helpful onboarding message)
- it returns 400 for name shorter than 2 chars

`GET /api/v1/families/:familyId`:
- it returns family with members and households for a member
- it returns 403 for non-member

`PUT /api/v1/families/:familyId`:
- it allows ADMIN to update family name
- it returns 403 for non-admin member

`POST /api/v1/families/:familyId/members`:
- it adds a person as family member (requires INVITE_MEMBERS permission)
- it returns 403 without INVITE_MEMBERS permission

`DELETE /api/v1/families/:familyId/members/:personId`:
- it allows member to remove themselves: 204
- it prevents removing the last ADMIN (error references 'admin' or 'last')

Household endpoints:
- it POST creates household: 201
- it POST household/members rejects personId not in parent family: 400
- it DELETE household member: 204

### Acceptance Criteria — Tests

| | |
|---|---|
| ☐ | `src/tests/routes/families.test.ts` with all 13 test cases |
| ☐ | Last-admin deletion test confirms error references admin constraint |
| ☐ | Household member cross-family rejection test present |
| ☐ | `npm test` passes with zero failures |

> **Claude Review Prompt — P1-06:** Paste `routes/families.ts` into Claude with: "Review P1-06 against ADR v0.3. Check: (1) family creator is correctly bootstrapped as ADMIN+ORGANIZER, (2) authorization checks are consistent across all endpoints, (3) the last-admin guard is present on member removal, (4) household member addition validates family membership, (5) no N+1 query patterns on the GET family endpoint."

---

## Prompt P1-07 — Relationships API

| Field | Value |
|---|---|
| Prompt ID | P1-07 |
| Build Order | Build Order 4 |
| Depends On | P1-06 complete and committed |
| Objective | Create the relationships API that manages edges in the family graph. Creating a relationship automatically creates its reciprocal. Deleting removes both directions atomically. |

### Context for Cursor

We are working in `apps/api/src/routes/`. The family relationship graph uses directed edges stored in the `Relationship` table (ADR-04). Reciprocal mapping is available from `packages/db/src/relationship-helpers.ts` (`RECIPROCAL_TYPES`). Both directions of a relationship must be maintained. All persons in a relationship must be members of the specified `familyGroupId`.

### Cursor Prompt

Create `apps/api/src/routes/relationships.ts`. Import `RECIPROCAL_TYPES` from `@famlink/db`.

Define Zod schemas:

`CreateRelationshipSchema`:
- `fromPersonId`: string (cuid)
- `toPersonId`: string (cuid)
- `type`: enum of all 19 RelationshipType values from ADR-04: SPOUSE, PARTNER, EX_SPOUSE, PARENT, CHILD, STEP_PARENT, STEP_CHILD, ADOPTIVE_PARENT, ADOPTIVE_CHILD, SIBLING, HALF_SIBLING, STEP_SIBLING, GRANDPARENT, GRANDCHILD, AUNT_UNCLE, NIECE_NEPHEW, COUSIN, CAREGIVER, GUARDIAN, FAMILY_FRIEND
- `notes`: string optional

Endpoints (all require `requireAuth`):

`POST /api/v1/families/:familyId/relationships`
- Authorization: requester must be a FamilyMember of this family
- Validate: `fromPersonId` and `toPersonId` are both FamilyMembers of this family. If not: 400 `{ error: "Both persons must be family members" }`
- Validate: `fromPersonId !== toPersonId`. If same: 400.
- Create the primary relationship: `{ fromPersonId, toPersonId, type, familyGroupId, notes }`
- Look up `reciprocalType = RECIPROCAL_TYPES[type]`
- If `reciprocalType` is not null: Create the reciprocal relationship: `{ fromPersonId: toPersonId, toPersonId: fromPersonId, type: reciprocalType, familyGroupId, notes }`
- Use a Prisma transaction to create both atomically.
- If `@@unique` constraint violation: 409 `{ error: "Relationship already exists" }`
- Returns 201: `{ relationship, reciprocal: relationship | null }`

`GET /api/v1/families/:familyId/relationships`
- Authorization: requester must be a FamilyMember
- Returns: all relationships in this family group with person details for `fromPerson` and `toPerson`

`GET /api/v1/persons/:personId/relationships`
- Authorization: requester must share a family group with personId
- Returns: all relationships where `fromPersonId = personId`, including the related person's name and ageGateLevel

`DELETE /api/v1/relationships/:relationshipId`
- Authorization: requester must be a FamilyMember of the relationship's family group
- Find the relationship by ID
- Find the reciprocal relationship: `where: { fromPersonId: rel.toPersonId, toPersonId: rel.fromPersonId, familyGroupId: rel.familyGroupId }`
- Delete both in a Prisma transaction
- Returns 204

Add to `apps/api/src/routes/index.ts`: Mount relationships under `/api/v1/families`, `/api/v1/persons`, and `/api/v1/relationships` (for the delete endpoint).

### Acceptance Criteria

| | Acceptance Criterion |
|---|---|
| ☐ | POST creates both the primary and reciprocal relationship in a single Prisma transaction |
| ☐ | CAREGIVER and GUARDIAN relationships create no reciprocal (RECIPROCAL_TYPES maps them to null) |
| ☐ | POST returns 400 if either person is not a member of the family group |
| ☐ | POST returns 409 on duplicate relationship (@@unique violation), not 500 |
| ☐ | DELETE removes both directions in a single Prisma transaction |
| ☐ | `GET /families/:id/relationships` includes `fromPerson` and `toPerson` details — not just IDs |
| ☐ | All 19 RelationshipType values are included in the Zod enum |
| ☐ | `tsc --noEmit` passes with zero errors |

### Tests — P1-07

Create `apps/api/src/tests/routes/relationships.test.ts`. Seed two persons in the same family for all write tests.

`POST /api/v1/relationships`:
- it SPOUSE: creates exactly 2 DB records (both directions)
- it PARENT_CHILD: creates PARENT_CHILD + CHILD_PARENT reciprocal
- it CAREGIVER: creates exactly 1 DB record (no reciprocal)
- it GUARDIAN: creates exactly 1 DB record (no reciprocal)
- it duplicate relationship returns 409 (not 500)
- it invalid type returns 400
- it self-referential relationship returns 400

`GET /api/v1/persons/:personId/relationships`:
- it returns relationships for person in same family
- it returns 403 for person in different family

`DELETE /api/v1/relationships/:id`:
- it deletes both directions for bidirectional relationship (SIBLING)
- it deletes only one record for CAREGIVER

### Acceptance Criteria — Tests

| | |
|---|---|
| ☐ | `src/tests/routes/relationships.test.ts` with all 11 test cases |
| ☐ | SPOUSE test confirms exactly 2 DB records |
| ☐ | CAREGIVER test confirms exactly 1 DB record |
| ☐ | Duplicate returns 409 not 500 |
| ☐ | Self-referential returns 400 |
| ☐ | `npm test` passes with zero failures |

> **Claude Review Prompt — P1-07:** Paste `routes/relationships.ts` into Claude with: "Review P1-07 against ADR v0.3 ADR-04 relationship type registry. Check: (1) both directions created atomically in a transaction, (2) CAREGIVER and GUARDIAN correctly produce no reciprocal, (3) duplicate detection returns 409 not 500, (4) DELETE removes both directions, (5) all 19 relationship types are in the Zod schema."

---

## Prompt P1-08 — Event Hub API

| Field | Value |
|---|---|
| Prompt ID | P1-08 |
| Build Order | Build Order 6 |
| Depends On | P1-07 complete and committed |
| Objective | Create the complete Event Hub API: event CRUD, event invitations, RSVP management, and potluck assignments. Includes the guest token generation flow for Reluctant Members. |

### Context for Cursor

We are working in `apps/api/src/routes/`. Events belong to a FamilyGroup. The Event model includes `isBirthdayEvent` and `birthdayPersonId` for auto-generated birthday events. RSVPs support both authenticated users and guests (via `guestToken` from P1-04). The guest RSVP endpoint was created in P1-04 — this prompt handles the authenticated RSVP endpoints. All dates are stored as UTC ISO strings.

### Cursor Prompt

Create `apps/api/src/routes/events.ts`. Define Zod schemas:

`CreateEventSchema`:
- `title`: string, min 1, max 200
- `description`: string optional
- `startAt`: string (ISO datetime)
- `endAt`: string optional (ISO datetime)
- `locationName`: string optional
- `locationAddress`: string optional
- `locationMapUrl`: string optional (url)
- `visibility`: enum ["PRIVATE","HOUSEHOLD","FAMILY","INVITED","GUEST"], default "FAMILY"
- `isRecurring`: boolean, default false

`UpdateEventSchema`: `CreateEventSchema.partial()`

`SendInvitationsSchema`:
- `scope`: enum ["INDIVIDUAL","HOUSEHOLD","FAMILY"]
- `personIds`: array of string (cuid), optional (used when scope=INDIVIDUAL)
- `householdIds`: array of string (cuid), optional (used when scope=HOUSEHOLD)

`UpdateRsvpSchema`: `{ status: enum ["YES","NO","MAYBE"] }`

`PotluckItemSchema`:
- `item`: string, min 1
- `quantity`: number optional, int, min 1
- `notes`: string optional
- `personId`: string optional (cuid) — null means unassigned

Endpoints (all require `requireAuth` unless noted):

`POST /api/v1/families/:familyId/events`
- Authorization: requester must be a FamilyMember with `CREATE_EVENTS` permission or ADMIN role
- Create Event with `createdByPersonId = requester's Person.id`
- Returns 201: Event record

`GET /api/v1/events/:eventId`
- Authorization: requester must be a FamilyMember of the event's family group OR have a valid guest token for this event
- Returns: `{ event, invitations: count, rsvps: { YES, NO, MAYBE, PENDING }, potluckAssignments }`

`PUT /api/v1/events/:eventId`
- Authorization: requester must be the event creator or family ADMIN
- Body: `UpdateEventSchema`
- Returns: updated Event

`DELETE /api/v1/events/:eventId`
- Authorization: requester must be the event creator or family ADMIN
- Hard delete with cascade (MVP)
- Returns 204

`POST /api/v1/events/:eventId/invitations`
- Authorization: requester must be a FamilyMember with `INVITE_MEMBERS` permission
- Body: `SendInvitationsSchema`
- For scope `FAMILY`: create EventInvitation records for all FamilyMembers; also create RSVP records with status PENDING for each person
- For scope `HOUSEHOLD`: create invitations for members of specified households
- For scope `INDIVIDUAL`: create invitations for specified personIds
- For each invited Person without a `userId` (Reluctant Member or child): generate a `guestToken` using `generateGuestToken()` with `scope "RSVP"`, `resourceType "EVENT"`, `expiresIn "48h"`. Attach the token to their RSVP record.
- Returns 201: `{ invited: count, guestTokensGenerated: count }`

`GET /api/v1/events/:eventId/rsvps`
- Authorization: FamilyMember of the event's family
- Returns: `{ rsvps grouped by status, each with person firstName, lastName, and guestToken presence indicator (boolean) }`

`PUT /api/v1/events/:eventId/rsvp` (authenticated RSVP)
- Authorization: requireAuth
- Body: `UpdateRsvpSchema`
- Upsert RSVP for requester's Person
- Returns: updated RSVP

`POST /api/v1/events/:eventId/potluck`
- Authorization: event creator or family ADMIN
- Body: array of `PotluckItemSchema`
- Upsert potluck assignments (replace all existing for this event — deleteMany then createMany in transaction)
- Returns: array of PotluckAssignment records

### Acceptance Criteria

| | Acceptance Criterion |
|---|---|
| ☐ | `POST /api/v1/events/:id/invitations` generates `guestTokens` for persons without `userId` — tokens are stored on `RSVP.guestToken` |
| ☐ | Guest tokens generated for invitations use `scope 'RSVP'`, `resourceType 'EVENT'`, `expiresIn '48h'` |
| ☐ | `GET /api/v1/events/:id` returns RSVP counts by status — not raw RSVP records with personal data |
| ☐ | `PUT /api/v1/events/:id/rsvp` is an upsert — a person can change their RSVP |
| ☐ | `POST /api/v1/events` (create) stores `createdByPersonId` as Person.id not Clerk userId |
| ☐ | POST potluck replaces all existing assignments atomically (deleteMany then createMany in transaction) |
| ☐ | All Zod schemas return 400 with descriptive messages on invalid input |
| ☐ | `tsc --noEmit` passes with zero errors |

### Tests — P1-08

Create `apps/api/src/tests/routes/events.test.ts`. Seed person, family, and events as needed.

`POST /api/v1/events`:
- it creates event and returns 201
- it returns 400 for missing required fields
- it returns 403 for non-member

`GET /api/v1/events/:eventId`:
- it returns event details for family member
- it returns 403 for non-member

`PUT /api/v1/events/:eventId`:
- it allows organizer to update: 200
- it returns 403 for non-organizer member

`POST /api/v1/events/:eventId/invite`:
- it generates guest token for userId-null person (body.guestToken present)
- it does NOT generate token for userId-present person

`POST /api/v1/events/:eventId/rsvp`:
- it creates RSVP with status YES
- it is idempotent: POST YES then NO = exactly ONE RSVP with status NO

`GET /api/v1/events/:eventId/rsvps`:
- it returns counts and names — no email or phone field in any response item

`PUT /api/v1/events/:eventId/potluck`:
- it replaces assignment atomically: old assignment absent, new one present in DB

`DELETE /api/v1/events/:eventId`:
- it allows organizer to delete: 204, DB record removed

### Acceptance Criteria — Tests

| | |
|---|---|
| ☐ | `src/tests/routes/events.test.ts` with all 14 test cases |
| ☐ | Guest token test confirms present for userId-null, absent for account holder |
| ☐ | RSVP idempotency test confirms ONE DB record after two POSTs |
| ☐ | RSVP list test confirms no email or phone fields |
| ☐ | Potluck test confirms old assignment removed from DB |
| ☐ | `npm test` passes with zero failures |

> **Claude Review Prompt — P1-08:** Paste `routes/events.ts` into Claude with: "Review P1-08 against ADR v0.3 and PRD Module 2. Check: (1) invitation flow generates guest tokens for userId-null persons, (2) RSVP upsert is idempotent, (3) GET event RSVP list exposes counts not raw personal data, (4) potluck replacement is atomic, (5) authorization is enforced on all write endpoints."

---

## Prompt P1-09 — Shared Calendar API

| Field | Value |
|---|---|
| Prompt ID | P1-09 |
| Build Order | Build Order 7 |
| Depends On | P1-08 complete and committed |
| Objective | Create the calendar API endpoints that power the unified family calendar view: monthly queries, upcoming events, and auto-generated birthday events (in-memory, never written to DB). |

### Context for Cursor

We are working in `apps/api/src/routes/`. The calendar aggregates events across the family graph: family-level events, household-level events, and auto-generated birthday events. Birthday events are NOT stored in the database — they are generated on-the-fly from `Person.dateOfBirth` values and returned as synthetic event objects with `isBirthdayEvent: true`. All datetimes are UTC. The PRD requires month, week, and list views.

### Cursor Prompt

Create `apps/api/src/routes/calendar.ts`.

Create `apps/api/src/lib/birthdayGenerator.ts`:

Export function `generateBirthdayEvents(persons: Array<{ id: string, firstName: string, lastName: string, dateOfBirth: string | null }>, year: number): SyntheticBirthdayEvent[]`

Where `SyntheticBirthdayEvent` is:
```typescript
{
  id: string               // "birthday-{personId}-{year}"
  title: string            // "{firstName}'s Birthday"
  startAt: string          // ISO datetime: DOB month/day in given year
  endAt: string            // same day, end of day
  isBirthdayEvent: true
  birthdayPersonId: string
  visibility: "FAMILY"
  familyGroupId: string    // passed in
}
```

Implementation:
- Iterate persons with non-null `dateOfBirth`
- For each, extract month and day from DOB
- Set the event date to that month/day in the requested year
- Skip persons whose birthday falls on Feb 29 in non-leap years (use Feb 28 instead)

**Calendar Endpoints** (all require `requireAuth`):

`GET /api/v1/families/:familyId/calendar`
- Query params: `month: string YYYY-MM` (required)
- Authorization: FamilyMember of this family
- Compute: startOfMonth, endOfMonth from the month param
- Fetch all Events where: `familyGroupId = familyId` AND `startAt >= startOfMonth` AND `startAt < endOfMonth` AND visibility in the requester's allowed tiers
- Get all FamilyMembers with their Person records (for birthdays)
- Generate birthday events for this month using birthdayGenerator
- Merge real events and birthday events; sort by `startAt` ascending
- Returns: `{ month, events: [...real events, ...birthday events] }`

`GET /api/v1/families/:familyId/calendar/upcoming`
- Query params: `days: number`, default 30, max 90
- Authorization: FamilyMember
- Fetch events from now to now + days; generate birthday events for the relevant month range; merge, deduplicate, sort by `startAt`
- Returns: `{ events, generatedAt: ISO timestamp }`
- Primary use: weekly digest emails (Grandparent persona — PRD Module 3)

`GET /api/v1/families/:familyId/calendar/birthdays`
- Authorization: FamilyMember
- Get all FamilyMembers with non-null `dateOfBirth`
- Return sorted by upcoming birthday (next occurrence relative to today)
- Include: `daysUntilBirthday` (0 = today, negative = already passed this year)
- Returns: `{ birthdays: [{ person, nextBirthday, daysUntilBirthday }] }`
- Primary use: birthday reminder feature and birthday calendar layer

### Acceptance Criteria

| | Acceptance Criterion |
|---|---|
| ☐ | Birthday events are generated in-memory — no birthday events are written to the database |
| ☐ | Synthetic birthday event IDs follow the pattern `'birthday-{personId}-{year}'` — deterministic and stable |
| ☐ | Feb 29 birthdays are correctly handled in non-leap years (use Feb 28) |
| ☐ | GET /calendar merges and sorts real events and birthday events by `startAt` |
| ☐ | GET /calendar/upcoming correctly applies the days limit (default 30, max 90) |
| ☐ | GET /calendar/birthdays includes `daysUntilBirthday` calculated relative to today (UTC) |
| ☐ | Visibility filtering on calendar events respects the requester's access tier |
| ☐ | `tsc --noEmit` passes with zero errors |

### Tests — P1-09

Create `apps/api/src/tests/lib/birthdayGenerator.test.ts`:

- it returns birthdays sorted by next upcoming occurrence (ascending days)
- it wraps correctly at year boundary (Dec 25 birthday, today is Dec 30 — next is next year)
- it Feb 28 birthday in non-leap year: present in results
- it Feb 29 birthday in non-leap year: mapped to Feb 28
- it Feb 29 birthday in leap year: appears on Feb 29
- it persons with null dateOfBirth are excluded

Create `apps/api/src/tests/routes/calendar.test.ts`. Spy on db to verify birthday events are not DB-written.

`GET /api/v1/calendar` (month view):
- it returns events in range (2 of 3 seeded events)
- it birthday events absent from `db.event.create` call history

`GET /api/v1/calendar/birthdays`:
- it returns birthdays sorted by soonest next occurrence

`GET /api/v1/calendar/upcoming`:
- it returns only events within next 7 days (2 of 3: one is in 30 days)

### Acceptance Criteria — Tests

| | |
|---|---|
| ☐ | `src/tests/lib/birthdayGenerator.test.ts` with 6 test cases incl. both leap year scenarios |
| ☐ | `src/tests/routes/calendar.test.ts` with 6 test cases |
| ☐ | Test confirms `db.event.create` never called during calendar fetch |
| ☐ | HOUSEHOLD visibility test seeds non-member and confirms exclusion |
| ☐ | `npm test` passes with zero failures |

> **Claude Review Prompt — P1-09:** Paste `routes/calendar.ts` and `lib/birthdayGenerator.ts` into Claude with: "Review P1-09 against ADR v0.3 and PRD Module 3. Check: (1) birthday events are never written to DB, (2) Feb 29 leap year handling is correct, (3) visibility filtering is applied before returning events, (4) GET /calendar/birthdays correctly sorts by next upcoming occurrence."

---

## Prompt P1-10 — Invitation Service

| Field | Value |
|---|---|
| Prompt ID | P1-10 |
| Build Order | Build Order 5 |
| Depends On | P1-04 and P1-08 complete and committed |
| Objective | Build the invitation delivery service: Resend for email invitations, Twilio for SMS invitations. Generates RSVP links containing guest tokens for Reluctant Members. |

### Context for Cursor

We are working in `apps/api/src/lib/`. The invitation service sends event invitations to family members via email (Resend) and SMS (Twilio) per ADR-07. Resend is the email provider (NOT SendGrid — SendGrid was replaced in ADR v0.3). The RSVP link format is: `{WEB_APP_URL}/rsvp?token={guestToken}`. This link is included in both email and SMS invitations for guests. Authenticated users get a link to the event page directly.

### Cursor Prompt

Install: `resend`, `twilio` in `apps/api`.

Create `apps/api/src/lib/invitationService.ts`. Define these types:

```typescript
InvitationRecipient: {
  personId: string
  firstName: string
  email: string | null
  phone: string | null
  guestToken: string | null  // present for userId-null persons
  isGuest: boolean           // true if userId is null
}

EventInvitationPayload: {
  event: { title: string; startAt: string; locationName: string | null }
  familyName: string
  inviterName: string
  recipients: InvitationRecipient[]
}
```

Export class `InvitationService`:
- constructor: initializes Resend client and Twilio client from env
- `async sendEventInvitations(payload: EventInvitationPayload): Promise<{ emailsSent: number, smsSent: number, errors: string[] }>`
  - For each recipient:
    - If email is present: Send email via Resend
    - If phone is present AND `isGuest` is true: Send SMS via Twilio
    - Collect errors but do not throw — return partial success
- `private buildEventInviteEmail(recipient, payload): string` — Returns HTML with:
  - Event title, date/time (formatted human-readable), location
  - If `guestToken` present: a prominent "RSVP Now" button linking to `{WEB_APP_URL}/rsvp?token={guestToken}`
  - If no guestToken (authenticated user): link to `{WEB_APP_URL}/events/{eventId}`
  - FamLink branding (simple, clean HTML — no external CSS frameworks)
- `private buildEventInviteSms(recipient, payload): string` — Returns a string max 160 characters:
  `"{inviterName} invited you to {event.title} on {date}. RSVP: {WEB_APP_URL}/rsvp?token={guestToken}"`. If over 160 chars: truncate `event.title` to fit.

Create `apps/api/src/lib/familyInvitationService.ts`. Export `async function sendFamilyJoinInvitation(params: { inviterName: string; familyName: string; recipientEmail: string | null; recipientPhone: string | null; recipientFirstName: string; guestToken: string })`:
- Send email (if email present) via Resend: Subject: `"{inviterName} invited you to join {familyName} on FamLink"`. Include join link: `{WEB_APP_URL}/join?token={guestToken}`
- Send SMS (if phone present) via Twilio: `"{inviterName} invited you to join {familyName} on FamLink. Accept: {WEB_APP_URL}/join?token={guestToken}"`

### Acceptance Criteria

| | Acceptance Criterion |
|---|---|
| ☐ | Resend client uses `RESEND_API_KEY` from env — not SendGrid, no other email provider |
| ☐ | Twilio client uses `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` from env |
| ☐ | `sendEventInvitations` returns partial success — a single delivery failure does not throw |
| ☐ | RSVP link uses `WEB_APP_URL` from env — not hardcoded localhost or domain |
| ☐ | SMS body is max 160 characters — event title truncated to fit if necessary |
| ☐ | Email HTML is self-contained — no external CDN or framework dependencies |
| ☐ | Family join invitation uses 7-day token expiry (not 48h) |
| ☐ | `tsc --noEmit` passes with zero errors |

### Tests — P1-10

Create `apps/api/src/tests/lib/invitationService.test.ts`. Mock Resend and Twilio clients with `jest.mock()`. No real API calls.

Email (Resend):
- it calls Resend — not SendGrid — for email delivery: Confirm no `@sendgrid/mail` import in invitationService.ts
- it generates RSVP link using `WEB_APP_URL` from env: Mock `env.WEB_APP_URL = 'https://test.famlink.app'`. Confirm link in email contains this URL.
- it handles partial failure — sends remaining emails if one throws: Mock Resend to throw on 2nd of 3 calls. Expect 2 emails sent, 1 error in results.

SMS (Twilio):
- it SMS body is 160 characters or fewer: Capture SMS body from Twilio mock; `expect(body.length).toBeLessThanOrEqual(160)`
- it SMS RSVP link uses `WEB_APP_URL`: Confirm SMS body contains `env.WEB_APP_URL` origin

Token expiry:
- it family join invitation token has 7-day expiry: Decode generated token; `expect(exp - iat)` within 100s of `7*24*3600`
- it event RSVP token has 48-hour expiry: Decode generated token; `expect(exp - iat)` within 100s of `48*3600`

### Acceptance Criteria — Tests

| | |
|---|---|
| ☐ | `src/tests/lib/invitationService.test.ts` with all 7 test cases |
| ☐ | Test confirms no `@sendgrid/mail` import in invitationService.ts |
| ☐ | SMS length test confirms <= 160 characters |
| ☐ | Partial failure test confirms 3 Resend calls despite mid-call failure |
| ☐ | Token expiry tests confirm 48h for events, 7d for family joins |
| ☐ | `npm test` passes with zero failures |

> **Claude Review Prompt — P1-10:** Paste `lib/invitationService.ts` and `lib/familyInvitationService.ts` into Claude with: "Review P1-10 against ADR v0.3 ADR-07. Check: (1) Resend is used — not SendGrid, (2) partial failure handling is correct — one bad email does not abort all others, (3) SMS is 160 char max, (4) RSVP link construction uses WEB_APP_URL from env, (5) family join token correctly uses 7-day expiry per ADR-05."

---

## Prompt P1-11 — Notification Service

| Field | Value |
|---|---|
| Prompt ID | P1-11 |
| Build Order | Build Order 8 |
| Depends On | P1-10 complete and committed |
| Objective | Build the unified notification service that dispatches all notification types across Resend (email), Twilio (SMS), and Firebase Cloud Messaging (push). Enforces per-user channel preferences. |

### Context for Cursor

We are working in `apps/api/src/lib/`. The notification service is a unified dispatcher (ADR-07). It sits above the invitation service and handles all non-invitation notifications: RSVP received, event reminders, birthday reminders, weekly digest. It reads `NotificationPreference` records to determine which channels are enabled per user. Resend handles email, Twilio handles SMS, Firebase Admin SDK handles push notifications.

### Cursor Prompt

Install: `firebase-admin` in `apps/api`.

Create `apps/api/src/lib/notificationService.ts`.

Add to `env.ts`:
- `FIREBASE_PROJECT_ID: string`
- `FIREBASE_CLIENT_EMAIL: string`
- `FIREBASE_PRIVATE_KEY: string` (the full PEM key from service account JSON)

Define types:

```typescript
NotificationPayload: {
  type: "EVENT_INVITE" | "RSVP_RECEIVED" | "EVENT_REMINDER" | "BIRTHDAY_REMINDER" | "FAMILY_JOIN" | "WEEKLY_DIGEST"
  recipientPersonId: string
  title: string
  body: string
  data?: Record<string, string>  // extra data for push payloads
  emailHtml?: string             // rich HTML for email channel
}

DeliveryResult: {
  channel: "EMAIL" | "SMS" | "PUSH"
  success: boolean
  error?: string
}
```

Initialize Firebase Admin SDK: Use `admin.initializeApp()` with credential from service account env vars. Guard against re-initialization (`check admin.apps.length`).

Export class `NotificationService`:
- constructor: initializes Resend, Twilio, Firebase Admin from env
- `async send(payload: NotificationPayload): Promise<DeliveryResult[]>`
  1. Fetch the recipient Person record
  2. Fetch `NotificationPreference` records for this person and type
  3. For each channel (EMAIL, SMS, PUSH): If preference exists AND enabled = true: attempt delivery. If no preference record exists: use channel defaults:
     - EMAIL: enabled by default for all users
     - SMS: enabled only for Reluctant Members (`userId = null`)
     - PUSH: enabled for users with a registered FCM token
  4. Collect DeliveryResult for each attempted channel
  5. Return all results — do not throw on partial failure
- `private async sendEmail(to: string, title: string, body: string, html?: string): Promise<void>` — Send via Resend
- `private async sendSms(to: string, body: string): Promise<void>` — Send via Twilio. Truncate body to 160 chars.
- `private async sendPush(fcmToken: string, title: string, body: string, data?: Record<string, string>): Promise<void>` — Send via Firebase Admin `messaging.send()`
- `async scheduleEventReminder(eventId: string, minutesBefore: number): Promise<void>` — Fetch event and all confirmed RSVPs (status = YES). For each confirmed person: send a notification of type `EVENT_REMINDER`. (For MVP, called directly — cron scheduling deferred to Phase 2.)
- `async sendWeeklyDigest(familyGroupId: string): Promise<void>` — Fetch upcoming events for the next 7 days. Fetch birthdays in the next 7 days using `birthdayGenerator`. For each FamilyMember: send `WEEKLY_DIGEST` notification via email.

### Acceptance Criteria

| | Acceptance Criterion |
|---|---|
| ☐ | Firebase Admin SDK is initialized once — re-initialization guard is present |
| ☐ | `FIREBASE_PRIVATE_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` added to `env.ts` |
| ☐ | `send()` fetches `NotificationPreference` records before dispatching — preferences are enforced |
| ☐ | Default channel behavior: EMAIL on by default; SMS only for userId-null persons; PUSH only if FCM token present |
| ☐ | `send()` returns `DeliveryResult[]` — partial failure does not throw |
| ☐ | `sendSms()` truncates to 160 characters |
| ☐ | `scheduleEventReminder` only sends to confirmed attendees (status = YES) |
| ☐ | `sendWeeklyDigest` uses `birthdayGenerator` (from P1-09) for upcoming birthdays |
| ☐ | `tsc --noEmit` passes with zero errors |

### Tests — P1-11

Create `apps/api/src/tests/lib/notificationService.test.ts`. Mock Resend, Twilio, Firebase with `jest.mock()`. No real API calls.

Channel routing:
- it routes EMAIL to Resend — not SendGrid: Confirm no `@sendgrid/mail` import. `sendNotification({ channel: 'EMAIL', ... })` → Resend called, Twilio/FCM not called
- it routes SMS to Twilio: `sendNotification({ channel: 'SMS', ... })` → Twilio called, Resend/FCM not called
- it routes PUSH to Firebase: `sendNotification({ channel: 'PUSH', ... })` → Firebase called, Resend/Twilio not called

Preference enforcement:
- it does not send EMAIL when user EMAIL preference is disabled: Seed person with EMAIL pref = false → Resend NOT called
- it does not send SMS when user SMS preference is disabled: Seed person with SMS pref = false → Twilio NOT called
- it sends EMAIL by default when no preference record exists: No NotificationPreference row → Resend called

Firebase init guard:
- it calls `initializeApp` exactly once even if init called twice: Call `initializeFirebase()` twice; confirm `admin.apps.length` = 1

SMS targeting:
- it sends SMS to userId-null persons with a phone number: Seed guest person (userId null) with phone. `sendNotification` → Twilio called

Weekly digest:
- it `sendWeeklyDigest` calls `birthdayGenerator` with family persons: Mock `birthdayGenerator`; call `sendWeeklyDigest`. Confirm mock was called with correct persons array.

### Acceptance Criteria — Tests

| | |
|---|---|
| ☐ | `src/tests/lib/notificationService.test.ts` with all 10 test cases |
| ☐ | Test confirms no `@sendgrid/mail` import in notificationService.ts |
| ☐ | All three channels have dedicated routing tests |
| ☐ | Preference enforcement: channel NOT called when pref disabled |
| ☐ | Firebase re-init guard: `initializeApp` called exactly once |
| ☐ | `sendWeeklyDigest` calls `birthdayGenerator` |
| ☐ | `npm test` passes with zero failures |

> **Claude Review Prompt — P1-11:** Paste `lib/notificationService.ts` into Claude with: "Review P1-11 against ADR v0.3 ADR-07. Check: (1) all three channels are present: Resend, Twilio, FCM, (2) NotificationPreference enforcement is correct with correct defaults, (3) Firebase re-initialization guard is present, (4) SMS defaults to userId-null persons only, (5) no SendGrid code present anywhere."

---

## Prompt P1-12 — Frontend: Auth & Onboarding UI

| Field | Value |
|---|---|
| Prompt ID | P1-12 |
| Build Order | Build Order 11 |
| Depends On | P1-03, P1-06, and P1-10 complete and committed |
| Objective | Build the Next.js onboarding flow: the first-run experience after sign-up where the Organizer creates their family group, creates their first household, and invites initial family members. |

> **Note — Frontend Testing Deferred:** React Testing Library tests for this flow are intentionally deferred to Phase 2. See Appendix at end of document for the Phase 2 frontend test plan.

### Context for Cursor

We are working in `apps/web/`. The Organizer persona is the primary user of this flow. After signing up via Clerk (P1-02), a new user is redirected to `/onboarding`. They must: (1) create their Person profile, (2) create a FamilyGroup, (3) create a Household, (4) invite first members. This flow must work on both desktop and mobile web. Styling uses Tailwind CSS and shadcn/ui components. State is managed with React state (`useState`) — no external state management needed for this flow. API calls go to the Express API at the URL defined by `NEXT_PUBLIC_API_URL` env variable.

### Cursor Prompt

Add to `apps/web/.env.example`:
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Create `apps/web/lib/api.ts`: A typed API client for making authenticated requests to `apps/api`.

Export `async function apiFetch<T>(path: string, options?: RequestInit): Promise<T>`:
- Base URL from `process.env.NEXT_PUBLIC_API_URL`
- For server components: use `await auth()` from `@clerk/nextjs/server` to get a token, attach as `Authorization: Bearer {token}`
- `Content-Type: application/json`
- Throw descriptive errors on non-2xx responses (include status code and response body in error message)

Create the onboarding flow at `apps/web/app/onboarding/`:

`page.tsx` — Onboarding coordinator (client component):
- Check if user already has a family: `GET /api/v1/persons/me/families`
- If families exist: redirect to `/dashboard`
- Renders a step-by-step wizard with progress indicator (e.g., "Step 2 of 4")
- Steps: Step 1: Your Profile | Step 2: Create Your Family | Step 3: Your Household | Step 4: Invite Family Members

`steps/ProfileStep.tsx` (client component):
- Fields: `firstName` (required), `lastName` (required), `preferredName` (optional), `dateOfBirth` (optional)
- On submit: `POST /api/v1/persons` with the profile data
- On success: advance to Step 2

`steps/FamilyStep.tsx` (client component):
- Fields: `familyName` (required, e.g., "The Johnson Family")
- Hint text: "This is the name your family will see when they join."
- On submit: `POST /api/v1/families { name: familyName }`
- On success: store `familyGroupId` in state; advance to Step 3

`steps/HouseholdStep.tsx` (client component):
- Fields: `householdName` (required, e.g., "Sarah & Tom's House"), `city` (optional), `state` (optional)
- On submit: `POST /api/v1/families/{familyGroupId}/households`
- On success: advance to Step 4

`steps/InviteStep.tsx` (client component):
- Allow adding up to 10 initial invitees
- Each invitee: `firstName` (required), `email` (optional), `phone` (optional) — at least one of email or phone required per invitee
- "Add another person" button
- "Skip for now" option — goes to dashboard without inviting
- On submit (if invitees present): For each invitee: `POST /api/v1/persons`, then `POST /api/v1/families/{familyGroupId}/members`
- On complete: redirect to `/dashboard`

All steps:
- Use shadcn/ui components: Input, Button, Label, Card
- Show loading states on submit buttons (button disabled while request is in-flight)
- Show inline validation errors
- Be responsive (mobile-friendly)

Update `apps/web/app/dashboard/page.tsx`: Replace placeholder with:
- "Welcome, {firstName}!" heading
- Upcoming events count (`GET /api/v1/families/{id}/calendar/upcoming`)
- Quick links: Create Event, View Calendar, Invite Members
- If no family yet: redirect to `/onboarding`

### Acceptance Criteria

| | Acceptance Criterion |
|---|---|
| ☐ | `apiFetch` attaches a Clerk Bearer token on every request — no unauthenticated API calls from server components |
| ☐ | Onboarding page checks for existing families and redirects to `/dashboard` if setup is already complete |
| ☐ | Step 1 (Profile) calls `POST /api/v1/persons` before advancing — profile must be saved |
| ☐ | Step 2 (Family) calls `POST /api/v1/families` and stores `familyGroupId` in state for use in Steps 3 and 4 |
| ☐ | Step 4 (Invite) includes a Skip button — onboarding can complete without inviting anyone |
| ☐ | All form fields use shadcn/ui components and show inline validation errors |
| ☐ | All steps show loading state on submit — button disabled while request is in-flight |
| ☐ | Dashboard page shows meaningful content — not just a user ID placeholder |
| ☐ | `NEXT_PUBLIC_API_URL` is from env — not hardcoded |
| ☐ | `tsc --noEmit` passes with zero errors in apps/web context |

> **Claude Review Prompt — P1-12:** Paste `apps/web/app/onboarding/page.tsx` and all step components into Claude with: "Review P1-12 against ADR v0.3 and PRD user journey 7.1 (Organizer Sets Up). Check: (1) apiFetch correctly attaches Clerk token, (2) onboarding redirect logic prevents re-running setup, (3) family creation stores familyGroupId for subsequent steps, (4) invite step is skippable per PRD Reluctant Member requirements, (5) no hardcoded API URLs."

---

# 5. Phase 1 Completion Checklist

Phase 1 is complete when all of the following are true:

| | Acceptance Criterion |
|---|---|
| ☐ | P1-01: Express API server running; health endpoint returns 200; age_gate_level in shared types |
| ☐ | P1-02: Clerk sign-in and sign-up working in Next.js; middleware protecting authenticated routes |
| ☐ | P1-03: Clerk JWT validation in Express; user.created webhook creating Person records |
| ☐ | P1-04: Guest token generation and validation working; POST /api/v1/guest/rsvp tested with dev-guest-token-dave |
| ☐ | P1-05: Persons API complete; GET /api/v1/persons/me returns correct data for signed-in user |
| ☐ | P1-06: Family groups and households API complete; creator bootstrapped as ADMIN+ORGANIZER |
| ☐ | P1-07: Relationships API complete; reciprocal creation verified; RECIPROCAL_TYPES applied correctly |
| ☐ | P1-08: Event Hub API complete; invitations generate guest tokens for userId-null persons |
| ☐ | P1-09: Calendar API complete; birthday events generated in-memory; Feb 29 handling verified |
| ☐ | P1-10: Invitation service complete; Resend email delivery verified; Twilio SMS verified |
| ☐ | P1-11: Notification service complete; all three channels tested; preference enforcement working |
| ☐ | P1-12: Onboarding flow complete; Organizer can sign up, create family, and invite first member end-to-end |
| ☐ | Zero TypeScript errors across all packages (`turbo type-check` passing) |
| ☐ | Claude review completed for each prompt before marking complete |
| ☐ | All prompts committed with Prompt ID in the commit message |
| ☐ | ADR v0.3 confirmed as governing reference — no ADR deviations introduced |

---

# 6. Phase 1 → Phase 2 Handoff

When Phase 1 is complete, Phase 2 begins at Build Orders 9, 10, 12, 13, 14, 15, and 16. Phase 2 delivers the AI assistant, all frontend feature UIs, and the Expo mobile app.

| Build Order | Module | Phase |
|---|---|---|
| 9 | AI Context Assembler | Phase 2 |
| 10 | AI Assistant API | Phase 2 |
| 12 | Frontend — Family Graph UI | Phase 2 |
| 13 | Frontend — Event Hub UI | Phase 2 |
| 14 | Frontend — Calendar UI | Phase 2 |
| 15 | Frontend — AI Assistant UI | Phase 2 |
| 16 | Mobile app (Expo) | Phase 2 |

> **Reminder: Save this document to the FamLink Claude Project.** Before starting Phase 2, add this document and ADR v0.3 to the FamLink Claude Project so both are persistently available. Phase 2 prompts will reference ADR decisions, Phase 0 schema, and Phase 1 API endpoints directly. The Cursor Prompt Library for Phase 2 will be generated when Phase 1 is confirmed complete.

---

*FamLink Cursor Prompt Library v0.1 — Phase 1 — March 2026 — CONFIDENTIAL*

*All prompts are derived from ADR v0.3 and PRD v0.1. If any conflict exists between this document and ADR v0.3, the ADR governs.*

---

## Appendix: Frontend Testing Plan (Phase 2)

Scope: React Testing Library (RTL) + Jest tests for `apps/web` Next.js frontend. Add when Phase 2 frontend development begins.

Dependencies to add to `apps/web` devDependencies:
- `@testing-library/react`
- `@testing-library/jest-dom`
- `@testing-library/user-event`
- `jest-environment-jsdom`

Test coverage targets for Phase 2:

**Sign-in redirect:** Unauthenticated visit to `/dashboard` redirects to `/sign-in`. Mock Clerk `auth()` to return null userId.

**Sign-up flow:** ClerkProvider wraps root layout. `/sign-up` renders the Clerk SignUp component.

**Create family flow:** Form validation fires on submit with empty name. Valid name triggers `POST /api/v1/families`. Successful creation redirects to `/dashboard`.

**Invite first members flow:** Adding a member by email renders confirmation state. Adding a member by SMS renders confirmation state. Form resets after successful invitation send.
