# FamLink — Cursor Prompt Library
## Phase 2: P2-00 through P2-10

*The Family Operating System*
Version 1.0 — April 2026 | CONFIDENTIAL

| Field | Value |
|---|---|
| Governing ADR | FamLink ADR v0.4 (authoritative — all prompts derive from this) |
| Governing PRD | FamLink PRD v0.1 |
| Prerequisite | Phase 0 and Phase 1 complete, committed, and passing |
| Prompt Range | P2-00 through P2-10 |

---

## 1. How to Use This Document

| Phase | Tool | Action |
|---|---|---|
| Plan | Claude | Read the prompt. Understand the objective, context, and acceptance criteria before opening Cursor. |
| Build | Cursor | Paste the Cursor Prompt into Composer (Ctrl+Shift+I). Review generated code. Accept or iterate until acceptance criteria are met. |
| Test | Cursor | Run `turbo test` after every prompt. All tests must pass before marking a prompt complete. |
| Review | Claude | Use the Claude Review Prompt at the end of each section. Paste generated code into Claude. Fix flagged issues before the next prompt. |

### Critical Rules

- **Never skip a prompt.** Each depends on the deliverables of prior prompts.
- **Do not modify the stack.** All technology choices are LOCKED in ADR v0.4. If Cursor suggests an alternative library, reject it and reference the ADR.
- **TypeScript strict mode is non-negotiable.** Zero `tsc` errors before marking a prompt complete.
- **Tests are non-negotiable.** Every prompt produces test files. `turbo test` must pass before committing. A prompt with failing or missing tests is not complete.
- **Claude review is mandatory.** Do not skip it to save time.
- **Commit after each prompt.** Use commit format: `feat: P2-XX <short description>`
- **ADR v0.4 governs.** If any conflict exists between this document and ADR v0.4, the ADR wins. Flag the conflict before proceeding.

### Testing Standards (apply to all prompts)

| Standard | Requirement |
|---|---|
| API unit tests | Vitest — test each route handler with mocked Prisma client |
| API integration tests | Supertest — test full request/response cycle including auth middleware |
| Frontend component tests | Vitest + React Testing Library — test rendering, interactions, and state |
| Mobile component tests | Jest + Expo preset — test rendering and navigation |
| Coverage target | 80% line coverage minimum on all new files |
| Test location | Co-located: `src/routes/__tests__/`, `src/lib/__tests__/`, `src/components/__tests__/` |
| Test naming | `<filename>.test.ts` or `<filename>.test.tsx` |
| Mock strategy | Mock Prisma at module level using `vi.mock()` — never hit a real database in unit tests |

---

## 2. Pre-Flight Checklist — Verify Before Running P2-00

> **Cursor instruction:** Read this section and verify each item by inspecting the codebase and running commands. Report PASS, FAIL, or MISSING for each check. Do not proceed to P2-00 until all items pass.

| # | Item | Verification |
|---|---|---|
| 2.1 | Phase 1 complete | `git log --oneline` shows commits for P1-01 through P1-12 |
| 2.2 | API health | `GET /health` returns 200 |
| 2.3 | TypeScript clean | `turbo type-check` — zero errors across all packages |
| 2.4 | Prisma version | `cat packages/db/package.json` — Prisma version is exactly `5.16.0` (Prisma lives in `packages/db`, not `apps/api`) |
| 2.5 | Seed data | Johnson family fixture seed data loads cleanly in Railway PostgreSQL |
| 2.6 | Auth working | `requireAuth` middleware returns 401 for missing auth; Clerk webhook verified |
| 2.7 | Notifications | `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `FIREBASE_PROJECT_ID` present in env |
| 2.8 | Test framework state | Phase 1 shipped Jest in `apps/api` with 13 integration tests using a real database. P2-00 migrates these to Vitest with mocked Prisma. Mobile has no test framework yet. |

**Do not proceed if any item above fails.**

---

## 3. Prompt Dependency Map

| Prompt | Build Order | Depends On | Deliverable |
|---|---|---|---|
| P2-00 | P2 prerequisite | All Phase 1 | Prisma 7 upgrade + test framework setup (Vitest + Jest/Expo) |
| P2-01 | P2-01 | P2-00 | PostgreSQL graph traversal spike — benchmark + go/no-go recommendation |
| P2-02 | P2-02 | P2-00, Phase 1 APIs | AI Context Assembler — family context builder, token budget management |
| P2-03 | P2-03 | P2-02 | AI Assistant API — chat endpoint, streaming, Layer 1 tool registry, Helicone |
| P2-03b | P2-03b | P2-03 | Schema pre-migration — rename PotluckAssignment → EventItem with expanded fields |
| P2-04 | P2-04 | P2-00, P2-03b, Event Hub API | Socket.io — new event push + RSVP push |
| P2-05 | P2-05 | Phase 1 APIs, P2-00 | Frontend — Family Graph UI (web) |
| P2-06 | P2-06 | P2-04, P2-05 | Frontend — Event Hub UI (web) |
| P2-07 | P2-07 | P2-06 | Frontend — Calendar UI (web) |
| P2-08 | P2-08 | P2-03, P2-06 | Frontend — AI Assistant UI (web) |
| P2-09 | P2-09 | All APIs, P2-04 | Mobile — Core Screens (Expo) |
| P2-10 | P2-10 | P2-05, P2-09 | Cloudflare R2 + Photo Sharing |

---

## 4. Prompts

---

### Prompt P2-00 — Prisma 7 Upgrade + Test Framework Setup

| Field | Value |
|---|---|
| Prompt ID | P2-00 |
| Build Order | Phase 2 prerequisite — must complete before any other Phase 2 prompt |
| Depends On | All Phase 1 complete |
| Objective | Upgrade Prisma from v5.16.0 to Prisma 7 (latest stable). Install and configure Vitest for API and web packages, and Jest with Expo preset for mobile. All Phase 1 behavior must survive the upgrade with zero regressions. |

#### Context for Cursor

This is the most critical Phase 2 prompt. Nothing else begins until Prisma 7 is installed, all migrations are validated, seed data loads cleanly, and the test framework is operational. Prisma 7 contains breaking changes — primarily in how it handles certain relation queries and the client initialization API. Every Prisma usage in apps/api must be audited against the Prisma 7 migration guide. The test framework being installed here is the foundation that every subsequent Phase 2 prompt builds on.

#### Cursor Prompt — Part A: Prisma 7 Upgrade

```
Upgrade Prisma from v5.16.0 to Prisma 7 (latest stable) across the monorepo.

Step 1 — Update dependencies in apps/api/package.json:
  Remove: "prisma": "5.16.0", "@prisma/client": "5.16.0"
  Add: "prisma": "latest", "@prisma/client": "latest"
  Run: npm install in apps/api

Step 2 — Review the Prisma 7 migration guide for breaking changes.
  Known breaking changes to check for:
  - PrismaClient initialization changes
  - Removed or renamed methods
  - Changes to relation query behavior
  - Changes to JSON field handling
  - Changes to the Prisma CLI output format

Step 3 — Audit all Prisma usages in apps/api/src/:
  Find every file that imports PrismaClient or uses prisma.*
  Update each usage to comply with Prisma 7 API.
  Pay particular attention to:
    - prisma.$transaction() usage
    - Relation filtering patterns
    - Any usage of preview features that have graduated or been removed

Step 4 — Regenerate the Prisma client:
  Run: npx prisma generate in apps/api

Step 5 — Validate migrations:
  Run: npx prisma migrate status in apps/api
  All migrations must show as APPLIED with no drift.
  If any migration shows as pending or failed: stop and report.

Step 6 — Validate seed data:
  Run: npx prisma db seed in apps/api
  Johnson family fixture must load cleanly with zero errors.

Step 7 — Type check:
  Run: turbo type-check
  Zero TypeScript errors required across all packages.

Do NOT change any schema.prisma model definitions.
Do NOT run any destructive database operations.
Report any breaking change found and how it was resolved.
```

#### Cursor Prompt — Part B: Test Framework Setup

```
Install and configure the test framework across the monorepo.

--- API (apps/api) ---

Install in apps/api:
  vitest
  @vitest/coverage-v8
  supertest
  @types/supertest

Create apps/api/vitest.config.ts:
  import { defineConfig } from 'vitest/config'
  export default defineConfig({
    test: {
      globals: true,
      environment: 'node',
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        threshold: { lines: 80 }
      },
      include: ['src/**/__tests__/**/*.test.ts']
    }
  })

Add to apps/api/package.json scripts:
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"

Create apps/api/src/__tests__/setup.ts:
  Global test setup — mock PrismaClient at module level using vi.mock().
  Export a mockPrisma object with jest-style mock functions for:
    person.findUnique, person.findMany, person.create, person.update, person.delete
    familyGroup.findUnique, familyGroup.findMany, familyGroup.create
    relationship.findMany, relationship.create, relationship.delete
    event.findUnique, event.findMany, event.create, event.update
    familyMember.findUnique, familyMember.findMany, familyMember.create
  Structure mockPrisma to be resettable via beforeEach(() => vi.clearAllMocks())

Create apps/api/src/routes/__tests__/health.test.ts:
  Test: GET /health returns 200 with { status: 'ok' }
  This validates the test framework is wired correctly.

--- Web (apps/web) ---

Install in apps/web:
  vitest
  @vitest/coverage-v8
  @testing-library/react
  @testing-library/user-event
  @testing-library/jest-dom
  jsdom

Create apps/web/vitest.config.ts:
  import { defineConfig } from 'vitest/config'
  import react from '@vitejs/plugin-react'
  export default defineConfig({
    plugins: [react()],
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        threshold: { lines: 80 }
      },
      include: ['src/**/__tests__/**/*.test.tsx', 'src/**/__tests__/**/*.test.ts']
    }
  })

Create apps/web/src/test-setup.ts:
  import '@testing-library/jest-dom'

Add to apps/web/package.json scripts:
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"

--- Mobile (apps/mobile) ---

Install in apps/mobile:
  jest
  jest-expo
  @testing-library/react-native
  @types/jest

Create apps/mobile/jest.config.js:
  module.exports = {
    preset: 'jest-expo',
    setupFilesAfterFramework: ['@testing-library/react-native/extend-expect'],
    transformIgnorePatterns: [
      'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)'
    ],
    coverageThreshold: { global: { lines: 80 } },
    collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/__tests__/**']
  }

Add to apps/mobile/package.json scripts:
  "test": "jest",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage"

--- Turborepo ---

Add to turbo.json pipeline:
  "test": {
    "dependsOn": ["^build"],
    "outputs": ["coverage/**"]
  }

Add to root package.json scripts:
  "test": "turbo run test"

Run turbo test to confirm the health check test passes and the
framework is wired correctly in all three packages.
Report any configuration errors found.
```

#### Acceptance Criteria

- [ ] Prisma version in `apps/api/package.json` is Prisma 7 (not 5.16.0)
- [ ] `npx prisma migrate status` shows all migrations APPLIED with no drift
- [ ] `npx prisma db seed` loads Johnson family fixture with zero errors
- [ ] `npx prisma generate` completes with zero errors
- [ ] `turbo type-check` passes with zero TypeScript errors
- [ ] Vitest installed and configured in `apps/api` and `apps/web`
- [ ] Jest + Expo preset installed and configured in `apps/mobile`
- [ ] `apps/api/src/__tests__/setup.ts` exports a resettable `mockPrisma` object
- [ ] `health.test.ts` exists and passes — confirms API test framework is wired
- [ ] `turbo test` runs and passes across all packages
- [ ] Coverage threshold of 80% lines configured in all three packages
- [ ] No Phase 1 behavior regressions — all existing routes still respond correctly

> **Claude Review Prompt — P2-00**
> Paste `apps/api/vitest.config.ts`, `apps/api/src/__tests__/setup.ts`, `apps/web/vitest.config.ts`, and `apps/mobile/jest.config.js` into Claude with: "Review P2-00 test framework setup. Check: (1) mockPrisma covers all models used in Phase 1 routes, (2) coverage threshold of 80% is configured in all three packages, (3) jsdom environment is set for web tests, (4) node environment is set for API tests, (5) Expo transformIgnorePatterns are correct for the packages in use, (6) turbo.json pipeline includes test with correct dependsOn."

---

### Prompt P2-03b — Schema Pre-Migration: EventItem Rename

| Field | Value |
|---|---|
| Prompt ID | P2-03b |
| Build Order | P2-03b — must complete after P2-03 and before P2-04 |
| Depends On | P2-03 complete and committed |
| Objective | Rename `PotluckAssignment` → `EventItem` in Prisma schema, expand the model with the fields defined in ADR v0.4 §3 (EventItems), create and apply the migration, and do a full codebase find-and-replace. All tests must pass after the change. |

#### Context for Cursor

ADR v0.4 replaced the narrow `PotluckAssignment` model with a general-purpose `EventItem` model that can represent any contribution to an event — food, supplies, tasks, or checklist items. The existing schema has the old model with fewer fields (`item`, `quantity` as Int, no status, no visibility). The new model adds `name` (replacing `item`), `quantity` as String, `createdByPersonId`, `assignedToPersonId`, `isChecklistItem`, `status` enum, `visibility` enum, and `updatedAt`. Prisma model names are singular by convention — use `EventItem` (not `EventItems`). The table will be `event_items`. Every file in the codebase that references `PotluckAssignment`, `potluckAssignment`, or `potluckItems` must be updated.

#### Cursor Prompt

```
This prompt renames the PotluckAssignment model to EventItem and expands
its fields to match ADR v0.4. No new routes. No UI changes.

--- Step 1: Update packages/db/prisma/schema.prisma ---

Add enums (if not already present):

  enum EventItemStatus {
    UNCLAIMED
    CLAIMED
    PROVIDED
    CANCELLED
  }

  enum EventItemVisibility {
    PUBLIC
    PRIVATE
  }

Replace the existing PotluckAssignment model with:

  model EventItem {
    id                   String              @id @default(cuid())
    eventId              String
    event                Event               @relation(fields: [eventId], references: [id], onDelete: Cascade)
    createdByPersonId    String
    createdBy            Person              @relation("EventItemCreator", fields: [createdByPersonId], references: [id])
    assignedToPersonId   String?
    assignedTo           Person?             @relation("EventItemAssignee", fields: [assignedToPersonId], references: [id])
    name                 String
    quantity             String?
    notes                String?
    isChecklistItem      Boolean             @default(false)
    status               EventItemStatus     @default(UNCLAIMED)
    visibility           EventItemVisibility @default(PUBLIC)
    createdAt            DateTime            @default(now())
    updatedAt            DateTime            @updatedAt

    @@index([eventId])
    @@index([assignedToPersonId])
  }

On the Event model: replace `potluckItems PotluckAssignment[]`
  with `eventItems EventItem[]`

On the Person model: add these two relations:
  createdEventItems  EventItem[] @relation("EventItemCreator")
  assignedEventItems EventItem[] @relation("EventItemAssignee")

--- Step 2: Create and apply the migration ---

Run: npx prisma migrate dev --name rename_potluck_to_event_item
  in packages/db (where schema.prisma lives).

Verify: npx prisma migrate status shows all migrations APPLIED.

Run: npx prisma generate to regenerate the client.

--- Step 3: Full codebase find-and-replace ---

Search every file in the monorepo for the following and replace:

  PotluckAssignment  →  EventItem
  potluckAssignment  →  eventItem
  potluckItems       →  eventItems
  potluck_assignment →  event_item
  potluck_items      →  event_items

Pay special attention to:
  - apps/api/src/routes/ — any Event Hub route that creates or queries potluck items
  - apps/api/src/__tests__/ and apps/api/src/routes/__tests__/ — test files and mocks
  - apps/api/src/__tests__/setup.ts — mockPrisma must add eventItem mock methods
    (eventItem.findMany, eventItem.create, eventItem.update, eventItem.delete)
    and remove potluckAssignment mock methods if present
  - packages/db/prisma/seed.ts — update any seed data that creates PotluckAssignment records
  - Any TypeScript type imports that reference the old model name

After renaming, check for any field name changes:
  - Old field `item` is now `name` — update all usages
  - Old field `quantity` was Int, now String — update any numeric assignments
  - Old field `personId` is now `assignedToPersonId` — update all usages
  - New required field `createdByPersonId` — add to all create calls

--- Step 4: Type check and tests ---

Run: turbo type-check
  Zero TypeScript errors required. Fix all errors before proceeding.

Run: turbo test
  All tests must pass. Fix any test that fails due to the rename.
  Do NOT skip or delete tests to make them pass.

--- Step 5: Verify migration integrity ---

Run: npx prisma migrate status
  Must show all migrations APPLIED with no drift.

Run: npx prisma db seed
  Johnson family fixture must load cleanly. If the seed creates
  PotluckAssignment records, update them to use EventItem with the
  new field names.

Report any breaking change found and how it was resolved.
Do NOT modify any other schema models.
Do NOT add new routes or UI in this prompt.
```

#### Acceptance Criteria

- [ ] `PotluckAssignment` model is removed from `schema.prisma`; `EventItem` model is present with all fields from ADR v0.4 §3
- [ ] `EventItemStatus` and `EventItemVisibility` enums are present in `schema.prisma`
- [ ] `Event` model relation updated: `eventItems EventItem[]`
- [ ] `Person` model has both `createdEventItems` and `assignedEventItems` relations
- [ ] Migration `rename_potluck_to_event_item` exists in `packages/db/prisma/migrations/` and shows APPLIED
- [ ] `npx prisma generate` completes with zero errors
- [ ] `npx prisma db seed` loads Johnson family fixture with zero errors
- [ ] Zero occurrences of `PotluckAssignment`, `potluckAssignment`, `potluckItems` remain in the codebase (verify with a grep)
- [ ] `mockPrisma` in `apps/api/src/__tests__/setup.ts` includes `eventItem` mock methods
- [ ] `turbo type-check` passes with zero TypeScript errors
- [ ] `turbo test` passes with zero failures

> **Claude Review Prompt — P2-03b**
> Paste `packages/db/prisma/schema.prisma` and `apps/api/src/__tests__/setup.ts` into Claude with: "Review P2-00b schema migration. Check: (1) EventItem model includes all fields from ADR v0.4 — name, quantity (String), createdByPersonId, assignedToPersonId, isChecklistItem, status, visibility, updatedAt, (2) both EventItemStatus and EventItemVisibility enums are defined, (3) Person model has both creator and assignee relations with correct relation names, (4) mockPrisma in setup.ts exposes eventItem mock methods, (5) no remaining references to PotluckAssignment anywhere in the pasted files."

---

### Prompt P2-01 — PostgreSQL Graph Traversal Spike

| Field | Value |
|---|---|
| Prompt ID | P2-01 |
| Build Order | P2-01 |
| Depends On | P2-00 complete and committed |
| Objective | Benchmark PostgreSQL relationship traversal queries against the Layer 1 AI tool requirements. Produce a written recommendation: stay on PostgreSQL or migrate to a graph DB. This is a spike — the output is evidence and a decision, not a production feature. |

#### Context for Cursor

ADR v0.4 locks the graph DB decision as evidence-based: migrate only if PostgreSQL traversal query complexity justifies it. The three most demanding Layer 1 tools are `get_relationship_path` (multi-hop traversal), `get_family_members` (fan-out from a person node), and `get_rsvp_status` (aggregation across relationship edges). This spike writes those queries against the Johnson family seed data, measures their complexity and execution time, and produces a recommendation.

#### Cursor Prompt

```
This is a spike/benchmark task. No production routes. No UI changes.
Output: benchmark results file + recommendation document.

Create apps/api/src/scripts/graphSpike.ts

This script benchmarks four relationship traversal query patterns
against the Johnson family seed data. Run with:
  npx ts-node src/scripts/graphSpike.ts

Query 1 — Direct family members (1-hop):
  Find all persons who share a family_group with person X.
  Use Prisma: familyMember.findMany where familyId in
  (person X's families), include person.
  Record: query time, result count, Prisma-generated SQL (use $queryRaw
  to log the SQL for inspection).

Query 2 — Household members:
  Find all persons in the same household as person X.
  Join through household_members.
  Record: query time, result count, SQL.

Query 3 — Relationship path (2-hop):
  Find how person X is related to person Y.
  Start from X's relationships, traverse one additional hop.
  This is the key stress test — recursive traversal in PostgreSQL
  requires a WITH RECURSIVE CTE.
  Write the query using prisma.$queryRaw with a WITH RECURSIVE CTE.
  Record: query time, result count, SQL, and whether the query
  required manual SQL (Prisma ORM cannot express recursive CTEs).

Query 4 — RSVP aggregation across family:
  For event E, find all family members, their RSVP status, and
  count by status (YES / NO / MAYBE / PENDING).
  Record: query time, result count, SQL.

After running all four queries, write results to:
  apps/api/src/scripts/graphSpikeResults.md

Format of graphSpikeResults.md:
  # Graph Traversal Spike Results
  ## Date: [today]
  ## Dataset: Johnson family seed data

  For each query:
    ### Query N — [name]
    - Execution time: Xms
    - Result count: N
    - Required raw SQL: YES/NO
    - SQL complexity notes: [brief assessment]
    - Prisma ORM sufficient: YES/NO

  ## Recommendation
  [One of the following conclusions, with rationale:]
  - STAY ON POSTGRESQL: All queries expressible with acceptable
    complexity and performance. Graph DB migration not justified.
  - EVALUATE GRAPH DB: Query N requires raw SQL and complexity
    is likely to grow as graph depth increases. Recommend a
    timebox evaluation of Neo4j/Neptune before Phase 3.

Create apps/api/src/scripts/__tests__/graphSpike.test.ts:
  Unit tests for any helper functions extracted from the spike
  (e.g., CTE query builders, result formatters).
  If no helpers are extracted, write one test that confirms
  the Prisma client connects and the persons table is queryable.

Do NOT modify any schema, routes, or production code.
Do NOT deploy or run migrations.
```

#### Acceptance Criteria

- [ ] `graphSpike.ts` script runs without errors against Railway PostgreSQL
- [ ] `graphSpikeResults.md` is produced with all four query results populated
- [ ] Each query entry records execution time, result count, and whether raw SQL was required
- [ ] The WITH RECURSIVE CTE is used for Query 3 — relationship path traversal
- [ ] A clear STAY or EVALUATE recommendation is written with rationale
- [ ] `__tests__/graphSpike.test.ts` exists and passes
- [ ] `turbo test` passes
- [ ] No production code was modified

> **Claude Review Prompt — P2-01**
> Paste `graphSpikeResults.md` and `graphSpike.ts` into Claude with: "Review P2-01 spike results. Check: (1) Query 3 correctly uses a WITH RECURSIVE CTE — Prisma ORM cannot express recursive graph traversal natively and this must be acknowledged, (2) the recommendation is evidence-based and cites specific query results, (3) if raw SQL was required for more than one query, the EVALUATE recommendation is appropriate, (4) execution times are within acceptable range for a family-scale dataset."

---

### Prompt P2-02 — AI Context Assembler

| Field | Value |
|---|---|
| Prompt ID | P2-02 |
| Build Order | P2-02 |
| Depends On | P2-00, P2-01 complete and committed; all Phase 1 APIs complete |
| Objective | Build the AI Context Assembler — the server-side module that constructs the family context payload sent to the LLM on every AI request. Manages token budget, assembles relevant family data, and enforces privacy boundaries. |

#### Context for Cursor

The AI Context Assembler is the most privacy-sensitive module in Phase 2. It is the only component allowed to read family data and pass it to the LLM. All family data is assembled server-side — the LLM never receives raw database queries or PII beyond what is necessary for the specific request (ADR-06). The assembler must enforce a token budget to prevent runaway API costs. Context must never cross family group boundaries — person X cannot receive context from family group Y even if they share a household.

#### Cursor Prompt

```
Create apps/api/src/lib/aiContext.ts

This module is the family context assembler for the AI layer (ADR-06).
It reads family data from the database and formats it into a structured
context payload for the LLM. It never directly calls an LLM.

Define types (export all):

  PersonSummary:
    id:             string
    displayName:    string       // preferredName ?? firstName + lastName
    relationship:   string       // e.g. "father", "sister", "uncle"
    ageGateLevel:   AgeGateLevel
    contactable:    boolean      // true if person has email or phone

  EventSummary:
    id:             string
    title:          string
    startTime:      string       // ISO string
    location:       string | null
    rsvpSummary:    { yes: number; no: number; maybe: number; pending: number }

  FamilyContext:
    familyGroupId:  string
    familyName:     string
    requestingPerson: PersonSummary
    members:        PersonSummary[]
    upcomingEvents: EventSummary[]   // next 30 days only
    upcomingBirthdays: { name: string; date: string; daysUntil: number }[]
    tokenEstimate:  number           // estimated token count for this context

  ContextAssemblyOptions:
    maxMembers:         number   // default 50
    eventLookAheadDays: number   // default 30
    maxEvents:          number   // default 10
    maxBirthdays:       number   // default 5

TOKEN BUDGET CONSTANTS (export):
  MAX_CONTEXT_TOKENS = 4000
  TOKENS_PER_MEMBER  = 30      // estimated tokens per PersonSummary
  TOKENS_PER_EVENT   = 50      // estimated tokens per EventSummary

Export async function assembleFamilyContext(
  requestingPersonId: string,
  familyGroupId:      string,
  options?:           ContextAssemblyOptions
): Promise<FamilyContext>

  Steps:
  1. Verify requestingPersonId is a member of familyGroupId.
     If not: throw Error("Unauthorized: person is not a member of this family group")

  2. Fetch FamilyGroup record.

  3. Fetch requesting person's full record.

  4. Fetch all FamilyMember records for this family group.
     Include: person record for each member.
     Exclude: persons with ageGateLevel = MINOR (minors are passive nodes;
     do not include their data in AI context per ADR-06).
     Limit to options.maxMembers (default 50).

  5. Fetch upcoming events for this family group:
     startTime >= now AND startTime <= now + eventLookAheadDays.
     Include: RSVP counts per status.
     Limit to options.maxEvents (default 10).

  6. Fetch upcoming birthdays:
     Query persons in this family group with non-null dateOfBirth.
     Calculate daysUntil for each.
     Return only birthdays within 30 days.
     Sort ascending by daysUntil.
     Limit to options.maxBirthdays (default 5).

  7. Calculate tokenEstimate:
     base: 200
     + members.length * TOKENS_PER_MEMBER
     + upcomingEvents.length * TOKENS_PER_EVENT
     + upcomingBirthdays.length * 15

  8. If tokenEstimate > MAX_CONTEXT_TOKENS:
     Trim members array (remove members least recently active first)
     until tokenEstimate <= MAX_CONTEXT_TOKENS.
     Log a warning with the original and trimmed counts.

  9. Return FamilyContext.

Export function formatContextForPrompt(context: FamilyContext): string
  Formats FamilyContext as a structured plain-text block for injection
  into the LLM system prompt. No JSON — human-readable format.
  Example output:
    "Family: The Johnson Family
     Members (12): Grandma Ruth, Uncle Mike, Aunt Carol...
     Upcoming Events: Easter Dinner (Apr 20, 6pm, Grandma's house — 3 yes, 2 pending)
     Upcoming Birthdays: Uncle Mike turns 58 in 3 days"

Export async function getConversationHistory(
  conversationId: string,
  limit: number = 20
): Promise<{ role: 'user' | 'assistant'; content: string }[]>
  Fetches the last `limit` messages for a conversation from the
  assistant_messages table. Oldest first. Used to maintain multi-turn
  context in the AI chat endpoint.

Create apps/api/src/lib/__tests__/aiContext.test.ts

Tests (use mockPrisma from setup.ts):

  assembleFamilyContext:
  - throws if requestingPersonId is not a member of familyGroupId
  - returns correct PersonSummary for requesting person
  - excludes MINOR-gated persons from members array
  - trims members when tokenEstimate exceeds MAX_CONTEXT_TOKENS
  - upcomingEvents are limited to next 30 days
  - upcomingBirthdays are sorted ascending by daysUntil

  formatContextForPrompt:
  - output contains family name
  - output contains member count
  - output contains upcoming event title and date
  - output contains upcoming birthday name and days

  getConversationHistory:
  - returns messages in chronological order (oldest first)
  - respects the limit parameter
  - returns empty array if no conversation found

Do NOT call any LLM in this module or its tests.
Do NOT import the Vercel AI SDK here.
```

#### Acceptance Criteria

- [ ] `assembleFamilyContext` throws on cross-family-group access attempts
- [ ] MINOR-gated persons are excluded from the context payload
- [ ] Token budget enforcement trims members when `MAX_CONTEXT_TOKENS` would be exceeded
- [ ] `formatContextForPrompt` returns a human-readable string — no JSON
- [ ] `getConversationHistory` returns messages oldest-first up to the limit
- [ ] All tests in `aiContext.test.ts` pass
- [ ] `turbo test` passes with zero failures
- [ ] `tsc --noEmit` passes with zero errors
- [ ] No LLM calls or Vercel AI SDK imports anywhere in this module

> **Claude Review Prompt — P2-02**
> Paste `lib/aiContext.ts` and `lib/__tests__/aiContext.test.ts` into Claude with: "Review P2-02 against ADR v0.4 ADR-06. Check: (1) cross-family-group authorization is enforced before any data is fetched, (2) MINOR ageGateLevel exclusion is correct — minors must not appear in AI context, (3) token budget trimming logic is correct and logs a warning, (4) formatContextForPrompt outputs plain text not JSON, (5) test file covers all three exported functions and the MINOR exclusion case is explicitly tested."

---

### Prompt P2-03 — AI Assistant API + Layer 1 Tools + Helicone

| Field | Value |
|---|---|
| Prompt ID | P2-03 |
| Build Order | P2-03 |
| Depends On | P2-02 complete and committed |
| Objective | Build the AI Assistant API endpoint with streaming support, the full Layer 1 tool registry (10 tools), and Helicone observability integration. This is the core AI feature of Phase 2. |

#### Context for Cursor

The AI Assistant API is the chat endpoint that the web and mobile frontends will connect to. It uses the Vercel AI SDK for LLM abstraction and streaming. All 10 Layer 1 tools are registered here — 9 read-only tools and `create_event` with a propose/confirm guardrail. Helicone is the observability layer — it wraps the Anthropic client and provides logging, cost tracking, and caching transparently. The rate limit of 20 queries/user/day is enforced here (ADR-06). No recursive tool calls. Max iteration limit enforced per tool call chain.

Layer 1 tool registry (from ADR v0.4):
- `get_person` — look up a person by name or relationship label
- `get_family_members` — list members of a family or household
- `get_relationship_path` — explain how two people are related
- `get_upcoming_birthdays` — return birthdays within a time window
- `get_upcoming_events` — list events on the shared calendar
- `get_event_details` — return full details for a specific event
- `get_rsvp_status` — return attendance status for an event
- `create_event` — draft new event with propose/confirm guardrail (WRITE — guarded)
- `get_household_members` — list people in a specific household
- `get_contact_info` — return contact details for a person

#### Cursor Prompt

```
Install in apps/api:
  ai (Vercel AI SDK — latest)
  @ai-sdk/anthropic
  zod (already present — confirm version)

Install in apps/api (Helicone):
  helicone  (or @helicone/helicone — confirm correct package name
             by checking npmjs.com before installing)

Add to apps/api/src/lib/env.ts:
  ANTHROPIC_API_KEY:    string
  OPENAI_API_KEY:       string (fallback model)
  HELICONE_API_KEY:     string
  AI_MAX_TOOL_ITERATIONS: number, default 5

> **Architecture decision — direct provider keys via Helicone (not Vercel AI Gateway):**
> FamLink is deployed on Railway, not Vercel. The Vercel AI Gateway requires OIDC credentials
> issued by the Vercel platform and is not available outside a Vercel deployment. Helicone is
> used as the observability and proxy layer instead. If FamLink migrates to Vercel in a future
> phase, swapping Helicone for the AI Gateway is a one-file change to aiClient.ts.
> Direct provider API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY) are intentional and correct
> for this deployment target.

--- Helicone Client (apps/api/src/lib/aiClient.ts) ---

Create apps/api/src/lib/aiClient.ts

Initialize the Anthropic client wrapped with Helicone observability.
  Use Helicone's OpenAI-compatible proxy or the Helicone SDK —
  use whichever integration method is documented for Vercel AI SDK
  + Anthropic. Check Helicone docs if uncertain.

Export: anthropicClient (Helicone-wrapped Anthropic client)
Export: openAiClient   (fallback — standard OpenAI client, no Helicone)
Export: PRIMARY_MODEL   = 'claude-sonnet-4.6' (or latest Anthropic Sonnet — verify current slug before hardcoding)
Export: FALLBACK_MODEL  = 'gpt-4.1' (verify current OpenAI model slug before hardcoding)

--- AI Rate Limiter (apps/api/src/lib/aiRateLimit.ts) ---

Create apps/api/src/lib/aiRateLimit.ts

Use Redis (already configured) to enforce 20 AI queries/user/day.

Export async function checkAndIncrementAiRateLimit(
  userId: string
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }>

  Redis key: `ai:rate:${userId}:${today-utc-date}`
  TTL: 86400 seconds (24 hours, UTC midnight reset)
  If key does not exist: create with value 1, set TTL, return allowed: true
  If key exists and value < 20: increment, return allowed: true
  If key exists and value >= 20: return allowed: false, remaining: 0

--- Layer 1 Tool Registry (apps/api/src/lib/aiTools.ts) ---

Create apps/api/src/lib/aiTools.ts

Import assembleFamilyContext and the Prisma client.
Import tool from 'ai' (Vercel AI SDK).

Define and export all 10 Layer 1 tools using the Vercel AI SDK tool() helper.
Each tool must have: description, parameters (Zod schema), execute function.

Tools — READ (9):

  get_person:
    parameters: { name: string; familyGroupId: string }
    execute: Query persons in this family group where firstName or
             preferredName matches name (case-insensitive, partial match).
             Return: PersonSummary array (max 5 results).

  get_family_members:
    parameters: { familyGroupId: string }
    execute: Return all PersonSummary records for this family group.
             Exclude MINOR-gated persons.

  get_relationship_path:
    parameters: { fromPersonId: string; toPersonId: string; familyGroupId: string }
    execute: Use the WITH RECURSIVE CTE pattern from P2-01 spike.
             Return a plain-text description of the relationship path.
             e.g. "Mike is your father's brother — your uncle."
             If no path found within 4 hops: return "No relationship path found."

  get_upcoming_birthdays:
    parameters: { familyGroupId: string; withinDays: number }
    execute: Return persons with birthdays within withinDays days.
             Return: { name: string; date: string; daysUntil: number }[]

  get_upcoming_events:
    parameters: { familyGroupId: string; withinDays?: number }
    execute: Return EventSummary[] for events in the next withinDays days
             (default 30). Sorted ascending by startTime.

  get_event_details:
    parameters: { eventId: string; familyGroupId: string }
    execute: Return full event record including RSVPs with person names.
             Authorization: event must belong to familyGroupId.

  get_rsvp_status:
    parameters: { eventId: string; familyGroupId: string }
    execute: Return { yes: Person[]; no: Person[]; maybe: Person[]; pending: Person[] }
             with person display names in each array.

  get_household_members:
    parameters: { householdId: string; familyGroupId: string }
    execute: Return PersonSummary[] for all members of this household.
             Authorization: household must belong to familyGroupId.

  get_contact_info:
    parameters: { personId: string; familyGroupId: string }
    execute: Return { displayName, email, phone } for this person.
             Authorization: person must be in familyGroupId.
             Never return contact info for MINOR-gated persons.

Tool — WRITE (1):

  create_event (PROPOSE/CONFIRM — does NOT create the event):
    parameters:
      title:          string
      startTime:      string  (ISO datetime)
      endTime:        string optional (ISO datetime)
      location:       string optional
      description:    string optional
      familyGroupId:  string
    execute:
      DO NOT write to the database.
      Return a proposal object:
        {
          proposed: true,
          event: { title, startTime, endTime, location, description },
          confirmationRequired: true,
          message: "I've drafted this event. Please confirm to create it."
        }
      The frontend is responsible for rendering the confirmation UI
      and calling the separate POST /api/v1/events endpoint to actually
      create the event after user confirms.

IMPORTANT — ALL tools must:
  - Return structured objects, not prose
  - Handle not-found gracefully (return empty array or null — do not throw)
  - Never cross family group boundaries
  - Never return data for MINOR-gated persons in contact/detail responses

--- AI Assistant Route (apps/api/src/routes/ai.ts) ---

Create apps/api/src/routes/ai.ts

POST /api/v1/ai/chat
  Requires: requireAuth
  Body (Zod validated):
    messages:      { role: 'user' | 'assistant'; content: string }[]
    familyGroupId: string
    conversationId: string optional (if omitted: create new conversation)

  Steps:
  1. Get requesting person from auth userId.
  2. Verify person is a member of familyGroupId.
  3. Check AI rate limit via checkAndIncrementAiRateLimit(userId).
     If not allowed: return 429 {
       error: "Daily AI limit reached",
       resetAt: <UTC midnight>,
       message: "You've reached your 20 daily AI queries. Your limit resets at midnight UTC."
     }
  4. Load or create conversation record (assistant_conversations table).
  5. Fetch conversation history via getConversationHistory(conversationId, 20).
  6. Assemble family context via assembleFamilyContext(personId, familyGroupId).
  7. Build system prompt:
     - Role definition: "You are FamLink's family assistant..."
     - Inject formatContextForPrompt(context) output
     - Tool usage instructions: use tools to answer questions about family data.
       Never fabricate family data. If a tool returns no results, say so.
     - Guardrail: create_event returns a proposal only — never confirm autonomously.
  8. Call streamText() from Vercel AI SDK:
     model:      anthropicClient with PRIMARY_MODEL
     system:     system prompt from step 7
     messages:   [...conversationHistory, ...body.messages]
     tools:      all 10 tools from aiTools.ts
     stopWhen:   stepCountIs(AI_MAX_TOOL_ITERATIONS) (from env, default 5 — import stepCountIs from 'ai'; maxSteps was removed in AI SDK v6)
  9. Persist user message and assistant response to assistant_messages table.
  10. Stream the response using pipeDataStreamToResponse().

GET /api/v1/ai/status
  Requires: requireAuth
  Returns: { queriesUsedToday: number; queriesRemaining: number; resetAt: Date }
  Uses checkAndIncrementAiRateLimit — DO NOT increment on this endpoint.
  Implement a separate getRateLimitStatus(userId) function for read-only check.

Mount in apps/api/src/routes/index.ts:
  router.use('/api/v1/ai', requireAuth, aiRouter)

--- Tests ---

Create apps/api/src/lib/__tests__/aiRateLimit.test.ts:
  - Returns allowed: true and remaining: 19 on first call
  - Returns allowed: true and decrements remaining on subsequent calls
  - Returns allowed: false and remaining: 0 when limit reached (20th call)
  - Redis key includes today's UTC date
  (Use a mock Redis client — do not hit real Redis in tests)

Create apps/api/src/lib/__tests__/aiTools.test.ts:
  For each of the 10 tools, test at minimum:
  - Happy path: returns expected structure for valid input
  - Authorization: returns empty/null when familyGroupId doesn't match
  - MINOR exclusion: get_contact_info returns null for MINOR-gated person
  - create_event: returns proposed: true and confirmationRequired: true
    and does NOT write to the database (verify mockPrisma.event.create
    was NOT called)
  (Use mockPrisma from setup.ts)

Create apps/api/src/routes/__tests__/ai.test.ts:
  - POST /api/v1/ai/chat returns 401 without auth
  - POST /api/v1/ai/chat returns 429 when rate limit exceeded
  - POST /api/v1/ai/chat returns 403 if person is not in familyGroupId
  - GET /api/v1/ai/status returns correct remaining count
  (Mock streamText from Vercel AI SDK using vi.mock('ai'))
```

#### Acceptance Criteria

- [ ] `POST /api/v1/ai/chat` returns 401 without auth
- [ ] `POST /api/v1/ai/chat` returns 429 when 20-query daily limit is reached
- [ ] `POST /api/v1/ai/chat` returns 403 if requesting person is not in the specified family group
- [ ] `create_event` tool returns a proposal object — `mockPrisma.event.create` is never called
- [ ] MINOR-gated persons are excluded from all tool responses
- [ ] `get_relationship_path` uses the WITH RECURSIVE CTE pattern from P2-01
- [ ] Helicone client wraps the Anthropic client — all requests flow through Helicone
- [ ] `maxSteps` is set from env `AI_MAX_TOOL_ITERATIONS` — not hardcoded
- [ ] `aiRateLimit.test.ts` covers allowed, decrement, and limit-reached cases
- [ ] `aiTools.test.ts` has at minimum one test per tool
- [ ] `ai.test.ts` covers 401, 429, and 403 cases
- [ ] `turbo test` passes with zero failures
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P2-03**
> Paste `lib/aiTools.ts`, `lib/aiRateLimit.ts`, `routes/ai.ts`, and all three test files into Claude with: "Review P2-03 against ADR v0.4 ADR-06. Check: (1) create_event tool does NOT write to the database under any circumstance — verify no Prisma write calls exist in its execute function, (2) rate limit uses Redis with UTC date-keyed TTL, (3) MINOR exclusion is applied in every tool that returns person data, (4) maxSteps is sourced from env — not hardcoded, (5) cross-family-group authorization is checked in every tool that takes familyGroupId, (6) aiTools.test.ts tests the create_event no-write guarantee explicitly."

---

### Prompt P2-04 — Socket.io Real-Time (Phase 2 Scope)

| Field | Value |
|---|---|
| Prompt ID | P2-04 |
| Build Order | P2-04 |
| Depends On | P2-00, Event Hub API (Phase 1) complete and committed |
| Objective | Add Socket.io real-time push for the two Phase 2 events: new event created and RSVP updated. Scoped strictly to these two events — no other real-time capability in Phase 2 (ADR-09). |

#### Context for Cursor

Socket.io is already referenced in ADR-04 and the Express server was built with WebSocket support in mind. Phase 2 scope is strictly bounded: (1) new event created → push to all family members with access, (2) RSVP updated → push to the event organizer. Everything else — typing indicators, presence, read receipts, group chat — is Phase 3. Do not add anything beyond these two events.

#### Cursor Prompt

```
Install in apps/api:
  socket.io (confirm already present from Phase 1 — install only if missing)

--- Socket.io Server (apps/api/src/lib/socketServer.ts) ---

Create apps/api/src/lib/socketServer.ts

Import: Server from 'socket.io', http.Server

Export function initializeSocketServer(httpServer: http.Server): Server

  Initialize Socket.io server with:
    cors: { origin: process.env.WEB_APP_URL, methods: ['GET', 'POST'] }
    transports: ['websocket', 'polling']

  Middleware — authenticate socket connections:
    On connection: extract token from socket.handshake.auth.token
    Verify as a Clerk session token (use Clerk's verifyToken)
    If invalid: socket.disconnect(true)
    If valid: attach userId to socket.data.userId

  On authenticated connection:
    socket.join(`user:${socket.data.userId}`)
    Also join family group rooms by fetching the user's person record
    and their family group memberships, then:
      for each familyGroupId: socket.join(`family:${familyGroupId}`)

  Define and export two emit functions (NOT event handlers — these are
  called from route handlers after database writes):

  export function emitEventCreated(
    io: Server,
    familyGroupId: string,
    event: { id: string; title: string; startTime: string; createdByName: string }
  ): void
    io.to(`family:${familyGroupId}`).emit('event:created', event)

  export function emitRsvpUpdated(
    io: Server,
    organizerUserId: string,
    payload: { eventId: string; eventTitle: string; responderName: string; status: string }
  ): void
    io.to(`user:${organizerUserId}`).emit('rsvp:updated', payload)

Export the io instance so it can be imported by route handlers.

--- Integrate with Express server (apps/api/src/server.ts) ---

Update apps/api/src/server.ts to:
  Create http.Server wrapping the Express app
  Call initializeSocketServer(httpServer)
  Listen on httpServer (not app.listen)

--- Integrate with Event Hub routes (apps/api/src/routes/events.ts) ---

Update the POST /api/v1/events handler (event creation):
  After successful Prisma event create:
  Call emitEventCreated(io, familyGroupId, { id, title, startTime, createdByName })

Update the PUT /api/v1/events/:eventId/rsvp handler (RSVP update):
  After successful RSVP upsert:
  Fetch the event organizer's userId
  Call emitRsvpUpdated(io, organizerUserId, { eventId, eventTitle, responderName, status })

--- Tests ---

Create apps/api/src/lib/__tests__/socketServer.test.ts:
  Use socket.io mock (vi.mock('socket.io'))

  - emitEventCreated emits to the correct family room ('family:${familyGroupId}')
  - emitRsvpUpdated emits to the correct user room ('user:${organizerUserId}')
  - emitEventCreated emits the correct event payload shape
  - emitRsvpUpdated emits the correct payload shape
  - Unauthenticated socket connection is disconnected

Create apps/api/src/routes/__tests__/events.test.ts (add to existing if present):
  - POST /api/v1/events calls emitEventCreated after successful create
  - PUT /api/v1/events/:eventId/rsvp calls emitRsvpUpdated after successful update
  (Use vi.mock for emitEventCreated and emitRsvpUpdated — verify they are called
  with correct arguments, not that the socket actually emits)

Do NOT add any Socket.io events beyond event:created and rsvp:updated.
Do NOT add typing indicators, presence, read receipts, or any chat functionality.
```

#### Acceptance Criteria

- [ ] Socket.io server initializes and attaches to the HTTP server (not the Express app directly)
- [ ] Socket connections without a valid Clerk token are disconnected
- [ ] `emitEventCreated` emits to `family:${familyGroupId}` room
- [ ] `emitRsvpUpdated` emits to `user:${organizerUserId}` room
- [ ] `POST /api/v1/events` calls `emitEventCreated` after a successful database write
- [ ] `PUT /api/v1/events/:eventId/rsvp` calls `emitRsvpUpdated` after a successful database write
- [ ] No Socket.io events other than `event:created` and `rsvp:updated` are defined
- [ ] `socketServer.test.ts` tests both emit functions and the auth disconnect case
- [ ] `events.test.ts` verifies emit functions are called with correct arguments
- [ ] `turbo test` passes with zero failures
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P2-04**
> Paste `lib/socketServer.ts` and both test files into Claude with: "Review P2-04 against ADR v0.4 ADR-09. Check: (1) only two Socket.io events are defined: event:created and rsvp:updated — no other events, (2) authentication disconnect is implemented in connection middleware, (3) emitEventCreated targets the family room not individual user rooms, (4) emitRsvpUpdated targets the organizer's user room not the family room, (5) httpServer wraps Express correctly so Socket.io and Express share the same port, (6) both test files verify the correct room targeting."

---

### Prompt P2-05 — Frontend: Family Graph UI (Web)

| Field | Value |
|---|---|
| Prompt ID | P2-05 |
| Build Order | P2-05 |
| Depends On | P2-00, all Phase 1 APIs complete |
| Objective | Build the Family Graph UI in Next.js — member directory, relationship view, and profile pages. |

#### Context for Cursor

This is the first Phase 2 web frontend prompt. The Next.js app (apps/web) was scaffolded in Phase 0 and the auth/onboarding UI was built in P1-12. All new pages use the Next.js 14 App Router and are protected by Clerk authentication. Data fetching uses TanStack Query (React Query v5) with the existing API client pattern. Styling uses Tailwind CSS and shadcn/ui components. The Family Graph UI surfaces the persons and relationships APIs built in Phase 1.

#### Cursor Prompt

```
All work in apps/web/src/app/(protected)/family/

Create the following pages and components. All pages are
protected by Clerk auth (already configured in middleware.ts).

--- API Client (apps/web/src/lib/api/family.ts) ---

Create typed fetch functions using the existing API client pattern:
  getMyFamilies():       Promise<FamilyGroup[]>
  getFamilyDetails(id):  Promise<FamilyDetail>
  getPersons(familyId):  Promise<PersonSummary[]>
  getPerson(personId):   Promise<Person>
  updatePerson(id, data): Promise<Person>

All functions: use fetch with Authorization: Bearer <Clerk session token>
Use the shared types from packages/shared.

--- Pages ---

apps/web/src/app/(protected)/family/page.tsx
  Family dashboard — list of the user's family groups.
  Uses TanStack Query: useQuery(['families'], getMyFamilies)
  Renders a FamilyCard component for each family.
  Loading state: skeleton cards.
  Empty state: "You haven't joined a family yet" with a link to /onboarding.

apps/web/src/app/(protected)/family/[familyId]/page.tsx
  Family detail — member directory for a specific family group.
  Uses TanStack Query: useQuery(['family', familyId], () => getFamilyDetails(familyId))
  Renders:
    - Family name and member count header
    - MemberGrid component (grid of MemberCard components)
    - HouseholdList component (collapsible list of households with their members)
  Loading state: skeleton grid.

apps/web/src/app/(protected)/family/[familyId]/members/[personId]/page.tsx
  Person profile page.
  Uses TanStack Query: useQuery(['person', personId], () => getPerson(personId))
  Renders:
    - PersonHeader: photo (placeholder if none), display name, relationship label
    - ContactInfo: email, phone (only if contactable)
    - UpcomingEvents: events this person is invited to (from family events data)
    - EditButton: visible only if viewer is self or family admin

--- Components ---

Create apps/web/src/components/family/:

  MemberCard.tsx
    Props: person: PersonSummary, familyId: string
    Renders: avatar (initials fallback), display name, relationship label
    Links to /family/[familyId]/members/[person.id]

  MemberGrid.tsx
    Props: members: PersonSummary[], familyId: string
    Renders: responsive grid of MemberCard components
    Empty state: "No members yet"

  HouseholdList.tsx
    Props: households: HouseholdWithMembers[]
    Renders: collapsible list; each household shows name and member count
    Expand to show MemberCard list for that household

  PersonHeader.tsx
    Props: person: Person
    Renders: avatar, display name, relationship label, age gate badge
             (shows "Minor" badge if ageGateLevel = MINOR)

--- Tests ---

Create apps/web/src/components/family/__tests__/MemberCard.test.tsx:
  - Renders display name
  - Renders initials avatar when no photo URL
  - Links to correct person profile URL
  - Does not render contact info (that's PersonHeader's responsibility)

Create apps/web/src/components/family/__tests__/PersonHeader.test.tsx:
  - Renders display name
  - Renders "Minor" badge when ageGateLevel = MINOR
  - Does not render "Minor" badge when ageGateLevel = NONE

Create apps/web/src/app/(protected)/family/__tests__/page.test.tsx:
  - Renders skeleton loading state while query is pending
  - Renders FamilyCard for each family returned
  - Renders empty state when families array is empty
  (Mock useQuery using vi.mock('@tanstack/react-query'))

Do NOT build relationship graph visualization (force-directed graph, etc.)
in this prompt — member directory and profiles only.
Do NOT add edit/update functionality — read-only in this prompt.
```

#### Acceptance Criteria

- [ ] Family dashboard page renders and handles loading, populated, and empty states
- [ ] Family detail page renders MemberGrid and HouseholdList
- [ ] Person profile page renders PersonHeader with Minor badge for MINOR-gated persons
- [ ] All pages use TanStack Query — no direct `useEffect` + `fetch` patterns
- [ ] All pages are under the `(protected)` route group (Clerk-protected)
- [ ] `MemberCard.test.tsx` passes — covers render, initials avatar, and link
- [ ] `PersonHeader.test.tsx` passes — covers Minor badge logic
- [ ] `page.test.tsx` passes — covers loading, populated, and empty states
- [ ] `turbo test` passes with zero failures
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P2-05**
> Paste `components/family/MemberCard.tsx`, `PersonHeader.tsx`, the family page files, and all three test files into Claude with: "Review P2-05. Check: (1) Minor badge is rendered for MINOR ageGateLevel and not for NONE — this is a safety requirement, (2) TanStack Query is used for all data fetching — no bare useEffect+fetch patterns, (3) loading skeleton states are present on all data-dependent pages, (4) empty states are present, (5) all pages are inside the (protected) route group, (6) test files cover the Minor badge case explicitly."

---

### Prompt P2-06 — Frontend: Event Hub UI (Web)

| Field | Value |
|---|---|
| Prompt ID | P2-06 |
| Build Order | P2-06 |
| Depends On | P2-04, P2-05 complete and committed |
| Objective | Build the Event Hub UI in Next.js — event creation, invitation management, RSVP management, organizer dashboard, and Socket.io real-time updates. |

#### Context for Cursor

The Event Hub is the primary wedge feature. The organizer dashboard must show live RSVP updates via Socket.io (`rsvp:updated` event). New events pushed to family members via Socket.io (`event:created`) must appear in the event list without a page refresh. The event creation flow must handle the `create_event` AI proposal flow — when the AI proposes an event, the frontend renders a confirmation card that calls `POST /api/v1/events` on confirm.

#### Cursor Prompt

```
All work in apps/web/src/app/(protected)/events/

--- API Client (apps/web/src/lib/api/events.ts) ---

Create typed fetch functions:
  getEvents(familyId, options?):    Promise<EventSummary[]>
  getEventDetails(eventId):         Promise<EventDetail>
  createEvent(data):                Promise<Event>
  updateRsvp(eventId, status):      Promise<RsvpRecord>
  getRsvpStatus(eventId):           Promise<RsvpSummary>

--- Socket.io Client (apps/web/src/lib/socket.ts) ---

Create the Socket.io client singleton:
  Initialize with: { auth: { token: clerkSessionToken } }
  Export: socket (Socket instance)
  Export: useSocketEvent(event, handler) — React hook that subscribes
    to a socket event and unsubscribes on component unmount

--- Pages ---

apps/web/src/app/(protected)/events/page.tsx
  Event list — upcoming events for the user's active family group.
  Uses TanStack Query for initial data load.
  Uses useSocketEvent('event:created', handler) to prepend new events
  to the list in real-time without a refetch.
  Renders: EventCard list, "Create Event" button (links to /events/new)
  Loading: skeleton cards. Empty: "No upcoming events."

apps/web/src/app/(protected)/events/new/page.tsx
  Event creation form.
  Fields: title, startTime, endTime (optional), location (optional),
          description (optional)
  On submit: calls createEvent(data)
  On success: redirect to /events/[newEventId]
  Validation: title required, startTime required and must be in the future

apps/web/src/app/(protected)/events/[eventId]/page.tsx
  Event detail + organizer dashboard.
  Tabs: Details | Attendees | Organizer (Organizer tab only visible to creator/admin)
  Details tab: title, time, location, description
  Attendees tab: RSVP list grouped by status (Yes / No / Maybe / Pending)
  Organizer tab:
    - Live RSVP counter using useSocketEvent('rsvp:updated', handler)
    - "Send reminder to pending attendees" button (calls notification endpoint)
    - RSVP summary chart (simple bar: yes/no/maybe/pending counts)

--- Components ---

Create apps/web/src/components/events/:

  EventCard.tsx
    Props: event: EventSummary
    Renders: title, date/time, location, RSVP summary pill
    Links to /events/[event.id]

  RsvpButton.tsx
    Props: eventId: string, currentStatus: RsvpStatus | null
    Renders: Yes / No / Maybe buttons
    Calls updateRsvp on click; optimistic update via TanStack Query

  EventConfirmationCard.tsx
    Props: proposal: AiEventProposal, onConfirm: () => void, onCancel: () => void
    Renders: proposed event details in a card with Confirm and Cancel buttons
    Used in the AI chat when create_event tool returns a proposal.
    onConfirm: calls createEvent with proposal data, then redirects to new event.

  OrganizerDashboard.tsx
    Props: eventId: string, initialRsvpSummary: RsvpSummary
    Renders: live RSVP counts updated via useSocketEvent('rsvp:updated')
    Updates count optimistically when rsvp:updated fires

--- Tests ---

Create apps/web/src/components/events/__tests__/EventCard.test.tsx:
  - Renders event title and formatted date
  - Links to correct event detail URL

Create apps/web/src/components/events/__tests__/RsvpButton.test.tsx:
  - Renders three buttons: Yes, No, Maybe
  - Calls updateRsvp with correct status on button click
  - Applies active style to the current status button

Create apps/web/src/components/events/__tests__/EventConfirmationCard.test.tsx:
  - Renders proposed event title, time, location
  - Calls onConfirm when Confirm button is clicked
  - Calls onCancel when Cancel button is clicked
  - Does NOT call createEvent directly (that's onConfirm's responsibility)

Create apps/web/src/components/events/__tests__/OrganizerDashboard.test.tsx:
  - Renders initial RSVP counts from initialRsvpSummary prop
  - Updates counts when rsvp:updated socket event fires
  (Mock useSocketEvent using vi.mock('../../lib/socket'))
```

#### Acceptance Criteria

- [ ] Event list updates in real-time when `event:created` Socket.io event fires (no page refresh required)
- [ ] Organizer dashboard RSVP counts update when `rsvp:updated` fires
- [ ] `EventConfirmationCard` calls `onConfirm` and `onCancel` correctly — does not call `createEvent` internally
- [ ] Event creation form validates that `startTime` is in the future
- [ ] `RsvpButton` applies active styling to current RSVP status
- [ ] All four component test files pass
- [ ] `turbo test` passes with zero failures
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P2-06**
> Paste `components/events/EventConfirmationCard.tsx`, `OrganizerDashboard.tsx`, `lib/socket.ts`, and all four test files into Claude with: "Review P2-06. Check: (1) EventConfirmationCard does not call createEvent internally — it delegates to the onConfirm callback, this is required for the AI propose/confirm pattern, (2) useSocketEvent hook unsubscribes on unmount to prevent memory leaks, (3) OrganizerDashboard test verifies that rsvp:updated socket event updates the displayed counts, (4) RsvpButton test covers the active-style case for current status."

---

### Prompt P2-07 — Frontend: Calendar UI (Web)

| Field | Value |
|---|---|
| Prompt ID | P2-07 |
| Build Order | P2-07 |
| Depends On | P2-06 complete and committed |
| Objective | Build the Shared Calendar UI — unified monthly/weekly calendar view, birthday auto-population, and event detail linking. |

#### Context for Cursor

The Calendar API was built in Phase 1 (P1-09). This prompt builds the web UI on top of it. The calendar must display both events and auto-populated birthdays. Use a lightweight calendar library compatible with React 18 and TypeScript — do not build a calendar from scratch. React Big Calendar or a similar maintained library is acceptable. Check that the chosen library is compatible with Next.js 14 App Router before installing.

#### Cursor Prompt

```
All work in apps/web/src/app/(protected)/calendar/

Install in apps/web:
  Check npmjs.com for the current recommended React calendar library
  compatible with Next.js 14 App Router and React 18.
  Preferred: react-big-calendar with date-fns localizer.
  Confirm compatibility before installing.
  Install: react-big-calendar, date-fns, @types/react-big-calendar (if available)

--- API Client (apps/web/src/lib/api/calendar.ts) ---

Create typed fetch functions:
  getCalendarEvents(familyId, startDate, endDate): Promise<CalendarEvent[]>
  getUpcomingDigest(familyId):                     Promise<DigestSummary>

CalendarEvent type:
  id:        string
  title:     string
  start:     Date
  end:       Date
  type:      'EVENT' | 'BIRTHDAY'
  eventId?:  string  (undefined for birthdays)
  resource?: { location?: string; rsvpSummary?: RsvpSummary }

--- Pages ---

apps/web/src/app/(protected)/calendar/page.tsx
  Unified family calendar.
  Uses TanStack Query to fetch calendar events for the visible date range.
  Refetches when the user navigates to a new month/week.
  Renders: CalendarView component

  On event click:
    If type = 'EVENT': navigate to /events/[eventId]
    If type = 'BIRTHDAY': show a BirthdayPopover (name, age turning)

  View toggle: Month | Week (default: Month)

--- Components ---

Create apps/web/src/components/calendar/:

  CalendarView.tsx
    Props: events: CalendarEvent[], onRangeChange: (start, end) => void,
           onEventClick: (event: CalendarEvent) => void
    Renders: react-big-calendar Calendar component
    Events styled by type: distinct color for BIRTHDAY vs EVENT
    Toolbar: month/week toggle, prev/next navigation

  BirthdayPopover.tsx
    Props: person: { name: string; age: number; dob: string }
    Renders: a popover/tooltip showing "{name} turns {age} today!"
    No navigation on click — informational only.

  UpcomingDigest.tsx
    Props: digest: DigestSummary
    Renders: compact sidebar — "This week" events and birthdays
    Used on the calendar page as a right-side panel.

--- Tests ---

Create apps/web/src/components/calendar/__tests__/CalendarView.test.tsx:
  - Renders without crashing with an empty events array
  - Renders event titles for EVENT type events
  - Renders birthday titles for BIRTHDAY type events
  - Calls onEventClick when an event is clicked
  - Calls onRangeChange when navigation changes the visible range
  (Mock react-big-calendar using vi.mock('react-big-calendar'))

Create apps/web/src/components/calendar/__tests__/BirthdayPopover.test.tsx:
  - Renders the person's name
  - Renders the correct age
  - Does not render a navigation link

Create apps/web/src/app/(protected)/calendar/__tests__/page.test.tsx:
  - Refetches events when onRangeChange fires with a new date range
  - Navigates to /events/[id] when an EVENT type event is clicked
  - Shows BirthdayPopover when a BIRTHDAY type event is clicked
  (Mock useQuery and useRouter)
```

#### Acceptance Criteria

- [ ] Calendar displays both `EVENT` and `BIRTHDAY` type entries with distinct styling
- [ ] Clicking an event navigates to the event detail page
- [ ] Clicking a birthday shows `BirthdayPopover` — no navigation
- [ ] Calendar refetches when the visible date range changes (month/week navigation)
- [ ] All three test files pass
- [ ] `turbo test` passes with zero failures
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P2-07**
> Paste `components/calendar/CalendarView.tsx`, `BirthdayPopover.tsx`, and all three test files into Claude with: "Review P2-07. Check: (1) BIRTHDAY events show BirthdayPopover on click — not navigate to an event detail page, (2) EVENT events navigate to /events/[id] on click, (3) onRangeChange is wired to trigger a TanStack Query refetch with the new date range, (4) the two event types have visually distinct styling applied."

---

### Prompt P2-08 — Frontend: AI Assistant UI (Web)

| Field | Value |
|---|---|
| Prompt ID | P2-08 |
| Build Order | P2-08 |
| Depends On | P2-03, P2-06 complete and committed |
| Objective | Build the AI Assistant chat UI — streaming chat interface, tool result cards, EventConfirmationCard integration, and daily query limit display. |

#### Context for Cursor

The AI Assistant UI connects to the streaming `POST /api/v1/ai/chat` endpoint. Use the Vercel AI SDK `useChat` hook on the frontend — it handles streaming, message history, and tool call rendering. Tool result cards render structured responses inline in the chat (event previews, RSVP summaries, birthday lists). The `create_event` tool returns a proposal — the UI must render `EventConfirmationCard` for AI event proposals and call `createEvent` on confirm. The 20-query daily limit must be surfaced in the UI.

#### Cursor Prompt

```
All work in apps/web/src/app/(protected)/assistant/

Install in apps/web:
  ai (Vercel AI SDK — already in apps/api; install in apps/web too for useChat)
  @ai-sdk/react

--- Pages ---

apps/web/src/app/(protected)/assistant/page.tsx
  AI Assistant chat interface.

  State:
    familyGroupId:  string (from user's active family — fetch on mount)
    queryStatus:    { queriesRemaining: number; resetAt: Date }

  Data:
    Use useChat hook from Vercel AI SDK:
      api: '/api/ai/chat'  (proxy via Next.js route handler)
      body: { familyGroupId }
      onFinish: refetch queryStatus

  Layout:
    Header: "FamLink Assistant" + RateLimitBadge (shows queries remaining)
    Message list: scrollable, auto-scroll to bottom on new message
    Input: ChatInput component (text input + send button)
    Empty state: suggested prompts ("When is Dad's birthday?",
                 "What's on the calendar this weekend?",
                 "Who hasn't responded to Easter dinner?")

  Message rendering:
    user messages: right-aligned bubble
    assistant messages: left-aligned bubble with streaming support
    tool results: render ToolResultCard inline in the assistant message

--- Next.js API Route (proxy to Express) ---

Create apps/web/src/app/api/ai/chat/route.ts
  This is a Next.js API route handler that proxies the streaming
  response from the Express AI endpoint.
  POST: forward request body + Clerk auth token to
        ${process.env.API_URL}/api/v1/ai/chat
  Stream the response back to the client using the Response object.
  This avoids CORS issues and keeps the Clerk token server-side.

--- Components ---

Create apps/web/src/components/assistant/:

  ChatMessage.tsx
    Props: message: Message (Vercel AI SDK type), familyGroupId: string
    Renders:
      - User message: right-aligned bubble
      - Assistant text: left-aligned bubble (streaming: render as it arrives)
      - Tool results: detect tool result content parts and render ToolResultCard
      - AI event proposals: detect create_event result with proposed: true
        and render EventConfirmationCard

  ToolResultCard.tsx
    Props: toolName: string, result: unknown
    Renders a structured card appropriate for each tool:
      get_upcoming_events:   event list with titles and dates
      get_rsvp_status:       RSVP counts by status with names
      get_upcoming_birthdays: birthday list with days-until countdown
      get_person / get_family_members: person summary list
      get_contact_info:      name, email, phone card
      get_relationship_path: relationship description text in a styled callout
      get_household_members: member list
      get_event_details:     event detail card
      create_event (proposed: true): render EventConfirmationCard
      Default fallback:      render result as formatted JSON

  ChatInput.tsx
    Props: onSend: (message: string) => void, disabled: boolean
    Renders: text input + send button
    Send on Enter (Shift+Enter for newline)
    Disabled when: isLoading from useChat, or queriesRemaining = 0

  RateLimitBadge.tsx
    Props: remaining: number, resetAt: Date
    Renders: "{remaining} queries left today"
    Warning style (orange) when remaining <= 5
    Disabled style (red) when remaining = 0

  SuggestedPrompts.tsx
    Props: onSelect: (prompt: string) => void
    Renders: clickable prompt chips shown only when message history is empty

--- Tests ---

Create apps/web/src/components/assistant/__tests__/ToolResultCard.test.tsx:
  - Renders event list for get_upcoming_events result
  - Renders RSVP counts for get_rsvp_status result
  - Renders EventConfirmationCard when create_event result has proposed: true
  - Renders JSON fallback for unknown tool name

Create apps/web/src/components/assistant/__tests__/RateLimitBadge.test.tsx:
  - Renders correct count
  - Applies warning style when remaining <= 5
  - Applies disabled style when remaining = 0

Create apps/web/src/components/assistant/__tests__/ChatInput.test.tsx:
  - Calls onSend with input value when Enter is pressed
  - Does not call onSend on Shift+Enter
  - Is disabled when disabled prop is true
  - Clears input after send

Create apps/web/src/components/assistant/__tests__/ChatMessage.test.tsx:
  - Renders user message right-aligned
  - Renders assistant text message
  - Renders ToolResultCard when message contains tool result content
  - Renders EventConfirmationCard when create_event result has proposed: true
```

#### Acceptance Criteria

- [ ] Chat interface streams assistant responses word-by-word using `useChat`
- [ ] `ToolResultCard` renders `EventConfirmationCard` when `create_event` result has `proposed: true`
- [ ] `RateLimitBadge` shows warning style at ≤5 remaining and disabled style at 0
- [ ] `ChatInput` is disabled when `queriesRemaining = 0`
- [ ] Suggested prompts appear only when the message history is empty
- [ ] Next.js proxy route forwards auth token server-side — Clerk token not exposed to client fetch
- [ ] All four test files pass
- [ ] `turbo test` passes with zero failures
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P2-08**
> Paste `components/assistant/ToolResultCard.tsx`, `ChatMessage.tsx`, `RateLimitBadge.tsx`, and all four test files into Claude with: "Review P2-08. Check: (1) ToolResultCard correctly routes create_event proposals (proposed: true) to EventConfirmationCard — not the generic fallback, (2) RateLimitBadge warning threshold is exactly 5, (3) ChatInput send is disabled at 0 remaining queries — verify the disabled prop is wired correctly, (4) the Next.js proxy route forwards the Clerk auth token server-side, (5) all four test files cover the critical rendering paths."

---

### Prompt P2-09 — Mobile: Core Screens (Expo)

| Field | Value |
|---|---|
| Prompt ID | P2-09 |
| Build Order | P2-09 |
| Depends On | All APIs complete (P2-03, P2-04), all web UIs complete (P2-05 through P2-08) |
| Objective | Build the React Native (Expo) mobile app covering wedge features only: authentication, family graph, event hub, calendar, and AI assistant. Functional parity with the web UI on core flows — no mobile-exclusive features. |

#### Context for Cursor

The Expo app scaffold (apps/mobile) was set up in Phase 0. Expo Router handles navigation. Shared TypeScript types come from packages/shared. The API client calls the same Express API as the web. Socket.io client for real-time uses `socket.io-client`. Push notification device token registration with Firebase (FCM) happens here — the server-side FCM infrastructure was built in P1-11. Styling uses React Native's StyleSheet — no Tailwind (mobile uses native styling). shadcn/ui components are web-only; build equivalent native components.

#### Cursor Prompt

```
All work in apps/mobile/src/

Install in apps/mobile (confirm each is not already present):
  @clerk/clerk-expo
  socket.io-client
  @react-native-firebase/app
  @react-native-firebase/messaging
  @tanstack/react-query
  react-native-calendars (for calendar view)

--- Navigation (apps/mobile/src/app/) ---

Using Expo Router file-based routing:

  _layout.tsx           Root layout — ClerkProvider, QueryClientProvider,
                        React Query client, Socket.io connection initialization
  (auth)/
    sign-in.tsx         Clerk sign-in screen (useSignIn hook)
    sign-up.tsx         Clerk sign-up screen (useSignUp hook)
  (protected)/
    _layout.tsx         Protected layout — redirect to sign-in if not authed
    index.tsx           Home dashboard — family group selector
    family/
      [familyId].tsx    Member directory
      member/[personId].tsx  Person profile
    events/
      index.tsx         Event list (real-time via socket)
      [eventId].tsx     Event detail + RSVP
      new.tsx           Create event form
    calendar/
      index.tsx         Family calendar
    assistant/
      index.tsx         AI chat interface

--- API Client (apps/mobile/src/lib/api.ts) ---

Typed fetch functions mirroring the web API client.
Use Clerk's useAuth() to get the session token for Authorization headers.
Functions:
  getMyFamilies, getFamilyDetails, getEvents, getEventDetails,
  createEvent, updateRsvp, getCalendarEvents, sendChatMessage

--- Socket.io Client (apps/mobile/src/lib/socket.ts) ---

Initialize socket.io-client with Clerk session token.
Export: socket instance
Export: useSocketEvent(event, handler) hook (same pattern as web)

--- Push Notifications (apps/mobile/src/lib/pushNotifications.ts) ---

On app startup (in root _layout.tsx):
  1. Request notification permissions using @react-native-firebase/messaging
  2. If granted: get FCM token via messaging().getToken()
  3. POST the token to /api/v1/persons/me/fcm-token
     (Add this endpoint to apps/api/src/routes/persons.ts:
      PUT /api/v1/persons/me/fcm-token
      Body: { token: string }
      Saves FCM token to person record — add fcmToken field to Prisma schema)
  4. Listen for foreground messages: messaging().onMessage()
     Display using a local notification or in-app banner.

--- Screens ---

Build each screen with:
  - Loading state (ActivityIndicator)
  - Error state (error message + retry button)
  - Empty state (descriptive message)

Home (index.tsx):
  List of user's family groups. Tap to navigate to family/[familyId].
  "Create Family" button (navigate to onboarding flow).

Member Directory (family/[familyId].tsx):
  FlatList of MemberCard (native) components.
  Search bar (filter by name, client-side).

Person Profile (family/member/[personId].tsx):
  Avatar, display name, relationship, contact info.
  "Minor" label if ageGateLevel = MINOR.
  Contact buttons: tap email → open mail app, tap phone → open dialer.

Event List (events/index.tsx):
  FlatList of EventCard (native) components.
  Real-time: useSocketEvent('event:created') prepends new events.
  FAB (floating action button) to create new event.

Event Detail (events/[eventId].tsx):
  Title, date/time, location, description.
  RSVP buttons: Yes / No / Maybe.
  Attendee list grouped by status.
  For organizer: live RSVP count via useSocketEvent('rsvp:updated').

Create Event (events/new.tsx):
  Form: title, date/time picker, location, description.
  Submit → createEvent API call → navigate to new event.

Calendar (calendar/index.tsx):
  react-native-calendars CalendarList.
  Mark event and birthday dates with dots (distinct colors).
  Tap marked date → show DayEventList bottom sheet.

AI Assistant (assistant/index.tsx):
  FlatList of chat messages (scrollable, auto-scroll to bottom).
  TextInput + send button.
  Render ToolResultCard (native) for tool results inline.
  Render EventConfirmationCard (native) for create_event proposals.
  RateLimitBadge (native) in the header.

--- Native Components ---

Create apps/mobile/src/components/:
  MemberCard.tsx     (native equivalent of web MemberCard)
  EventCard.tsx      (native)
  ToolResultCard.tsx (native — text-based rendering of tool results)
  EventConfirmationCard.tsx (native — mirrors web version)
  RateLimitBadge.tsx (native)
  ChatMessage.tsx    (native)

--- Tests ---

Create apps/mobile/src/components/__tests__/MemberCard.test.tsx:
  - Renders display name
  - Renders "Minor" label when ageGateLevel = MINOR
  - Calls navigation function on press

Create apps/mobile/src/components/__tests__/EventConfirmationCard.test.tsx:
  - Renders proposed event title
  - Calls onConfirm when Confirm is pressed
  - Calls onCancel when Cancel is pressed

Create apps/mobile/src/components/__tests__/RateLimitBadge.test.tsx:
  - Renders correct count
  - Shows warning style when remaining <= 5
  - Shows disabled style when remaining = 0

Create apps/mobile/src/components/__tests__/ToolResultCard.test.tsx:
  - Renders event list for get_upcoming_events
  - Renders EventConfirmationCard for create_event with proposed: true

Do NOT build any mobile-exclusive features.
Do NOT use shadcn/ui — mobile uses React Native native components.
Do NOT use Tailwind — mobile uses StyleSheet.
```

#### Acceptance Criteria

- [ ] Expo app builds without errors (`npx expo export` completes)
- [ ] All five core sections are navigable: Family, Events, Calendar, Assistant, Home
- [ ] FCM token is registered on startup and saved to the person record via the new API endpoint
- [ ] Minor label appears on person profile for `MINOR` ageGateLevel
- [ ] Event list updates in real-time via Socket.io `event:created` event
- [ ] `EventConfirmationCard` (native) calls `onConfirm` and `onCancel` correctly
- [ ] All four test files pass with Jest + Expo preset
- [ ] `turbo test` passes with zero failures across all packages
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P2-09**
> Paste `components/MemberCard.tsx`, `EventConfirmationCard.tsx`, `lib/pushNotifications.ts`, and all four test files into Claude with: "Review P2-09. Check: (1) Minor label is rendered for MINOR ageGateLevel — safety requirement, (2) FCM token registration includes the permissions request before calling getToken — never call getToken without permission, (3) EventConfirmationCard does not call createEvent internally — delegates to onConfirm, (4) socket.io-client is initialized with the Clerk session token for authentication, (5) all four test files use the Jest Expo preset and pass."

---

### Prompt P2-10 — Cloudflare R2 + Photo Sharing

| Field | Value |
|---|---|
| Prompt ID | P2-10 |
| Build Order | P2-10 |
| Depends On | P2-05, P2-09 complete and committed |
| Objective | Integrate Cloudflare R2 for media storage. Add photo upload to person profiles. Add photo sharing to events (event cover photo). Deliver on web and mobile. |

#### Context for Cursor

Cloudflare R2 was locked in ADR-10 as the media storage provider. R2 is S3-compatible — use the AWS SDK v3 S3 client pointed at the R2 endpoint. All uploads go through the API — the client never uploads directly to R2 (no presigned upload URLs in Phase 2; server-side upload only). Profile photos are stored at `profiles/{personId}/{filename}`. Event photos are stored at `events/{eventId}/{filename}`. Maximum file size: 5MB. Accepted types: image/jpeg, image/png, image/webp.

#### Cursor Prompt

```
Install in apps/api:
  @aws-sdk/client-s3
  @aws-sdk/lib-storage  (for multipart upload)
  multer               (multipart form parsing)
  @types/multer

Add to apps/api/src/lib/env.ts:
  R2_ACCOUNT_ID:        string
  R2_ACCESS_KEY_ID:     string
  R2_SECRET_ACCESS_KEY: string
  R2_BUCKET_NAME:       string
  R2_PUBLIC_URL:        string  (CDN URL for serving media)

--- R2 Client (apps/api/src/lib/r2Client.ts) ---

Create apps/api/src/lib/r2Client.ts

Initialize S3Client from @aws-sdk/client-s3:
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  region: 'auto'
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }

Export async function uploadToR2(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string>
  Uploads the buffer to R2 at the given key.
  Returns the public CDN URL: `${R2_PUBLIC_URL}/${key}`

Export async function deleteFromR2(key: string): Promise<void>
  Deletes the object at key from R2.
  Does not throw if the object does not exist.

Export function generateMediaKey(
  scope: 'profiles' | 'events',
  entityId: string,
  filename: string
): string
  Returns: `${scope}/${entityId}/${Date.now()}-${sanitizedFilename}`
  Sanitize: replace spaces with hyphens, remove non-alphanumeric except hyphens and dots.

--- Upload Middleware (apps/api/src/middleware/upload.ts) ---

Create apps/api/src/middleware/upload.ts

Configure multer:
  storage: memoryStorage (buffer in req.file.buffer — no disk writes)
  limits: { fileSize: 5 * 1024 * 1024 }  (5MB)
  fileFilter: accept only image/jpeg, image/png, image/webp
              reject all others with: new Error('Invalid file type')

Export: uploadSingle (multer().single('photo'))

--- Photo Endpoints (apps/api/src/routes/media.ts) ---

Create apps/api/src/routes/media.ts

POST /api/v1/persons/:personId/photo
  Requires: requireAuth + uploadSingle middleware
  Authorization: requester must be the person themselves or family admin
  Steps:
    1. Validate file is present (400 if missing)
    2. Generate key: generateMediaKey('profiles', personId, file.originalname)
    3. Upload to R2: uploadToR2(key, file.buffer, file.mimetype)
    4. Update person.profilePhotoUrl in Prisma with the returned CDN URL
    5. If person previously had a photo: deleteFromR2 for the old key
       (Extract old key from old URL by stripping R2_PUBLIC_URL prefix)
    6. Return: { profilePhotoUrl: string }

POST /api/v1/events/:eventId/photo
  Requires: requireAuth + uploadSingle middleware
  Authorization: requester must be event organizer or family admin
  Steps: same pattern as profile photo, using 'events' scope.
  Update event.coverPhotoUrl in Prisma.
  Return: { coverPhotoUrl: string }

Add coverPhotoUrl field to Event model in schema.prisma (nullable String).
Run: npx prisma migrate dev --name add_event_cover_photo

Mount in index.ts:
  router.use('/api/v1', requireAuth, mediaRouter)

--- Web UI Updates ---

Update apps/web/src/components/family/PersonHeader.tsx:
  Add photo upload button (visible to self/admin only).
  On file select: POST to /api/v1/persons/:personId/photo with FormData.
  Show upload progress. On success: invalidate TanStack Query person cache.

Update apps/web/src/app/(protected)/events/[eventId]/page.tsx:
  Add cover photo display at top of event detail.
  Organizer tab: add photo upload button.

--- Mobile UI Updates ---

Update apps/mobile/src/app/(protected)/family/member/[personId].tsx:
  Add photo upload using Expo ImagePicker.
  On photo selected: upload to /api/v1/persons/:personId/photo.
  Show upload progress indicator.

--- Tests ---

Create apps/api/src/lib/__tests__/r2Client.test.ts:
  Mock @aws-sdk/client-s3 using vi.mock
  - uploadToR2 calls PutObjectCommand with correct key and contentType
  - uploadToR2 returns the correct CDN URL format
  - deleteFromR2 calls DeleteObjectCommand with correct key
  - deleteFromR2 does not throw when object does not exist
  - generateMediaKey produces correct format: scope/entityId/timestamp-filename
  - generateMediaKey sanitizes spaces and special characters

Create apps/api/src/routes/__tests__/media.test.ts:
  Mock uploadToR2 and deleteFromR2 using vi.mock
  - POST /api/v1/persons/:personId/photo returns 400 when no file is attached
  - POST /api/v1/persons/:personId/photo returns 403 for unauthorized requester
  - POST /api/v1/persons/:personId/photo calls uploadToR2 and updates person record
  - POST /api/v1/persons/:personId/photo calls deleteFromR2 when replacing existing photo
  - POST /api/v1/events/:eventId/photo returns 403 for non-organizer

Create apps/api/src/middleware/__tests__/upload.test.ts:
  - Rejects files over 5MB
  - Rejects non-image MIME types (e.g. application/pdf)
  - Accepts image/jpeg, image/png, image/webp
```

#### Acceptance Criteria

- [ ] Prisma migration `add_event_cover_photo` runs cleanly
- [ ] `uploadToR2` correctly calls `PutObjectCommand` and returns the CDN URL
- [ ] `deleteFromR2` does not throw when the object does not exist
- [ ] `generateMediaKey` sanitizes filenames (no spaces or special characters)
- [ ] Profile photo upload replaces the old photo (deletes from R2) — no orphaned files
- [ ] Upload middleware rejects files over 5MB and non-image MIME types
- [ ] `r2Client.test.ts`, `media.test.ts`, and `upload.test.ts` all pass
- [ ] `turbo test` passes with zero failures across all packages
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P2-10**
> Paste `lib/r2Client.ts`, `routes/media.ts`, `middleware/upload.ts`, and all three test files into Claude with: "Review P2-10 against ADR v0.4 ADR-10. Check: (1) multer uses memoryStorage — no files are written to disk, (2) deleteFromR2 is called when replacing an existing photo — no orphaned files in R2, (3) generateMediaKey sanitization removes spaces and special characters, (4) the old photo key is correctly extracted from the existing URL before deletion, (5) upload middleware file filter covers all three accepted types and rejects others, (6) media.test.ts explicitly tests the delete-on-replace behavior."

---

## 5. Phase 2 Completion Checklist

Before declaring Phase 2 complete and preparing for investor conversations:

| # | Item | Check |
|---|---|---|
| 5.1 | `turbo test` passes with zero failures across all packages | ☐ |
| 5.2 | Coverage reports show ≥80% line coverage on all new Phase 2 files | ☐ |
| 5.3 | `turbo type-check` passes with zero TypeScript errors | ☐ |
| 5.4 | Prisma 7 in place — no 5.16.0 references remain in package.json | ☐ |
| 5.5 | Graph traversal spike results documented in `graphSpikeResults.md` | ☐ |
| 5.6 | All 10 Layer 1 AI tools exercised in a live demo against Johnson seed data | ☐ |
| 5.7 | `create_event` tool confirmed to NOT write to DB without user confirmation | ☐ |
| 5.8 | MINOR-gated persons confirmed to NOT appear in any AI tool response | ☐ |
| 5.9 | Socket.io real-time confirmed working: event push + RSVP push | ☐ |
| 5.10 | Expo mobile app installs and runs on a physical device | ☐ |
| 5.11 | FCM push notification received on mobile device from a test trigger | ☐ |
| 5.12 | Helicone dashboard shows requests, costs, and logs from AI queries | ☐ |
| 5.13 | Cloudflare R2 bucket contains test profile photo; CDN URL resolves | ☐ |
| 5.14 | git log shows commits for P2-00 through P2-10 | ☐ |
| 5.15 | ADR v0.4 is the governing document; no decisions deviated from it | ☐ |

---

*FamLink Cursor Prompt Library — Phase 2 — Version 1.0 — April 2026 — CONFIDENTIAL*

*This document governs all Phase 2 development. ADR v0.4 takes precedence in any conflict.*
