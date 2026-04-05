# FamLink
## The Family Operating System

### Architecture Decision Record

Version 0.2 — Working Draft
March 2026 | CONFIDENTIAL

---

# Version History

| Version | Date | Author | Changes |
| --- | --- | --- | --- |
| 0.1 | March 2026 | Founder + Claude | Initial draft. 11 ADRs, 6 open questions. |
| 0.2 | March 2026 | Founder + Claude | Resolves OQ#1 (monorepo). Adds Prisma version pin. Records Next.js security patch. Phase 0 build complete. |

---

# Changes in v0.2

**Summary**

Three changes from v0.1: (1) ADR Open Question #1 resolved and locked as ADR-00. (2) ADR-04 amended to pin Prisma at 5.16.0 with upgrade deferred to Phase 2. (3) ADR-01 amended to record Next.js security patch from 14.1.0 to 14.2.35. All other v0.1 decisions are unchanged and carried forward.

| ADR | Decision | Change type | Summary |
| --- | --- | --- | --- |
| ADR-00 (new) | Monorepo Tooling | OPEN → LOCKED | Turborepo with npm workspaces confirmed by founder. |
| ADR-04 (amended) | ORM Version Pin | Amendment | Prisma pinned at 5.16.0. Prisma 7 upgrade deferred to Phase 2. |
| ADR-01 (amended) | Next.js Security Patch | Amendment | Next.js patched from 14.1.0 to 14.2.35 (CVE-2025-55184). |

---

# ADR-00  Monorepo Tooling

| Field | Value | Notes |
| --- | --- | --- |
| Status | LOCKED | Resolved from v0.1 Open Question #1 |
| Decision | Turborepo + npm workspaces | |
| Confirmed by | Steve McLeod | March 2026 |
| Was | OPEN | ADR v0.1 Open Question #1, marked HIGH priority |

## Decision

Turborepo with npm workspaces is the monorepo tooling for FamLink. This was ADR Open Question #1 in v0.1, marked as HIGH priority and blocking the first Cursor prompt.

## Rationale

- **Vercel-native.** Turborepo is built and maintained by Vercel, the same company behind Next.js. Integration is seamless and documentation assumes the same stack.
- **Build caching.** Turborepo understands the dependency graph between packages and skips rebuilding anything that has not changed. Critical as the monorepo grows across web, mobile, and shared packages.
- **AI tool support.** Turborepo has stronger representation in Cursor training data than Nx. Fewer deviations in AI-generated configuration files.
- **Additive architecture.** Turborepo sits on top of npm workspaces rather than replacing them. No conflict with the package manager layer.

## Options Rejected

| Option | Reason Rejected |
| --- | --- |
| Nx | Over-engineered for a two-app monorepo at MVP scale. Steep configuration complexity increases AI-generated code inconsistency risk. |
| npm workspaces only | No build orchestration or caching. Works but creates manual overhead as the codebase grows. Turborepo is additive on top of npm workspaces — no conflict. |

---

# ADR-04 Amendment — Prisma Version Pin

| Field | Value | Notes |
| --- | --- | --- |
| Original status | LOCKED — REVISIT PHASE 2 | From ADR v0.1 |
| Amended status | LOCKED — REVISIT PHASE 2 | Version pin added |
| Original decision | PostgreSQL + Prisma ORM | No version specified |
| Amendment | Prisma pinned at 5.16.0 | Exact pin, no range operator |
| Upgrade deferred | Prisma 7.x | Phase 2 decision |
| Date | March 2026 | Discovered during Phase 0 build |

## Context

ADR v0.1 specified Prisma as the ORM without pinning a version. During Phase 0 build, Prisma 7.0 shipped with a breaking configuration change: the datasource block in `schema.prisma` is replaced by a new `prisma.config.ts`-based model. When running `npx prisma generate`, the CLI pulled Prisma 7 and immediately failed on the existing schema syntax.

## Decision

Prisma is pinned at exactly 5.16.0 in `packages/db/package.json`. No range operator (`^`) is used. Prisma 7 adoption is deferred to Phase 2.

## Rationale for Deferral

- Phase 0 schema is working and tested on Prisma 5.16.0. Migrating to Prisma 7 configuration syntax mid-Phase 0 is unnecessary churn.
- Prisma 7 is a major version with breaking changes. Deferring ensures a clean, deliberate upgrade with full testing.
- The upgrade path is well-defined and low-risk when done intentionally in Phase 2.
- Pinning the exact version prevents accidental upgrades via `npm install` or CI runs.

## Phase 2 Upgrade Plan

When upgrading to Prisma 7: (1) migrate `schema.prisma` datasource block to `prisma.config.ts` format, (2) update PrismaClient instantiation in `packages/db/src/index.ts` per new initialization model, (3) run all migrations in a staging environment before touching production. Estimated effort: 2–4 hours.

---

# ADR-01 Amendment — Next.js Security Patch

| Field | Value | Notes |
| --- | --- | --- |
| Original status | LOCKED | From ADR v0.1 |
| Amended status | LOCKED | Version updated |
| Original version | Next.js 14.1.0 | |
| Patched version | Next.js 14.2.35 | Non-breaking patch |
| CVE | CVE-2025-55184 | React Server Components DoS vulnerability |
| Date | March 2026 | Applied end of Phase 0 |

## Context

Next.js 14.1.0 (the version specified in ADR v0.1) contains CVE-2025-55184, a high-severity denial-of-service vulnerability in React Server Components disclosed in December 2025. The official Next.js security advisory specifies `next@14.2.35` as the correct patched version for the 14.x release line.

## Decision

Next.js upgraded from 14.1.0 to 14.2.35 in `apps/web/package.json`. This is a non-breaking patch-level upgrade within the 14.x line. No application code changes were required.

## Residual npm audit Warnings

`npm audit` continues to report Next.js vulnerabilities after patching to 14.2.35. This is because the npm vulnerability database flags the entire 14.x range rather than recognizing the specific patch. The official Next.js advisory confirms 14.2.35 resolves the relevant CVEs for the 14.x line. Additional high-severity warnings relate to Expo CLI tooling dependencies (`tar`, `cacache`) and are dev-time only — not exploitable in the running application. These will be resolved during the Expo version upgrade in Phase 2.

---

# Open Questions Status

Status as of end of Phase 0. Question #1 resolved. Questions #2–6 remain open.

| # | Question | Blocks | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | Monorepo tooling | Build Order 1 | ✅ RESOLVED | Turborepo. See ADR-00. |
| 2 | Family subscription member cap | Phase 3 payments | OPEN | Needed before Stripe integration. |
| 3 | AI rate limits per user | AI assistant build | OPEN | Must define before Phase 1 AI build begins. |
| 4 | COPPA parental consent flow | Invitation system | OPEN | Legal input required. Blocks minor profile invitations. |
| 5 | US states / GDPR scope at launch | Public launch | OPEN | Needed before launch. Affects data residency and privacy policy. |
| 6 | Content moderation strategy | Public launch | OPEN | Needed before launch. Trust and safety liability question. |

---

# Phase 0 Build Summary

**Phase 0 complete.** All 8 prompts (P0-01 through P0-08) executed and reviewed. The monorepo scaffold, shared types, CI pipeline, database schema, and seed data are committed. Build Order 2 is complete. Phase 1 (Authentication + Family Graph API) is next.

| Prompt | Status | Deliverable |
| --- | --- | --- |
| P0-01 | ✅ Done | Turborepo monorepo scaffold, shared configs, .gitignore, .env.example, .gitattributes |
| P0-02 | ✅ Done | @famlink/shared types package — all enums, interfaces, and barrel export |
| P0-03 | ✅ Done | GitHub Actions CI pipeline + PR template |
| P0-04 | ✅ Done | Prisma setup, PrismaClient singleton, health check, Railway PostgreSQL connected |
| P0-05 | ✅ Done | Core identity schema migrated: Person, FamilyGroup, Household, FamilyMember, HouseholdMember, NotificationPreference |
| P0-06 | ✅ Done | Relationship graph schema migrated: Relationship table + RECIPROCAL_TYPES helper |
| P0-07 | ✅ Done | Event and RSVP schema migrated: Event, EventInvitation, RSVP, PotluckAssignment |
| P0-08 | ✅ Done | Seed data loaded: Johnson family, 7 members, 32 relationships, Thanksgiving event, RSVPs, potluck, notification prefs |

---

*FamLink ADR v0.2 — March 2026 — CONFIDENTIAL*
