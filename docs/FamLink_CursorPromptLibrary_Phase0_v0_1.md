# FamLink
## The Family Operating System
### Cursor Prompt Library | Phase 0: Foundation

**Version 0.1 - Working Draft**
March 2026 | CONFIDENTIAL

---

# 1. Purpose & How to Use This Document

This document contains the sequenced Cursor prompt library for FamLink Phase 0 - the Foundation build. Each prompt is designed to be pasted directly into Cursor's composer, producing a discrete, testable unit of the codebase.

## 1.1 The Claude → Cursor → Claude Workflow

Every build step follows this three-phase loop:

| Phase | Tool | Action |
|-------|------|--------|
| Plan | Claude | Read this document. Understand the prompt objective, context, and acceptance criteria before opening Cursor. |
| Build | Cursor | Paste the prompt into Cursor Composer (Ctrl+Shift+I). Review generated code. Accept or iterate within Cursor until the acceptance criteria are met. |
| Review | Claude | Paste the generated code back into Claude with the prompt: "Review this output against the FamLink ADR and acceptance criteria for Prompt [ID]." Address any flagged issues before moving to the next prompt. |

## 1.2 Critical Rules

- Never skip a prompt. Each prompt depends on the deliverables of the ones before it. The build dependency map in the ADR is the authority.
- Do not modify the stack. All technology choices are LOCKED in ADR v0.1. If Cursor suggests an alternative library, reject it and reference the ADR.
- TypeScript strict mode is non-negotiable. Every file generated must compile with zero TypeScript errors before the prompt is marked complete.
- Claude review is mandatory. The review step catches architectural drift before it compounds. Do not skip it to save time.
- Commit after each prompt. Each accepted prompt output is a separate Git commit with a message referencing the Prompt ID (e.g., feat: P0-01 turborepo scaffold).

---

# 2. Resolved Decision: Monorepo Tooling

**ADR Open Question #1 - RESOLVED**

The ADR flagged monorepo tooling as HIGH priority and required resolution before the first Cursor prompt. This section documents the decision and rationale. Steve: please confirm or override before build begins.

## 2.1 Decision: Turborepo

Selected tool: Turborepo (by Vercel) with npm workspaces as the package manager.

## 2.2 Options Considered

| Option | Verdict | Reason |
|--------|---------|--------|
| Turborepo | SELECTED | Built by Vercel - native integration with Next.js. Fastest build caching. Excellent AI coding tool support. Simple configuration. Ideal for Next.js + Expo monorepo at this scale. |
| Nx | Rejected | Powerful but over-engineered for a two-app monorepo. Steep learning curve. Complex configuration increases AI-generated code inconsistency risk. |
| npm workspaces only | Rejected | No build orchestration or caching. Works but creates manual overhead as the codebase grows. Turborepo sits on top of npm workspaces - no conflict. |

## 2.3 Resulting Monorepo Structure

```
famlink/
├── apps/
│   ├── web/           Next.js 14 app (ADR-01)
│   └── mobile/        Expo / React Native app (ADR-02)
├── packages/
│   ├── shared/        Shared TypeScript types, constants, utilities
│   ├── db/            Prisma schema, client, migrations (ADR-04)
│   └── config/        Shared ESLint, TypeScript, Tailwind configs
├── turbo.json         Turborepo pipeline configuration
├── package.json       Root workspace definition
└── .github/
    └── workflows/     CI pipeline (lint, type-check, test)
```

> **Action required before Build Order 1:** Confirm or override this decision. If confirmed, it becomes a LOCKED ADR decision and will be added to ADR v0.2. Reply "Confirmed: Turborepo" to proceed.

---

# 3. Phase 0 Overview

Phase 0 covers ADR Build Orders 1 and 2. It produces the runnable skeleton that all subsequent development builds upon. No application features are built in Phase 0 - only the infrastructure that makes building features possible.

| Prompt | Build Order | Status | Deliverable |
|--------|-------------|--------|-------------|
| P0-01 | 1 | Ready | Turborepo monorepo scaffold with npm workspaces, shared TypeScript config, and ESLint config |
| P0-02 | 1 | Ready | Shared types package: all cross-app TypeScript interfaces, enums, and constants |
| P0-03 | 1 | Ready | GitHub Actions CI pipeline: lint, type-check, and build on every pull request |
| P0-04 | 2 | Depends on P0-01 | Prisma setup: connection to Railway PostgreSQL, client configuration, migration tooling |
| P0-05 | 2 | Depends on P0-04 | Core identity schema: persons, family_groups, households, household_members, family_members tables |
| P0-06 | 2 | Depends on P0-05 | Relationship graph schema: relationships table with full relationship type enum |
| P0-07 | 2 | Depends on P0-05 | Event and RSVP schema: events, event_invitations, rsvps, potluck_assignments tables |
| P0-08 | 2 | Depends on P0-05 | Seed data: realistic test family with members, relationships, households, and one sample event |

---

# 4. Prompts

## Prompt P0-01 - Turborepo Monorepo Scaffold

| Field | Value |
|-------|-------|
| Prompt ID | P0-01 |
| Build Order | Build Order 1 |
| Depends On | Nothing - this is the starting point |
| Objective | Create the Turborepo monorepo root with npm workspaces, shared configs, and the app and package directory structure |

### Context for Cursor

Give Cursor this context before pasting the prompt:

```
We are building FamLink, a family coordination platform. The tech stack is:
  - Turborepo monorepo with npm workspaces
  - apps/web: Next.js 14 with App Router (TypeScript strict)
  - apps/mobile: Expo with Expo Router (TypeScript strict)
  - packages/shared: Shared types and utilities
  - packages/db: Prisma client and schema
  - packages/config: Shared ESLint and TypeScript configs
  - Tailwind CSS + shadcn/ui on web
  - NativeWind on mobile
Every file must use TypeScript strict mode. No JavaScript files.
Do not install any packages not listed in this prompt.
```

### Cursor Prompt

```
Create a Turborepo monorepo scaffold for a project called "famlink".

Root package.json:
  - name: "famlink"
  - private: true
  - workspaces: ["apps/*", "packages/*"]
  - scripts: build, dev, lint, type-check (all delegating to turbo)

turbo.json pipeline:
  - build: depends on ^build, outputs: [".next/**", "dist/**"]
  - dev: cache: false, persistent: true
  - lint: outputs: []
  - type-check: outputs: []

packages/config/tsconfig.base.json:
  - strict: true
  - target: ES2022
  - moduleResolution: bundler
  - jsx: preserve
  - esModuleInterop: true
  - skipLibCheck: true
  - forceConsistentCasingInFileNames: true

packages/config/eslint-base.js:
  - Extends: @typescript-eslint/recommended
  - Rules: no-console warn, @typescript-eslint/no-unused-vars error
  - Ignores: node_modules, .next, dist

apps/web/:
  - Initialize Next.js 14 App Router with TypeScript strict
  - Extend packages/config/tsconfig.base.json
  - Install: next@14, react, react-dom, typescript, @types/node, @types/react
  - Install: tailwindcss, autoprefixer, postcss
  - Create: app/layout.tsx, app/page.tsx (minimal placeholder)
  - next.config.ts with transpilePackages: ["@famlink/shared"]

apps/mobile/:
  - Initialize Expo project with Expo Router and TypeScript
  - app.json: name "FamLink", slug "famlink"
  - Extend packages/config/tsconfig.base.json
  - Install: expo, expo-router, react-native, nativewind
  - Create: app/_layout.tsx, app/index.tsx (minimal placeholder)

packages/shared/:
  - name: "@famlink/shared"
  - TypeScript package, no framework dependencies
  - Create: src/index.ts (empty barrel export for now)
  - tsconfig.json extending packages/config/tsconfig.base.json

packages/db/:
  - name: "@famlink/db"
  - Install: prisma, @prisma/client
  - Create: prisma/schema.prisma (minimal skeleton - datasource postgresql, generator client)
  - Create: src/index.ts exporting PrismaClient singleton
  - tsconfig.json extending packages/config/tsconfig.base.json

Root .gitignore: node_modules, .next, dist, .env, .env.local, *.env
Root .env.example: DATABASE_URL="postgresql://user:password@localhost:5432/famlink"

Do not run npm install - just generate the files.
```

### Acceptance Criteria

| Acceptance criterion | |
|----------------------|-|
| Directory structure matches the monorepo layout defined in Section 2.3 | [ ] |
| turbo.json pipeline is valid and has all four tasks: build, dev, lint, type-check | [ ] |
| packages/config/tsconfig.base.json has strict: true and all required compiler options | [ ] |
| apps/web/tsconfig.json extends the shared base config | [ ] |
| apps/mobile/tsconfig.json extends the shared base config | [ ] |
| @famlink/shared and @famlink/db are defined as local workspace packages | [ ] |
| packages/db/prisma/schema.prisma has a valid datasource and generator block | [ ] |
| .env.example is present at the root with DATABASE_URL | [ ] |
| No JavaScript files exist - everything is TypeScript | [ ] |
| No unexpected packages are installed beyond those specified in the prompt | [ ] |

**Claude Review Prompt:** After Cursor completes P0-01, paste the generated file tree and key config files into Claude with: "Review P0-01 output against the FamLink ADR. Check monorepo structure, TypeScript config, and Turborepo pipeline for any deviations from ADR-01, ADR-02, or ADR-04."

---

## Prompt P0-02 - Shared Types Package

| Field | Value |
|-------|-------|
| Prompt ID | P0-02 |
| Build Order | Build Order 1 |
| Depends On | P0-01 complete and committed |
| Objective | Define all cross-app TypeScript types, interfaces, enums, and constants in the @famlink/shared package |

### Context for Cursor

```
We are working in the @famlink/shared package (packages/shared/).
This package contains ALL shared TypeScript types used across apps/web and apps/mobile.
It has zero runtime dependencies - types only.
The FamLink data model is a family relationship graph.
Key concepts: Person, Household, FamilyGroup, Relationship, Event, RSVP.
```

### Cursor Prompt

```
In packages/shared/src/, create the following TypeScript files.
No runtime code - types, interfaces, and enums only.

--- types/person.ts ---
export interface Person {
  id: string
  userId: string | null  // null = guest/child with no account
  firstName: string
  lastName: string
  preferredName: string | null
  dateOfBirth: string | null  // ISO date string
  isMinor: boolean
  profilePhotoUrl: string | null
  createdAt: string
  updatedAt: string
}

--- types/family.ts ---
export interface FamilyGroup {
  id: string
  name: string
  createdByPersonId: string
  settings: FamilyGroupSettings
  createdAt: string
}
export interface FamilyGroupSettings {
  aiEnabled: boolean
  defaultVisibility: VisibilityTier
}
export interface Household {
  id: string
  familyGroupId: string
  name: string
  address: HouseholdAddress | null
  createdAt: string
}
export interface HouseholdAddress {
  street: string
  city: string
  state: string
  zip: string
  country: string
}

--- types/relationship.ts ---
export enum RelationshipType {
  SPOUSE = "SPOUSE", PARTNER = "PARTNER", EX_SPOUSE = "EX_SPOUSE",
  PARENT = "PARENT", CHILD = "CHILD",
  STEP_PARENT = "STEP_PARENT", STEP_CHILD = "STEP_CHILD",
  ADOPTIVE_PARENT = "ADOPTIVE_PARENT", ADOPTIVE_CHILD = "ADOPTIVE_CHILD",
  SIBLING = "SIBLING", HALF_SIBLING = "HALF_SIBLING", STEP_SIBLING = "STEP_SIBLING",
  GRANDPARENT = "GRANDPARENT", GRANDCHILD = "GRANDCHILD",
  AUNT_UNCLE = "AUNT_UNCLE", NIECE_NEPHEW = "NIECE_NEPHEW", COUSIN = "COUSIN",
  CAREGIVER = "CAREGIVER", GUARDIAN = "GUARDIAN", FAMILY_FRIEND = "FAMILY_FRIEND",
}
export interface Relationship {
  id: string
  fromPersonId: string
  toPersonId: string
  type: RelationshipType
  familyGroupId: string
  notes: string | null
  createdAt: string
}

--- types/event.ts ---
export enum RSVPStatus { YES = "YES", NO = "NO", MAYBE = "MAYBE", PENDING = "PENDING" }
export enum InviteScope { INDIVIDUAL = "INDIVIDUAL", HOUSEHOLD = "HOUSEHOLD", FAMILY = "FAMILY" }
export interface FamLinkEvent {
  id: string
  familyGroupId: string
  createdByPersonId: string
  title: string
  description: string | null
  startAt: string  // ISO datetime
  endAt: string | null
  location: EventLocation | null
  visibility: VisibilityTier
  isRecurring: boolean
  createdAt: string
}
export interface EventLocation {
  name: string | null
  address: string | null
  googleMapsUrl: string | null
}
export interface RSVP {
  id: string
  eventId: string
  personId: string
  status: RSVPStatus
  guestToken: string | null  // set for Reluctant Member / guest RSVPs
  respondedAt: string | null
}

--- types/notification.ts ---
export enum NotificationChannel { EMAIL = "EMAIL", SMS = "SMS", PUSH = "PUSH" }
export enum NotificationType {
  EVENT_INVITE = "EVENT_INVITE", RSVP_RECEIVED = "RSVP_RECEIVED",
  EVENT_REMINDER = "EVENT_REMINDER", BIRTHDAY_REMINDER = "BIRTHDAY_REMINDER",
  FAMILY_JOIN = "FAMILY_JOIN", WEEKLY_DIGEST = "WEEKLY_DIGEST",
}

--- types/visibility.ts ---
export enum VisibilityTier {
  PRIVATE = "PRIVATE",
  HOUSEHOLD = "HOUSEHOLD",
  FAMILY = "FAMILY",
  INVITED = "INVITED",
  GUEST = "GUEST",
}

--- types/roles.ts ---
export enum FamilyRole {
  ORGANIZER = "ORGANIZER", MEMBER = "MEMBER", GUEST = "GUEST", ADMIN = "ADMIN"
}

--- index.ts ---
Re-export everything from all type files as a single barrel export.
```

### Acceptance Criteria

| Acceptance criterion | |
|----------------------|-|
| All files are TypeScript - no JavaScript, no runtime code | [ ] |
| RelationshipType enum contains all 19 types specified in ADR-04 | [ ] |
| RSVPStatus enum has exactly four values: YES, NO, MAYBE, PENDING | [ ] |
| VisibilityTier enum has exactly five values matching the ADR privacy model | [ ] |
| Person.userId is nullable (string \| null) to support guest/child records | [ ] |
| RSVP.guestToken is nullable - required for Reluctant Member participation (ADR-05) | [ ] |
| FamLinkEvent uses "FamLinkEvent" not "Event" to avoid collision with DOM Event type | [ ] |
| packages/shared/src/index.ts re-exports all types as a barrel | [ ] |
| tsc --noEmit passes with zero errors in the packages/shared context | [ ] |

**Claude Review Prompt:** Paste all type files into Claude with: "Review P0-02 shared types against the FamLink PRD data model and ADR relationship type registry. Flag any missing types, incorrect nullability, or naming conflicts."

---

## Prompt P0-03 - GitHub Actions CI Pipeline

| Field | Value |
|-------|-------|
| Prompt ID | P0-03 |
| Build Order | Build Order 1 |
| Depends On | P0-01 complete and committed |
| Objective | Create the GitHub Actions CI workflow that runs lint, type-check, and build on every pull request |

### Cursor Prompt

```
Create .github/workflows/ci.yml for the FamLink Turborepo monorepo.

Trigger: on push to main branch and on all pull_request events.

Jobs:

1. lint-and-typecheck:
   - runs-on: ubuntu-latest
   - Node.js version: 20
   - Steps: checkout, setup-node with npm cache, npm ci, turbo type-check, turbo lint
   - Use actions/cache for Turborepo cache: key = turbo-${{ runner.os }}-${{ hashFiles("**/*.ts","**/*.tsx") }}

2. build:
   - runs-on: ubuntu-latest
   - needs: [lint-and-typecheck]
   - Node.js version: 20
   - Steps: checkout, setup-node with npm cache, npm ci, turbo build
   - Only runs on push to main (not on PRs - PRs only need lint+typecheck)

Environment variables available to workflows:
   - DATABASE_URL: ${{ secrets.DATABASE_URL }}  (needed for Prisma generate in build)
   - TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }} (optional remote cache)
   - TURBO_TEAM: ${{ secrets.TURBO_TEAM }} (optional remote cache)

Also create .github/pull_request_template.md with sections:
  ## What does this PR do?
  ## Prompt ID (if AI-assisted)
  ## Acceptance criteria checklist
  ## Claude review notes
```

### Acceptance Criteria

| Acceptance criterion | |
|----------------------|-|
| ci.yml is valid YAML and passes GitHub Actions syntax validation | [ ] |
| lint-and-typecheck job runs on both PRs and pushes to main | [ ] |
| build job only runs on push to main, and depends on lint-and-typecheck | [ ] |
| Turborepo cache is configured with a meaningful cache key | [ ] |
| DATABASE_URL is sourced from secrets, not hardcoded | [ ] |
| PR template includes a Prompt ID field for tracking AI-assisted changes | [ ] |

---

## Prompt P0-04 - Prisma Setup & Database Connection

| Field | Value |
|-------|-------|
| Prompt ID | P0-04 |
| Build Order | Build Order 2 |
| Depends On | P0-01 complete; Railway PostgreSQL instance provisioned |
| Objective | Configure Prisma in packages/db, connect to Railway PostgreSQL, and verify the connection works |

### Pre-Prompt Action Required

> **Manual step before running this prompt:** Provision a PostgreSQL instance on Railway (railway.app). Copy the DATABASE_URL connection string. Add it to .env.local at the monorepo root (never commit this file). This prompt assumes the database is running and reachable.

### Cursor Prompt

```
In packages/db/, configure Prisma for the FamLink database.

prisma/schema.prisma:
  generator client {
    provider = "prisma-client-js"
    output   = "../src/generated/client"
  }
  datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
  }

Add to packages/db/package.json scripts:
  "db:generate": "prisma generate"
  "db:migrate": "prisma migrate dev"
  "db:migrate:deploy": "prisma migrate deploy"
  "db:studio": "prisma studio"
  "db:seed": "ts-node --project tsconfig.json prisma/seed.ts"
  "db:reset": "prisma migrate reset --force"

packages/db/src/index.ts - PrismaClient singleton:
  - In production: create a single PrismaClient instance
  - In development: attach to global object to prevent hot-reload connection exhaustion
  - Export: { db } where db is the singleton PrismaClient
  - Also export the generated Prisma types: export * from "./generated/client"

packages/db/src/health.ts:
  - Export: async function checkDatabaseHealth(): Promise<boolean>
  - Implementation: await db.$queryRaw`SELECT 1`, return true on success, false on error
  - This will be used by the API health endpoint in a later prompt

Root .env.example: ensure DATABASE_URL is present (already done in P0-01, verify it is there)

Do NOT run prisma migrate yet - the schema tables will be added in P0-05 through P0-07.
DO run: prisma generate to verify the client generates without errors.
```

### Acceptance Criteria

| Acceptance criterion | |
|----------------------|-|
| prisma/schema.prisma is valid with datasource and generator blocks | [ ] |
| Generated output path is ../src/generated/client (not the default) | [ ] |
| packages/db/src/index.ts exports a singleton db instance | [ ] |
| PrismaClient singleton uses global object in development to prevent connection leaks | [ ] |
| packages/db/src/health.ts exports a checkDatabaseHealth() function | [ ] |
| prisma generate runs without errors | [ ] |
| All five db:* scripts are present in packages/db/package.json | [ ] |
| DATABASE_URL is never hardcoded - always sourced from environment variable | [ ] |

---

## Prompt P0-05 - Core Identity Schema

| Field | Value |
|-------|-------|
| Prompt ID | P0-05 |
| Build Order | Build Order 2 |
| Depends On | P0-04 complete; Prisma connection verified |
| Objective | Define the persons, family_groups, households, household_members, and family_members tables in Prisma schema |

### Cursor Prompt

```
Add the core identity tables to packages/db/prisma/schema.prisma.
Add them AFTER the existing generator and datasource blocks.
Use PostgreSQL-native types where appropriate (e.g., @db.Text for long strings).

model Person {
  id               String    @id @default(cuid())
  userId           String?   @unique  // Clerk user ID - null for guests and child profiles
  firstName        String
  lastName         String
  preferredName    String?
  dateOfBirth      DateTime? @db.Date
  isMinor          Boolean   @default(false)
  profilePhotoUrl  String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  // Relations
  familyMemberships    FamilyMember[]
  householdMemberships HouseholdMember[]
  relationshipsFrom    Relationship[] @relation("RelationshipFrom")
  relationshipsTo      Relationship[] @relation("RelationshipTo")
  createdFamilies      FamilyGroup[]  @relation("FamilyCreator")
  notificationPrefs    NotificationPreference[]
  @@index([userId])
}

model FamilyGroup {
  id              String    @id @default(cuid())
  name            String
  createdById     String
  createdBy       Person    @relation("FamilyCreator", fields: [createdById], references: [id])
  aiEnabled       Boolean   @default(true)
  defaultVisibility String  @default("FAMILY")  // VisibilityTier enum value
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  // Relations
  households      Household[]
  members         FamilyMember[]
  relationships   Relationship[]
  events          Event[]
}

model Household {
  id            String    @id @default(cuid())
  familyGroupId String
  familyGroup   FamilyGroup @relation(fields: [familyGroupId], references: [id], onDelete: Cascade)
  name          String
  street        String?
  city          String?
  state         String?
  zip           String?
  country       String?   @default("US")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  // Relations
  members       HouseholdMember[]
  @@index([familyGroupId])
}

model FamilyMember {
  id            String    @id @default(cuid())
  familyGroupId String
  familyGroup   FamilyGroup @relation(fields: [familyGroupId], references: [id], onDelete: Cascade)
  personId      String
  person        Person    @relation(fields: [personId], references: [id], onDelete: Cascade)
  roles         String[]  // Array of FamilyRole enum values stored as strings
  permissions   String[]  // e.g. ["VIEW_EVENTS", "CREATE_EVENTS"]
  joinedAt      DateTime  @default(now())
  @@unique([familyGroupId, personId])
  @@index([familyGroupId])
  @@index([personId])
}

model HouseholdMember {
  id           String    @id @default(cuid())
  householdId  String
  household    Household @relation(fields: [householdId], references: [id], onDelete: Cascade)
  personId     String
  person       Person    @relation(fields: [personId], references: [id], onDelete: Cascade)
  role         String?   // e.g. "HEAD_OF_HOUSEHOLD", "DEPENDENT"
  joinedAt     DateTime  @default(now())
  @@unique([householdId, personId])
  @@index([householdId])
}

model NotificationPreference {
  id          String    @id @default(cuid())
  personId    String
  person      Person    @relation(fields: [personId], references: [id], onDelete: Cascade)
  channel     String    // NotificationChannel enum value
  notifType   String    // NotificationType enum value
  enabled     Boolean   @default(true)
  @@unique([personId, channel, notifType])
  @@index([personId])
}

After adding all models, run: prisma migrate dev --name "core-identity-schema"
Verify the migration completes successfully and the tables exist in the database.
```

### Acceptance Criteria

| Acceptance criterion | |
|----------------------|-|
| All five models are present: Person, FamilyGroup, Household, FamilyMember, HouseholdMember | [ ] |
| NotificationPreference model is present with the correct composite unique constraint | [ ] |
| Person.userId is optional (String?) to support guest and child profiles without accounts | [ ] |
| FamilyMember.roles is String[] - stores multiple roles per person per family | [ ] |
| All @relation fields are correctly defined with onDelete: Cascade where appropriate | [ ] |
| All models have createdAt timestamps; mutable models have updatedAt @updatedAt | [ ] |
| @@unique constraints are on FamilyMember [familyGroupId, personId] and HouseholdMember [householdId, personId] | [ ] |
| @@index is present on all foreign key fields for query performance | [ ] |
| prisma migrate dev --name core-identity-schema completes without errors | [ ] |
| prisma generate regenerates the client without errors after migration | [ ] |

---

## Prompt P0-06 - Relationship Graph Schema

| Field | Value |
|-------|-------|
| Prompt ID | P0-06 |
| Build Order | Build Order 2 |
| Depends On | P0-05 complete; core identity tables migrated |
| Objective | Add the Relationship table implementing the family graph edges, with the full relationship type enum |

### Cursor Prompt

```
Add the Relationship model to packages/db/prisma/schema.prisma.
This table represents directed edges in the family relationship graph.

model Relationship {
  id            String    @id @default(cuid())
  fromPersonId  String
  fromPerson    Person    @relation("RelationshipFrom", fields: [fromPersonId], references: [id], onDelete: Cascade)
  toPersonId    String
  toPerson      Person    @relation("RelationshipTo", fields: [toPersonId], references: [id], onDelete: Cascade)
  type          String    // RelationshipType enum value
  familyGroupId String
  familyGroup   FamilyGroup @relation(fields: [familyGroupId], references: [id], onDelete: Cascade)
  notes         String?   @db.Text
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  @@unique([fromPersonId, toPersonId, familyGroupId])
  @@index([fromPersonId])
  @@index([toPersonId])
  @@index([familyGroupId])
}

IMPORTANT - Relationship directionality:
Relationships are stored as directed edges (A -> B).
Reciprocal relationships must be created separately (B -> A).
Example: PARENT(Sarah -> Emma) and CHILD(Emma -> Sarah) are TWO rows.
The API layer (built later) will handle creating both directions.
Do NOT add any application logic to enforce this in the schema itself.

Create packages/db/src/relationship-helpers.ts:
  Export a constant RECIPROCAL_TYPES: Record<string, string>
  Map each RelationshipType to its reciprocal:
    PARENT -> CHILD, CHILD -> PARENT
    SPOUSE -> SPOUSE, PARTNER -> PARTNER
    SIBLING -> SIBLING, HALF_SIBLING -> HALF_SIBLING
    GRANDPARENT -> GRANDCHILD, GRANDCHILD -> GRANDPARENT
    AUNT_UNCLE -> NIECE_NEPHEW, NIECE_NEPHEW -> AUNT_UNCLE
    COUSIN -> COUSIN
    STEP_PARENT -> STEP_CHILD, STEP_CHILD -> STEP_PARENT
    ADOPTIVE_PARENT -> ADOPTIVE_CHILD, ADOPTIVE_CHILD -> ADOPTIVE_PARENT
    CAREGIVER -> null (no automatic reciprocal)
    GUARDIAN -> null
    FAMILY_FRIEND -> FAMILY_FRIEND
    EX_SPOUSE -> EX_SPOUSE

Run: prisma migrate dev --name "relationship-graph-schema"
```

### Acceptance Criteria

| Acceptance criterion | |
|----------------------|-|
| Relationship model is present with all specified fields | [ ] |
| @@unique constraint is on [fromPersonId, toPersonId, familyGroupId] - prevents duplicate edges within a family | [ ] |
| Both @relation decorators reference the named relations defined in the Person model ("RelationshipFrom" and "RelationshipTo") | [ ] |
| relationship-helpers.ts exports RECIPROCAL_TYPES covering all 19 RelationshipType values | [ ] |
| CAREGIVER and GUARDIAN map to null reciprocal - intentional, documented with a comment | [ ] |
| prisma migrate dev --name relationship-graph-schema completes without errors | [ ] |

---

## Prompt P0-07 - Event and RSVP Schema

| Field | Value |
|-------|-------|
| Prompt ID | P0-07 |
| Build Order | Build Order 2 |
| Depends On | P0-05 complete; core identity tables migrated |
| Objective | Add the Event, EventInvitation, RSVP, and PotluckAssignment tables |

### Cursor Prompt

```
Add the event and RSVP models to packages/db/prisma/schema.prisma.

model Event {
  id               String    @id @default(cuid())
  familyGroupId    String
  familyGroup      FamilyGroup @relation(fields: [familyGroupId], references: [id], onDelete: Cascade)
  createdByPersonId String
  title            String
  description      String?   @db.Text
  startAt          DateTime
  endAt            DateTime?
  locationName     String?
  locationAddress  String?   @db.Text
  locationMapUrl   String?
  visibility       String    @default("FAMILY")  // VisibilityTier enum value
  isRecurring      Boolean   @default(false)
  recurrenceRule   String?   // RRULE string for future use
  isBirthdayEvent  Boolean   @default(false)  // Auto-generated birthday events
  birthdayPersonId String?   // Person whose birthday this celebrates
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  // Relations
  invitations      EventInvitation[]
  rsvps            RSVP[]
  potluckItems     PotluckAssignment[]
  @@index([familyGroupId])
  @@index([startAt])
}

model EventInvitation {
  id           String    @id @default(cuid())
  eventId      String
  event        Event     @relation(fields: [eventId], references: [id], onDelete: Cascade)
  personId     String?   // null = household or family-level invite
  householdId  String?   // set if this is a household-level invite
  scope        String    // InviteScope enum: INDIVIDUAL | HOUSEHOLD | FAMILY
  sentAt       DateTime?
  createdAt    DateTime  @default(now())
  @@index([eventId])
  @@index([personId])
}

model RSVP {
  id           String    @id @default(cuid())
  eventId      String
  event        Event     @relation(fields: [eventId], references: [id], onDelete: Cascade)
  personId     String
  status       String    // RSVPStatus enum: YES | NO | MAYBE | PENDING
  guestToken   String?   @unique // Set for Reluctant Member / guest RSVPs - no account required
  guestEmail   String?   // Email address for guest RSVPs
  guestPhone   String?   // Phone number for guest SMS RSVPs
  respondedAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  @@unique([eventId, personId])
  @@index([eventId])
  @@index([guestToken])
}

model PotluckAssignment {
  id          String    @id @default(cuid())
  eventId     String
  event       Event     @relation(fields: [eventId], references: [id], onDelete: Cascade)
  personId    String?   // null = unassigned slot
  item        String    // What they are bringing
  quantity    Int?
  notes       String?
  createdAt   DateTime  @default(now())
  @@index([eventId])
}

Run: prisma migrate dev --name "event-rsvp-schema"
```

### Acceptance Criteria

| Acceptance criterion | |
|----------------------|-|
| All four models present: Event, EventInvitation, RSVP, PotluckAssignment | [ ] |
| Event.isBirthdayEvent and Event.birthdayPersonId support auto-generated birthday events (PRD birthday calendar feature) | [ ] |
| RSVP.guestToken is unique - used for one-click RSVP links sent to Reluctant Members | [ ] |
| RSVP.guestEmail and RSVP.guestPhone are present - for RSVPs without accounts | [ ] |
| @@unique on RSVP [eventId, personId] - one RSVP per person per event | [ ] |
| EventInvitation supports individual, household, and family-level invites via scope field | [ ] |
| PotluckAssignment.personId is nullable - supports unassigned items | [ ] |
| @@index on Event.startAt - required for efficient calendar queries | [ ] |
| prisma migrate dev --name event-rsvp-schema completes without errors | [ ] |

---

## Prompt P0-08 - Seed Data

| Field | Value |
|-------|-------|
| Prompt ID | P0-08 |
| Build Order | Build Order 2 |
| Depends On | P0-05, P0-06, P0-07 all complete and migrated |
| Objective | Create a realistic seed script that populates the database with a test family for development and demo use |

### Cursor Prompt

```
Create packages/db/prisma/seed.ts

The seed creates "The Johnson Family" - a realistic three-generation family
suitable for demonstrating all FamLink features.

Family structure:
  FAMILY GROUP: "The Johnson Family"

  HOUSEHOLD 1: "Sarah & Tom's House" (Organizer household)
    - Sarah Johnson (Organizer) - dob: 1980-03-15, userId: "clerk_sarah_dev"
    - Tom Johnson (Sarah's spouse) - dob: 1978-11-02, userId: "clerk_tom_dev"
    - Emma Johnson (daughter) - dob: 2015-07-22, isMinor: true, userId: null
    - Jack Johnson (son) - dob: 2013-04-10, isMinor: true, userId: null

  HOUSEHOLD 2: "Grandma & Grandpa's House" (Grandparent household)
    - Margaret Johnson (Tom's mother) - dob: 1950-06-08, userId: "clerk_margaret_dev"
    - Robert Johnson (Tom's father) - dob: 1948-09-14, userId: "clerk_robert_dev"

  HOUSEHOLD 3: "Uncle Dave's Place" (Reluctant Member)
    - Dave Johnson (Tom's brother) - dob: 1975-12-30, userId: null (no account)

RELATIONSHIPS (create both directions):
  Sarah <-> Tom: SPOUSE
  Sarah -> Emma: PARENT | Emma -> Sarah: CHILD
  Sarah -> Jack: PARENT | Jack -> Sarah: CHILD
  Tom -> Emma: PARENT | Emma -> Tom: CHILD
  Tom -> Jack: PARENT | Jack -> Tom: CHILD
  Emma <-> Jack: SIBLING
  Margaret -> Tom: PARENT | Tom -> Margaret: CHILD
  Robert -> Tom: PARENT | Tom -> Robert: CHILD
  Margaret <-> Robert: SPOUSE
  Tom <-> Dave: SIBLING
  Margaret -> Dave: PARENT | Dave -> Margaret: CHILD
  Robert -> Dave: PARENT | Dave -> Robert: CHILD
  Margaret -> Emma: GRANDPARENT | Emma -> Margaret: GRANDCHILD
  Margaret -> Jack: GRANDPARENT | Jack -> Margaret: GRANDCHILD
  Robert -> Emma: GRANDPARENT | Emma -> Robert: GRANDCHILD
  Robert -> Jack: GRANDPARENT | Jack -> Robert: GRANDCHILD

SAMPLE EVENT:
  Title: "Thanksgiving 2026"
  startAt: 2026-11-26T17:00:00Z
  location: "Grandma & Grandpa's House"
  visibility: FAMILY
  createdByPersonId: Sarah's ID

RSVPS for Thanksgiving:
  Sarah: YES (respondedAt: now)
  Tom: YES (respondedAt: now)
  Margaret: YES (respondedAt: now)
  Robert: YES (respondedAt: now)
  Dave: PENDING (guestToken: "dev-guest-token-dave", guestPhone: "+15551234567")

POTLUCK ASSIGNMENTS:
  Sarah: "Pumpkin Pie", quantity: 2
  Tom: "Turkey", quantity: 1
  Margaret: "Mashed Potatoes", quantity: 1
  Dave: "Rolls", quantity: 2

NOTIFICATION PREFERENCES:
  Sarah: EMAIL+PUSH+SMS enabled for all notification types
  Margaret: EMAIL+PUSH enabled; SMS disabled
  Dave: no NotificationPreference rows - guest only receives SMS from event invites

Use upsert operations with cuid() IDs defined as constants at the top of the file.
This allows the seed to be re-run safely without duplicate data.
Export all seeded IDs as a DEV_SEED_IDS constant for use in tests.

Run with: npx prisma db seed
(ensure package.json prisma.seed points to this file with ts-node)
```

### Acceptance Criteria

| Acceptance criterion | |
|----------------------|-|
| 7 Person records created: Sarah, Tom, Emma, Jack, Margaret, Robert, Dave | [ ] |
| Emma and Jack have isMinor: true and userId: null | [ ] |
| Dave has userId: null - representing a Reluctant Member with no account | [ ] |
| All specified RSVP records created with correct statuses | [ ] |
| Dave's RSVP has guestToken: "dev-guest-token-dave" - for testing guest RSVP flow | [ ] |
| All potluck assignments created and linked to the Thanksgiving event | [ ] |
| All specified relationships created as directed pairs (both directions) | [ ] |
| Margaret and Robert have GRANDPARENT relationships to both Emma and Jack | [ ] |
| Seed uses upsert - running npx prisma db seed twice produces no duplicate records | [ ] |
| DEV_SEED_IDS is exported from the seed file with all seeded IDs | [ ] |
| npx prisma db seed completes without errors | [ ] |

**Claude Review Prompt (End of Phase 0):** After P0-08, run a full Phase 0 review: "Review the complete FamLink Phase 0 output - Prisma schema, seed data, and monorepo structure - against the ADR. Check: (1) all ADR-04 tables present, (2) Reluctant Member constraints satisfied (nullable userId, guestToken, guest fields), (3) COPPA constraints satisfied (isMinor flag, nullable userId for children), (4) no technical debt introduced, (5) ready for Phase 1 auth build."

---

# 5. Phase 0 Completion Checklist

Phase 0 is complete when all of the following are true:

| Acceptance criterion | |
|----------------------|-|
| P0-01: Turborepo monorepo scaffold committed to main | [ ] |
| P0-02: @famlink/shared types package with all enums and interfaces | [ ] |
| P0-03: GitHub Actions CI passing on main branch | [ ] |
| P0-04: Prisma connected to Railway PostgreSQL, health check working | [ ] |
| P0-05: Core identity tables migrated: persons, family_groups, households, family_members, household_members, notification_preferences | [ ] |
| P0-06: Relationship graph table migrated with RECIPROCAL_TYPES helper | [ ] |
| P0-07: Event, EventInvitation, RSVP, PotluckAssignment tables migrated | [ ] |
| P0-08: Seed data loaded; dev-guest-token-dave present for Reluctant Member testing | [ ] |
| Claude review completed for each prompt before moving to the next | [ ] |
| All prompts committed with Prompt ID in the commit message | [ ] |
| Zero TypeScript errors across all packages (turbo type-check passing) | [ ] |
| ADR updated to mark monorepo tooling decision as LOCKED (Turborepo) | [ ] |

## Phase 0 → Phase 1 Handoff

When Phase 0 is complete, Phase 1 begins at Build Order 3: Authentication (Clerk). The Phase 1 Cursor Prompt Library will cover:

- P1-01 through P1-04: Clerk authentication integration with Next.js and Expo
- P1-05 through P1-08: Guest token system for Reluctant Member participation (ADR-05)
- P1-09 through P1-12: Family Graph API - CRUD endpoints for persons, relationships, households, and family groups

> **Reminder:** Before starting Phase 1, add this document and the ADR to the FamLink Claude Project so both are persistently available. Phase 1 prompts will reference ADR decisions and Phase 0 schema directly.

---

*FamLink Cursor Prompt Library v0.1 - Phase 0 - March 2026 - CONFIDENTIAL*
