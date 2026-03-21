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
| PRD | v0.1 corrected | Product requirements; personas; feature scope; roadmap |
| ADR | v0.3 corrected | All locked technical decisions; open questions; build dependency map |
| Phase 1 Cursor Prompt Library | **v0.2** | The active build document — use this version for all Phase 1 work |

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
| P1-05 | Persons API | Pending |
| P1-06 | Family Groups and Households API | Pending |
| P1-07 | Relationships API | Pending |
| P1-08 | Event Hub API | Pending |
| P1-09 | Shared Calendar API | Pending |
| P1-10 | Invitation Service | Pending |
| P1-11 | Notification Service | Pending |
| P1-12 | Frontend — Auth + Onboarding UI | Pending |

---

## P1-03 Completion Notes

P1-03 was executed in Cursor and produced working output. Four items were identified and resolved:

1. **Webhook middleware ordering** — Confirmed correct. Raw body middleware is scoped to `/api/v1/webhooks/clerk` only, runs before `express.json()` and before `clerkAuth`. This is intentional for Svix signature verification.

2. **`loadTestEnv.ts`** — Cursor added this file beyond the spec. It sets env variable defaults before `server.ts` is imported in Jest, preventing `process.exit()` on missing env vars during tests. Confirmed it must be in `setupFiles` in `jest.config.ts` (runs before module imports), NOT in `setupFilesAfterFramework`.

3. **Test database (P1001 error)** — Resolved. `famlink_test` database has been created on Railway. `TEST_DATABASE_URL` is set in `apps/api/.env.test`. Schema migration applied. `npm test` should now be runnable.

4. **Clerk dashboard webhook** — Pending manual setup. Register `https://<deployed-host>/api/v1/webhooks/clerk` in Clerk dashboard, subscribe to `user.created` and `user.updated`, and copy the signing secret to `CLERK_WEBHOOK_SECRET` in Railway env vars. Not blocking P1-04; blocking end-to-end user sync in staging/prod.

**P1-03 test status:** 9 test cases (3 in `requireAuth.test.ts`, 6 in `webhooks.test.ts`). **P1-04** adds tests under `src/tests/lib/`, `src/tests/middleware/`, and `src/tests/routes/guest.test.ts`. Re-run `npm test` with a valid Railway `TEST_DATABASE_URL` to confirm the full suite.

---

## Immediate Next Actions

1. **Run `npm test`** in `apps/api/` with `TEST_DATABASE_URL` pointing at Railway `famlink_test` (see `apps/api/.env.test.example`). Expect **P1-03** (9) + **P1-04** (guest token + routes) tests; all must pass before the next prompt.
2. **P1-04** — Implemented and committed: `lib/guestToken.ts`, `middleware/guestAuth.ts`, `routes/guest.ts` (`GET /api/v1/guest/event`, `POST /api/v1/guest/rsvp`), `GUEST_TOKEN_SECRET` in `env.ts` / `.env.example`. Run Claude review from the Prompt Library when convenient.
3. **Next build prompt:** P1-05 (Persons API).

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

- **ADR v0.3 corrected** is the authority. If Cursor suggests a different library or pattern, reject it and reference the ADR.
- **TypeScript strict mode** is non-negotiable. Zero `tsc --noEmit` errors before any prompt is marked complete.
- **`npm test` must pass** with zero failures before moving to the next prompt.
- **Prisma is pinned at 5.16.0.** Do not upgrade.
- **Resend, not SendGrid.** Any SendGrid reference in generated code is a bug.
- **Claude review is mandatory** after each Cursor prompt. Use the Claude Review Prompt provided at the end of each prompt in the library.
- **Commit after each prompt** with message format: `feat: P1-XX <short description>`
- **Propose-confirm pattern** required for any AI action involving communications or money.

---

*Generated: March 2026 | FamLink — CONFIDENTIAL*
