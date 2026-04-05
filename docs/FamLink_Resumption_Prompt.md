# FamLink — Session Resumption Prompt

Paste this entire document at the start of a new Claude session to resume work.

---

## Context

I am the founder of **FamLink** ("The Family Operating System") — a private, graph-based family coordination platform. I am building the MVP with AI-assisted development using Cursor as the primary coding tool and Claude for planning, review, and architecture.

My background is senior manager / architect. Limited hands-on engineering. Direct, minimal-sycophancy feedback is preferred.

---

## Governing Documents (in project knowledge)

All architectural and product decisions are governed by two source-of-truth documents. Corrected versions were produced in the last session and are in project files:

| Document | Version | Notes |
|---|---|---|
| PRD | v0.1 | Product requirements; personas; feature scope; roadmap |
| ADR | v0.3 | All locked technical decisions; open questions; build dependency map |
| Phase 1 Cursor Prompt Library | **v0.2** | Base prompts P1-01–P1-04; continuation through P1-12 is in `docs/FamLink_CursorPromptLibrary_Phase1_P1-05_to_P1-12.md` (Restart Edition, April 2026) |

---

## Tech Stack (all LOCKED per ADR v0.3)

- **Monorepo:** Turborepo + npm workspaces
- **Frontend:** Next.js 14.2.35 (App Router) + TypeScript strict
- **Mobile:** React Native + Expo (managed workflow)
- **Backend:** Node.js + Express + TypeScript
- **ORM:** Prisma **pinned at 5.16.0** (do not upgrade)
- **Database:** PostgreSQL via Railway; Redis via Railway
- **Auth:** Clerk (social OAuth + guest token system)
- **Email:** Resend (NOT SendGrid — replaced in ADR v0.3)
- **SMS:** Twilio
- **Push:** Firebase Cloud Messaging (FCM)
- **AI SDK:** Vercel AI SDK; primary model Anthropic Claude Sonnet; fallback GPT-4o
- **Hosting:** Vercel (frontend) + Railway (backend + DB)
- **Testing:** Jest + ts-jest + Supertest (added in Prompt Library v0.2)

---

## Build Phase Status

### Phase 0 — COMPLETE
All 8 prompts (P0-01 through P0-08) executed and committed. Migrations applied to live Railway PostgreSQL. Johnson family seed data loaded.

### Phase 1 — IN PROGRESS
Working from **Phase 1 Cursor Prompt Library v0.2**.

| Prompt | Deliverable | Status |
|---|---|---|
| P1-01 | Express API server foundation + Jest/Supertest test infrastructure | **DONE** |
| P1-02 | Clerk integration in Next.js (middleware, ClerkProvider, sign-in/up pages) | **DONE** |
| P1-03 | Clerk integration in Express API (JWT middleware + webhook sync) | **DONE — see notes below** |
| P1-04 | Guest token system (Reluctant Member RSVP without account) | **DONE** — code in repo; run `npm test` with valid `TEST_DATABASE_URL` before commit |
| P1-05 | Persons API | **DONE** (committed — see P1-05 notes below) |
| P1-06 | Family Groups and Households API | **DONE** |
| P1-07 | Relationships API | **DONE** (see P1-07 notes below) |
| P1-08 | Event Hub API | **DONE** (see P1-08 notes below) |
| P1-09 | Shared Calendar API | **DONE** (see P1-09 notes below) |
| P1-10 | Invitation Service | **DONE** (see P1-10 notes below) |
| P1-11 | Notification Service | **DONE** (see P1-11 notes below) |
| P1-12 | Frontend — Auth + Onboarding UI | **DONE** (see P1-12 notes below) |

---

## P1-05 Completion Notes (April 2026)

Implemented per `docs/FamLink_CursorPromptLibrary_Phase1_P1-05_to_P1-12.md` Section 4 (Persons API).

- **Routes:** `apps/api/src/routes/persons.ts` — Zod-validated CRUD: `GET /me`, `GET /me/families`, `POST /`, `GET /:personId`, `PUT /:personId`; static routes registered before `/:personId`.
- **Mount:** `apps/api/src/routes/index.ts` — `router.use("/api/v1/persons", requireAuth, personsRouter)`.
- **Tests:** `apps/api/src/__tests__/routes/persons.test.ts` (plus updates to `requireAuth.test.ts`).
- **Harness:** `jest.config.ts` — `testTimeout: 60_000` for Railway + seeds; `guest.test.ts` — `jest.mock("@clerk/express")` so guest tests do not require a valid Clerk publishable key at runtime; `seedTestFamily` uses `db.$transaction` in `__tests__/helpers/db.ts`.

**Verification:** `npm test` in `apps/api` — 39 tests passing; `npm run type-check` at repo root — clean.

**Optional:** Run the Claude Review Prompt for P1-05 from the prompt library when you return.

---

## P1-07 Completion Notes (April 2026)

Implemented per Section 4 (P1-07 — Relationships API) in `docs/FamLink_CursorPromptLibrary_Phase1_P1-05_to_P1-12.md`.

- **Routes:** `apps/api/src/routes/relationships.ts` — `familyRelationshipsRouter` (POST/GET `/:familyId/relationships`), `personRelationshipsRouter` (GET `/:personId/relationships`), `relationshipsRouter` (DELETE `/:relationshipId`). Uses `RECIPROCAL_TYPES` from `@famlink/db` (exported in `packages/db/src/index.ts`; rebuild `@famlink/db` after changing exports).
- **Mount order:** `apps/api/src/routes/index.ts` — `personRelationshipsRouter` before `personsRouter` on `/api/v1/persons`; `familyRelationshipsRouter` after `familiesRouter` on `/api/v1/families`; `relationshipsRouter` on `/api/v1/relationships`.
- **Tests:** `apps/api/src/__tests__/routes/relationships.test.ts` — reciprocal PARENT/CHILD, CAREGIVER without reciprocal, 400 non-member, 409 duplicate, GET graph, GET person list, DELETE both edges.

**Verification:** `npm test` in `apps/api` — **73** tests passing (full suite as of P1-11); `npm run type-check` at repo root — clean.

**Optional:** Claude Review Prompt for P1-07 from the prompt library.

---

## P1-08 Completion Notes (April 2026)

Implemented per Section 4 (P1-08 — Event Hub API) in `docs/FamLink_CursorPromptLibrary_Phase1_P1-05_to_P1-12.md`.

- **Routes:** `apps/api/src/routes/events.ts` — `familyEventsRouter`: `POST /:familyId/events` (CREATE_EVENTS); `eventsRouter` on `/api/v1/events`: `GET/PUT/DELETE /:eventId`, `POST /:eventId/invitations`, `GET /:eventId/rsvps`, `PUT /:eventId/rsvp`, `POST /:eventId/potluck`. Guest tokens via `generateGuestToken` (`RSVP` / `EVENT` / `48h`) for `userId`-null invitees, stored on `rSVP.guestToken`.
- **Mount:** `index.ts` — `familyEventsRouter` on `/api/v1/families` (after relationship router); `eventsRouter` on `/api/v1/events`.
- **Tests:** `apps/api/src/__tests__/routes/events.test.ts`.

**Verification:** `npm test` in `apps/api` — **73** tests passing (full suite as of P1-11); `npm run type-check` at repo root — clean.

**Optional:** Claude Review Prompt for P1-08 from the prompt library.

---

## P1-09 Completion Notes (April 2026)

Implemented per Section 4 (P1-09 — Shared Calendar API) in `docs/FamLink_CursorPromptLibrary_Phase1_P1-05_to_P1-12.md`.

- **Lib:** `apps/api/src/lib/birthdayGenerator.ts` — `SyntheticBirthdayEvent`, `birthdayMonthDayInYear` (Feb 29 → Feb 28 in non-leap years), `generateBirthdayEvents` (in-memory only; ids `birthday-{personId}-{year}`).
- **Routes:** `apps/api/src/routes/calendar.ts` — `GET /:familyId/calendar?month=YYYY-MM`, `GET /:familyId/calendar/upcoming?days=` (default 30, max 90), `GET /:familyId/calendar/birthdays`. More specific paths registered before `/:familyId/calendar`.
- **Mount:** `index.ts` — `calendarRouter` on `/api/v1/families` (with other family routers).
- **Tests:** `apps/api/src/__tests__/lib/birthdayGenerator.test.ts`, `apps/api/src/__tests__/routes/calendar.test.ts`.

**Verification:** `npm test` in `apps/api` — **73** tests passing (full suite as of P1-11); `npm run type-check` at repo root — clean.

**Optional:** Claude Review Prompt for P1-09 from the prompt library.

---

## P1-11 Completion Notes (April 2026)

Implemented per Section 4 (P1-11 — Notification Service) in `docs/FamLink_CursorPromptLibrary_Phase1_P1-05_to_P1-12.md`.

- **Lib:** `apps/api/src/lib/notificationService.ts` — `NotificationService.send()` loads `Person` + `NotificationPreference` rows; enforces channel defaults (EMAIL on; SMS only when `userId` is null; PUSH only when `fcmToken` set); returns `DeliveryResult[]` without throwing on partial failure; SMS truncated to 160 chars. Resend from `notifications@{RESEND_FROM_DOMAIN}`; Twilio + Firebase Admin (FCM) with `admin.apps.length` guard before `initializeApp`.
- **Schema:** `Person.email`, `Person.phone`, `Person.fcmToken` (migration `20260405180000_person_notification_contact_fields`). Clerk webhook sets `email` from `email_addresses` on `user.created` / `user.updated`.
- **Env:** `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (PEM; `\n` escaped in `.env` supported). `loadTestEnv.ts` includes a throwaway PKCS#8 key for Jest. Documented in `apps/api/.env.example`.
- **Methods:** `scheduleEventReminder(eventId, minutesBefore)` — RSVP `YES` only; `sendWeeklyDigest(familyGroupId)` — next 7 days events + `generateBirthdayEvents` (P1-09) for birthdays, email HTML digest.
- **Deps:** `firebase-admin` in `apps/api/package.json`.
- **Tests:** `apps/api/src/__tests__/lib/notificationService.test.ts`.

**Verification:** `npm test` in `apps/api` — **73** tests passing; `npm run type-check` at repo root — clean.

**Optional:** Claude Review Prompt for P1-11 from the prompt library.

---

## P1-12 Completion Notes (April 2026)

Implemented per **P1-12 — Frontend: Auth + Onboarding UI** in `docs/FamLink_CursorPromptLibrary_Phase1_P1-05_to_P1-12.md`.

- **API:** `POST /api/v1/persons` links the first `Person` to the Clerk user (`userId`); additional POSTs create invitees with `userId: null` (tests in `apps/api/src/__tests__/routes/persons.test.ts`).
- **Web lib:** `apps/web/lib/api.ts` — `apiFetch` with `Authorization: Bearer` and `NEXT_PUBLIC_API_URL`.
- **Onboarding:** `apps/web/app/onboarding/page.tsx` — client wizard: `GET /me/families` → redirect to `/dashboard` if any; `GET /me` for profile prefill and `personId`; steps Profile → Family → Household → Invite (`app/onboarding/steps/*`). UI primitives under `apps/web/components/ui/`.
- **Dashboard:** `apps/web/app/dashboard/page.tsx` — server page using `auth()` + `apiFetch`: welcome line, primary family name, 30-day upcoming event count, quick links (placeholders / onboarding for invites).
- **Env:** `NEXT_PUBLIC_API_URL` in `apps/web/.env.example` (e.g. `http://localhost:3001`).

**Invite step:** Email/phone are collected for UX only; current `Person` model stores invitees without contact fields on the person row (known gap until extended).

**Verification:** `npm run type-check` in `apps/web` — clean. Run `npm run build` in `apps/web` locally; if the build fails on `/404` with `<Html> should not be imported outside of pages/_document`, that error is unrelated to P1-12 files (no `next/document` imports in app source) — investigate dependencies or Next config.

**Optional:** Claude Review Prompt for P1-12 from the prompt library.

---

## P1-10 Completion Notes (April 2026)

Implemented per Section 4 (P1-10 — Invitation Service) in `docs/FamLink_CursorPromptLibrary_Phase1_P1-05_to_P1-12.md`.

- **Lib:** `apps/api/src/lib/invitationService.ts` — Resend email + Twilio SMS for event invites; links use `WEB_APP_URL` (`/rsvp?token=` for guests with token, `/events/:eventId` for members); bulk sends return partial success (`emailsSent`, `smsSent`, `errors[]`). Guest SMS only when `isGuest` and `guestToken` present.
- **Lib:** `apps/api/src/lib/familyInvitationService.ts` — family join email/SMS with `{WEB_APP_URL}/join?token=...`; join token lifetime is enforced by the caller (e.g. 7-day semantics).
- **Env:** `RESEND_FROM_DOMAIN` (required) — from address `invites@{domain}`; documented in `apps/api/.env.example`. Test default in `loadTestEnv.ts`.
- **Deps:** `resend`, `twilio` in `apps/api/package.json`.
- **Tests:** `apps/api/src/__tests__/lib/invitationService.test.ts` (mocked providers).

**Verification:** `npm test` in `apps/api` — **73** tests passing (full suite as of P1-11); `npm run type-check` at repo root — clean.

**Optional:** Claude Review Prompt for P1-10 from the prompt library.

---

## P1-03 Completion Notes

P1-03 was executed in Cursor and produced working output. Four items were identified and resolved:

1. **Webhook middleware ordering** — Confirmed correct. Raw body middleware is scoped to `/api/v1/webhooks/clerk` only, runs before `express.json()` and before `clerkAuth`. This is intentional for Svix signature verification.

2. **`loadTestEnv.ts`** — Cursor added this file beyond the spec. It sets env variable defaults before `server.ts` is imported in Jest, preventing `process.exit()` on missing env vars during tests. Confirmed it must be in `setupFiles` in `jest.config.ts` (runs before module imports), NOT in `setupFilesAfterFramework`.

3. **Test database (P1001 error)** — Resolved. `famlink_test` database has been created on Railway. `TEST_DATABASE_URL` is set in `apps/api/.env.test`. Schema migration applied. `npm test` should now be runnable.

4. **Clerk dashboard webhook** — Pending manual setup. Register `https://<deployed-host>/api/v1/webhooks/clerk` in Clerk dashboard, subscribe to `user.created` and `user.updated`, and copy the signing secret to `CLERK_WEBHOOK_SECRET` in Railway env vars. Not blocking P1-04; blocking end-to-end user sync in staging/prod.

**P1-03 test status:** 9 test cases (3 in `requireAuth.test.ts`, 6 in `webhooks.test.ts`). **P1-04** adds tests under `src/__tests__/lib/`, `src/__tests__/middleware/`, and `src/__tests__/routes/guest.test.ts`. Re-run `npm test` with a valid Railway `TEST_DATABASE_URL` to confirm the full suite.

---

## Immediate Next Actions

1. **Pull latest** if you work from another machine: `main` should include through **P1-12** once committed (`feat: P1-12 onboarding UI` or equivalent).
2. **Phase 1 — Cursor prompt library** through P1-12 is complete for the implemented slice; follow the PRD/ADR for the next phase or backlog items.
3. Regression: `npm test` in `apps/api/` (expects **73** tests with valid `TEST_DATABASE_URL` / `apps/api/.env.test`) and `npm run type-check` at repo root. Web: `npm run type-check` and `npm run build` in `apps/web` (resolve any existing Next prerender issues if build fails).
4. **Clerk webhook** (P1-03 notes): still required in dashboard for production user sync; local dev continues to use ngrok per `docs/FamLink_New_Session_Checklist.md` if needed.

---

## Open Architectural Questions (from ADR v0.3)

| # | Question | Priority |
|---|---|---|
| 1 | COPPA compliance — parental consent flow for minor profiles | **PRE-LAUNCH BLOCKER** — needs legal input |
| 2 | Subscription tier member cap | Medium — needed before Phase 3 |
| 3 | Launch geography / GDPR scope | Medium — needed before public launch |
| 4 | Content moderation strategy | Medium — needed before public launch |

---

## Key Rules for All Development Work

- **ADR v0.3** is the authority. If Cursor suggests a different library or pattern, reject it and reference the ADR.
- **TypeScript strict mode** is non-negotiable. Zero `tsc --noEmit` errors before any prompt is marked complete.
- **`npm test` must pass** with zero failures before moving to the next prompt.
- **Prisma is pinned at 5.16.0.** Do not upgrade.
- **Resend, not SendGrid.** Any SendGrid reference in generated code is a bug.
- **Claude review is mandatory** after each Cursor prompt. Use the Claude Review Prompt provided at the end of each prompt in the library.
- **Commit after each prompt** with message format: `feat: P1-XX <short description>`
- **Propose-confirm pattern** required for any AI action involving communications or money.

---

*Generated: March 2026 | FamLink — CONFIDENTIAL*
