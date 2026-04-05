# FamLink

*The Family Operating System*

**Architecture Decision Record**

Version 0.3 — Working Draft

March 2026 | CONFIDENTIAL

| Field | Value |
| --- | --- |
| Companion Document | FamLink PRD v0.1 |
| Document Version | v0.3 — Working Draft |
| Prior Version | v0.2 (Turborepo locked; AI rate limit locked; Prisma pinned; Next.js patched) |
| Status | Decisions locked unless marked OPEN or DEFERRED |
| AI Architecture | First-class concern — reviewed alongside conventional stack |
| Build Strategy | AI-assisted development (Cursor / Claude Code), small team |
| Primary Author | Founder + Claude (planning assistant) |

# Version History

| Version | Date | Summary of Changes |
| --- | --- | --- |
| v0.1 | March 2026 | Initial ADR — all baseline decisions locked. Open questions identified. |
| v0.2 | March 2026 | ADR-00 added (Turborepo + npm workspaces locked from Open Q#1). Open Q#3 resolved: AI rate limit 20 queries/user/day; max iteration limits on all agentic tool calls; no recursive tool calls. Prisma pinned at 5.16.0; Prisma 7 upgrade deferred to Phase 2. Next.js patched from 14.1.0 to 14.2.35 (security). |
| v0.3 | March 2026 | ADR-07 updated: Resend replaces SendGrid as email provider (Gmail sender verification restrictions). Open Q#4 partially resolved: is_minor boolean replaced with age_gate_level enum (NONE / YOUNG_ADULT / MINOR) + nullable guardian_person_id; MVP adults-only for accounts and communications; minors are passive graph nodes only. Stack summary and open questions updated. |

# 1. Purpose & Scope

This Architecture Decision Record (ADR) documents the significant technical choices made for FamLink's MVP build. Each decision captures the options considered, the choice made, and the reasoning behind it. These decisions collectively define the technical foundation that all development — including AI-assisted Cursor prompts — will be built upon.

This document should be read alongside the PRD. Where the PRD defines **what** to build and for whom, the ADR defines **how** to build it. Together they are the two source-of-truth documents that govern every development decision.

## Status Badge Reference

| Status Badge | Meaning |
| --- | --- |
| LOCKED | Decision is final for MVP. Do not revisit without a documented reason. |
| LOCKED — REVISIT PHASE 2 | Final for MVP, but explicitly planned for re-evaluation at Phase 2. |
| RESOLVED | Was OPEN in a prior version. Decision made and locked. Retained for traceability. |
| OPEN | Decision not yet made. Blocks development until resolved. |
| DEFERRED | Not needed for MVP. Will be decided before the relevant phase begins. |

# 2. Architecture Overview

FamLink is a three-tier web and mobile application with an AI layer that is architecturally first-class — not bolted on.

| Layer | Components | Role |
| --- | --- | --- |
| Client | React web app + React Native mobile app (Expo) | User interface across all personas and devices |
| API | Node.js / Express REST API + WebSocket server | Business logic, auth, data access, AI orchestration |
| AI Layer | LLM abstraction (Vercel AI SDK) + Tool registry + Context assembler | Family assistant, suggestions, agentic actions |
| Data | PostgreSQL (primary) + Redis (cache/sessions) | All persistent data; family graph modeled relationally |
| Services | Clerk (auth) + Resend (email) + Twilio (SMS) + FCM (push) | External integrations for identity and notifications |
| Infrastructure | Vercel (frontend) + Railway (backend) + Cloudflare R2 (media, Phase 2) | Hosting, CDN, storage |

Principle: Every component chosen is mainstream, well-documented, and well-supported by AI coding tools. Exotic or niche choices are explicitly avoided at MVP stage.

# 3. Architecture Decisions

## ADR-00 Monorepo Tooling [NEW — v0.2]

**Status: LOCKED**

Decision: Turborepo with npm workspaces. Monorepo structure spans: apps/web (Next.js), apps/mobile (Expo), apps/api (Node/Express), packages/shared (types + utils), packages/ui (component library).

Rationale: Turborepo is the leading monorepo build system in the React/Node.js ecosystem with native Next.js, Expo, and Node.js support. npm workspaces chosen over Yarn or pnpm for simplicity and universal compatibility. Turborepo task-pipeline caching reduces CI build times as the codebase grows. This combination is the most AI-tool-friendly monorepo setup — Cursor, Claude Code, and Copilot all have strong reference corpora for this pattern. Previously Open Q#1; resolved before first Cursor prompt execution (P0-01).

### Workspace Structure

| Package | Path | Purpose |
| --- | --- | --- |
| web | apps/web | Next.js 14 frontend application |
| mobile | apps/mobile | React Native + Expo application |
| api | apps/api | Node.js + Express REST API |
| shared | packages/shared | Shared TypeScript types, utilities, constants |
| ui | packages/ui | Shared React component library (shadcn/ui base) |
| db | packages/db | Prisma client singleton — exports { db }; used by apps/api |

## ADR-01 Frontend Framework

**Status: LOCKED**

Decision: React (TypeScript) — web application built with Next.js 14 App Router. Pinned to v14.2.35 (security patch applied during Phase 0; upgraded from 14.1.0 to address a known CVE).

Rationale: React is the dominant frontend framework with the largest ecosystem, best AI coding tool support, and most available talent. Next.js adds SSR, API routes, and file-based routing out of the box. TypeScript strict mode is mandatory — it prevents an entire class of runtime errors especially costly in AI-assisted build workflows. v14.2.35 is the locked version for all MVP development.

### Key Conventions

- TypeScript strict mode enabled across the entire codebase
- Tailwind CSS for styling — utility-first, no custom CSS framework
- shadcn/ui for component library — accessible, unstyled, fully owned in codebase
- TanStack Query (React Query v5) for server state management
- Zustand for client-side state — lightweight, simple, AI-tool friendly

## ADR-02 Mobile Strategy

**Status: LOCKED**

Decision: React Native with Expo — shared codebase targeting iOS and Android. Expo managed workflow for MVP.

Rationale: FamLink must be mobile-first. The Organizer, Grandparent, and Co-Parent personas all primarily live on their phones. Expo provides the fastest path to a production-quality React Native app without requiring native build tooling knowledge — critical for an AI-assisted small team. Expo managed workflow and EAS handle App Store and Play Store deployment without a native developer on the team. Shared types, business logic, API clients, and design tokens across web and mobile via packages/shared reduce total codebase size.

## ADR-03 Backend Framework

**Status: LOCKED**

Decision: Node.js with Express (TypeScript) — REST API with WebSocket support via Socket.io.

Rationale: Node.js/Express is the highest-supported backend stack in AI coding tools and has the largest available reference codebase for Cursor to draw on. TypeScript throughout maintains type safety end-to-end. Express is intentionally minimal — it adds structure without imposing opinion, keeping AI-generated code legible and consistent. Socket.io is added for real-time features (AI streaming, live RSVP updates). GraphQL explicitly deferred — REST is simpler to build, debug, and prompt-engineer at MVP stage.

### API Structure

- RESTful resource-based routing: /api/v1/families, /api/v1/events, /api/v1/members, etc.
- Versioned from day one (/api/v1/) to allow non-breaking changes
- JWT-based authentication via Clerk — no custom auth logic
- Zod for request/response validation — schema-first, TypeScript-native
- Prisma ORM for all database access — type-safe, excellent AI tool support

## ADR-04 Database Architecture

**Status: LOCKED — REVISIT PHASE 2**

Decision: PostgreSQL (primary database) + Redis (cache and session store). Prisma ORM pinned at exactly v5.16.0 for all database access. Prisma 7 upgrade deferred to Phase 2.

Rationale: PostgreSQL is the mainstream, production-grade relational database with the strongest ecosystem, best AI tool support, and lowest operational complexity for a small team. The family relationship graph is modeled relationally using a nodes-and-edges table pattern — sufficient for MVP-scale traversal (typically 2-3 hops for any family query). Prisma is pinned at 5.16.0; a breaking change was identified in Prisma 7 during Phase 0 build execution and the upgrade is explicitly deferred to Phase 2. A native graph database (Neo4j or AWS Neptune) will be evaluated at Phase 2 when real query patterns from production data are available.

### Prisma Version Lock

Pinned version: 5.16.0 | Prisma 7 upgrade: DEFERRED to Phase 2

All Cursor prompts and development work must reference Prisma 5.16.0 explicitly. Do not upgrade without a documented Phase 2 ADR amendment.

### Core Schema Tables

| Table | Purpose | Key Columns |
| --- | --- | --- |
| persons | Individual user/member records | id, user_id (nullable), name, dob, age_gate_level (enum), guardian_person_id (nullable) |
| relationships | Edges in the family graph | id, from_person_id, to_person_id, type, family_id, created_at |
| family_groups | Extended family containers | id, name, created_by, settings, created_at |
| households | Physical living unit | id, family_id, name, address, created_at |
| household_members | Person to Household edges | id, household_id, person_id, role, joined_at |
| family_members | Person to Family edges | id, family_id, person_id, roles[], permissions, joined_at |

## ADR-05 Authentication & Identity

**Status: LOCKED**

Decision: Clerk — managed authentication with social OAuth (Google, Apple) and email/password. Guest token system for Reluctant Member participation without account creation.

Rationale: Authentication is security-critical and should not be built from scratch. Clerk provides production-grade auth, social OAuth, user management, session handling, MFA, and compliance features out of the box. It integrates natively with Next.js and Expo. Google and Apple OAuth are required at launch — they are the primary onboarding paths for the Organizer persona.

### Guest Participation Architecture

- Invitations generate a time-limited signed JWT token (24-48 hour expiry for event RSVPs; 7 days for family join invitations)
- Token encodes: invited person ID, event/family ID, permission scope (RSVP-only / view-only / join-pending)
- Guest endpoints (/api/v1/guest/*) validate token signature without requiring a Clerk session
- Guest actions recorded against the person record, not a user account
- Soft upgrade prompt shown after successful guest action — never mandatory, never blocking

### Minor Profile Handling [UPDATED v0.3 — Open Q#4 Partial Resolution]

Change from v0.1: is_minor boolean field replaced with age_gate_level enum for greater flexibility in handling young adults and minors as the product matures.

| Field | Type | Values / Notes |
| --- | --- | --- |
| age_gate_level | ENUM | NONE (default) \| YOUNG_ADULT \| MINOR — stored on the persons table |
| guardian_person_id | UUID (nullable) | Foreign key to persons.id — links a minor record to their guardian |

- MVP scope: adults-only for account creation and all direct communications
- Minors are passive graph nodes only — they have a person record but no user account
- No behavioral tracking, no AI personalization, no direct communication to minor person records at MVP
- Full COPPA compliance flow (parental consent for minors with accounts) is deferred — requires legal input (Open Q#4 remains partially open)

## ADR-06 AI Architecture

**Status: LOCKED**

Decision: Vercel AI SDK for LLM abstraction + model-agnostic provider routing + three-layer capability model (Knowledge > Proactive > Agentic). AI rate limit: 20 queries per user per day (beta). Max iteration limits enforced on all agentic tool calls. No recursive tool calls permitted.

Rationale: AI is a first-class architectural concern in FamLink — not a feature addon. The architecture is model-agnostic (no vendor lock-in), maintains strong privacy controls (family data never leaves the API layer uncontrolled), and enables progressive capability delivery across phases. Rate limits and iteration caps are non-negotiable guardrails to prevent runaway API costs during beta and to eliminate the risk of agent loops. These limits were resolved as Open Q#3 and are now locked.

### AI Capability Model

| Layer | Phase | Capabilities | Example Interactions |
| --- | --- | --- | --- |
| Layer 1 — Knowledge | MVP | Answers questions about family data; natural language event creation | 'When is Dad's birthday?' / 'Who has not RSVP'd?' / 'Create a family dinner Saturday at 6pm at Mom's' |
| Layer 2 — Proactive | Phase 2 | Notices patterns; surfaces suggestions; monitors for coordination gaps | 'Emma's recital is Friday — want to invite the grandparents?' / '3 people have not responded to Thanksgiving' |
| Layer 3 — Agentic | Phase 3 | Takes actions with explicit confirmation; commerce integrations | 'Send reminders to non-responders' / 'Find a venue for 20 near Grandma's and book it' |

### Rate Limiting & Guardrails [LOCKED — Open Q#3 Resolved in v0.2]

| Guardrail | Value | Notes |
| --- | --- | --- |
| AI queries per user per day (beta) | 20 | Hard limit; resets at UTC midnight; surfaced in UI when approaching limit |
| Max tool call iterations per request | Defined per tool | Cap applied to all agentic tool call chains; prevents infinite loops |
| Recursive tool calls | PROHIBITED | No tool may invoke another tool recursively under any circumstance |
| Propose-confirm pattern | REQUIRED | AI never sends communications, spends money, or modifies family data without explicit user confirmation step |

### LLM Provider Strategy

| Provider | Use Case | Rationale |
| --- | --- | --- |
| Anthropic Claude Sonnet | Primary assistant model at MVP | Strongest instruction-following and structured output; best for family context tasks |
| OpenAI GPT-4o | Fallback / A-B testing | Fastest, widest tool-calling support; good for latency-sensitive interactions |
| GPT-4o-mini / Claude Haiku | High-frequency low-stakes tasks | Proactive suggestions, notification drafting — cost efficiency at scale |
| Google Gemini | Future multimodal features | Photo analysis, voice interaction — Phase 3+ consideration |

## ADR-07 Notifications Infrastructure [UPDATED v0.3]

**Status: LOCKED**

v0.3 Change: SendGrid replaced by Resend as the email provider.

Decision: Three-channel notification stack: Resend (email) + Twilio (SMS) + Firebase Cloud Messaging (push). All three required at MVP.

Rationale: The Reluctant Member and Grandparent personas make notifications architecturally critical. Email and SMS are the primary participation channels for family members who will never install the app. Resend replaced SendGrid due to Gmail sender verification restrictions that blocked reliable delivery in development and would create launch risk in production. Resend provides equivalent transactional email capability with simpler domain verification and a developer-friendly API. All three channels must be production-ready at MVP launch.

| Channel | Provider | Use Cases | Persona Priority |
| --- | --- | --- | --- |
| Email | Resend | Event invitations, RSVP links, weekly digests, birthday reminders, account management | Reluctant Member (primary), Grandparent (primary), all users |
| SMS | Twilio | Event invitations with RSVP link, day-of reminders, urgent family notifications | Reluctant Member (primary), Grandparent (secondary) |
| Push | Firebase (FCM) | Real-time alerts, RSVP received, new event, AI assistant suggestions | Organizer (primary), Co-Parent (primary), engaged members |

## ADR-08 Hosting & Infrastructure

**Status: LOCKED — REVISIT PHASE 2**

Decision: Vercel (Next.js frontend) + Railway (Node.js API + PostgreSQL + Redis) for MVP. Migrate to AWS/GCP at scale.

Rationale: The hosting strategy prioritizes speed of deployment, minimal DevOps overhead, and cost efficiency at MVP scale. Vercel is the native deployment platform for Next.js and handles edge CDN, preview deployments, and zero-config SSL automatically. Railway provides managed PostgreSQL and Redis alongside the Node.js API in a single platform with simple environment management. Both platforms are well-documented and support rapid iteration. Infrastructure-as-code and migration to AWS or GCP is a Phase 2 decision triggered when team size or cost efficiency demands it.

### Environment Strategy

| Environment | Purpose | Deployment Trigger |
| --- | --- | --- |
| Development | Local developer machines | Manual / local only |
| Preview | Per-PR preview deployments (Vercel) | Every pull request — automatic |
| Staging | Pre-production validation | Merge to main branch — automatic |
| Production | Live product | Manual promotion from staging |

## ADR-09 Real-Time & Chat

**Status: LOCKED — REVISIT PHASE 2**

Decision: Socket.io for MVP real-time needs (AI streaming, live RSVP updates). Stream.io for full family chat in Phase 2.

Rationale: MVP requires real-time capability for two specific needs: streaming AI assistant responses word-by-word, and live RSVP count updates on the event dashboard. Socket.io handles both without introducing a separate managed service. Full family group chat — a Phase 2 feature — will use Stream.io, a managed real-time messaging platform that handles the complexity of group chat without building from scratch. Do not build a chat system from scratch under any circumstances.

## ADR-10 Media & File Storage

**Status: DEFERRED — Phase 2**

Decision: Cloudflare R2 for photo and media storage when photo sharing is built in Phase 2.

Rationale: Photo and media sharing is explicitly out of MVP scope. Cloudflare R2 is preferred for Phase 2: S3-compatible API, zero egress fees critical for photo-heavy usage patterns, strong CDN integration, and competitive pricing. No media infrastructure needs to be built or provisioned for MVP.

## ADR-11 Commerce & Payments

**Status: DEFERRED — Phase 3**

Decision: Stripe for subscriptions and payment processing. Affiliate commerce via partner APIs (Amazon, travel, venues) in Phase 3.

Rationale: Two distinct payment concerns exist: (1) user subscriptions for the paid tier, and (2) affiliate/transactional commerce for gifts, reservations, and event services. Stripe handles subscriptions from day one of monetization (post-beta). The AI agentic layer (ADR-06) is designed with commerce tool hooks built in, so the commerce capability plugs in without an architecture change when Phase 3 begins.

# 4. Confirmed Technology Stack — Summary

| Category | Technology | Version / Notes | Status |
| --- | --- | --- | --- |
| Frontend Framework | Next.js (React) | v14.2.35 — App Router (security-patched from 14.1.0) | LOCKED |
| Frontend Language | TypeScript | Strict mode | LOCKED |
| Styling | Tailwind CSS + shadcn/ui | Utility-first; unstyled components | LOCKED |
| State — Server | TanStack Query (React Query) | v5 | LOCKED |
| State — Client | Zustand | Lightweight store | LOCKED |
| Mobile | React Native + Expo | Managed workflow; Expo Router | LOCKED |
| Backend Framework | Node.js + Express | TypeScript; REST API | LOCKED |
| Validation | Zod | Schema-first; TypeScript-native | LOCKED |
| ORM | Prisma | v5.16.0 — PINNED; v7 upgrade deferred to Phase 2 | LOCKED |
| Primary Database | PostgreSQL | Via Railway managed service | LOCKED |
| Cache / Sessions | Redis | Via Railway managed service | LOCKED |
| Monorepo Tooling | Turborepo + npm workspaces | ADR-00; resolved from Open Q#1 in v0.2 | LOCKED |
| Authentication | Clerk | Social OAuth + email/password + guest tokens | LOCKED |
| AI Abstraction | Vercel AI SDK | Model-agnostic; streaming support | LOCKED |
| AI — Primary Model | Anthropic Claude Sonnet | Via Vercel AI SDK | LOCKED |
| AI — Fallback Model | OpenAI GPT-4o | Via Vercel AI SDK | LOCKED |
| AI Monitoring | Helicone or LangSmith | Cost + quality tracking | LOCKED |
| AI Rate Limit | 20 queries/user/day (beta) | Resolved Open Q#3 in v0.2; max iteration limits; no recursive tool calls | LOCKED |
| Email | Resend | Replaces SendGrid (v0.3 change); transactional + invitations | LOCKED |
| SMS | Twilio | Invitations + reminders | LOCKED |
| Push Notifications | Firebase Cloud Messaging | iOS + Android | LOCKED |
| Real-Time (MVP) | Socket.io | AI streaming + live updates | LOCKED |
| Real-Time (Phase 2) | Stream.io | Full family group chat | DEFERRED |
| Frontend Hosting | Vercel | Native Next.js platform | LOCKED |
| Backend Hosting | Railway | API + DB + Redis managed | LOCKED |
| Media Storage | Cloudflare R2 | Phase 2 — photo sharing | DEFERRED |
| Payments | Stripe | Phase 3 — subscriptions + commerce | DEFERRED |
| Graph DB | Neo4j / AWS Neptune | Phase 2 evaluation if Postgres graph queries bottleneck | DEFERRED |

# 5. Build Dependency Map

The following sequence governs what must be built before what. Cursor prompts must follow this order. Phase 0 is complete. Phase 1 is in progress.

| Build Order | Module | Depends On | Key Deliverable | Phase |
| --- | --- | --- | --- | --- |
| 1 | Project scaffold + TypeScript config | — | Next.js + Expo monorepo, shared types, CI pipeline | Phase 0 DONE |
| 2 | Database schema + Prisma setup | — | Prisma schema, migrations, seed data, Postgres connection | Phase 0 DONE |
| 3 | Authentication (Clerk) | 1 | Login, OAuth, session management, guest token system | Phase 1 — NEXT |
| 4 | Family Graph API | 2, 3 | Persons, relationships, households, family groups — CRUD | Phase 1 |
| 5 | Invitation System | 3, 4, 6 | Email + SMS invite delivery, guest token generation, RSVP capture | Phase 1 |
| 6 | Event Hub API | 2, 3, 4 | Event CRUD, invitation, RSVP, potluck assignments | Phase 1 |
| 7 | Shared Calendar API | 2, 3, 4, 6 | Calendar views, birthday auto-population, event aggregation | Phase 1 |
| 8 | Notification Service | 3, 5, 6 | Resend + Twilio + FCM integration, preference management | Phase 1 |
| 9 | AI Context Assembler | 2, 4, 6, 7 | Family context builder, token budget management | Phase 2 |
| 10 | AI Assistant API | 3, 9 | Chat endpoint, streaming, tool registry (Layer 1 tools) | Phase 2 |
| 11 | Frontend — Auth + Onboarding | 3 | Sign up, login, create family, invite first members | Phase 1 |
| 12 | Frontend — Family Graph UI | 4, 11 | Member directory, relationship view, profile pages | Phase 2 |
| 13 | Frontend — Event Hub UI | 6, 8, 11 | Event creation, invitation, RSVP management, organizer dashboard | Phase 2 |
| 14 | Frontend — Calendar UI | 7, 13 | Unified calendar, birthday view, event detail | Phase 2 |
| 15 | Frontend — AI Assistant UI | 10, 13 | Chat interface, tool result cards, streaming display | Phase 2 |
| 16 | Mobile app (Expo) | All API complete | React Native screens mirroring web functionality | Phase 2 |

# 6. Open Architectural Questions

Questions resolved in prior versions are shown with RESOLVED status for traceability.

| # | Question | Status | Blocks | Notes |
| --- | --- | --- | --- | --- |
| 1 | COPPA compliance: parental consent flow design for minor profiles? | OPEN — PRE-LAUNCH BLOCKER | Invitation system for minor profiles (Build Order 5); any minor account functionality | Highest priority open question. Requires legal counsel input before any minor account functionality is built. Partially resolved in v0.3: age_gate_level enum and guardian_person_id added; MVP adults-only; minors are passive graph nodes. Full parental consent flow is undesigned and legally unreviewed. Do not build minor account features until this is closed. |
| 2 | Monorepo tooling: Turborepo vs. Nx vs. npm workspaces? | RESOLVED | — | Turborepo + npm workspaces. Locked ADR-00. Resolved v0.2. |
| 3 | AI rate limits per user per day — cost-sustainable thresholds? | RESOLVED | — | 20 queries/user/day (beta). Max iteration limits on all agentic tool calls. No recursive tool calls. Locked ADR-06. Resolved v0.2. |
| 4 | What is the exact member cap for the family subscription tier? | OPEN | Monetization / Stripe integration (Phase 3) | Medium priority — needed before payment build begins. |
| 5 | What US states / regions are in scope at launch? (GDPR scope?) | OPEN | Data residency, privacy policy, legal | Medium priority — needed before public launch. |
| 6 | Moderation strategy for harmful or abusive family content? | OPEN | Platform policies, trust & safety features | Medium priority — needed before public launch. |

# 7. Next Steps

| Priority | Action | Output |
| --- | --- | --- |
| 1 | Execute Phase 1 Cursor Prompt Library — beginning with P1-01 (Clerk integration in Next.js). ADR v0.3 is now the governing reference for all Phase 1 prompts. | Working auth layer with Clerk, social OAuth, and guest token system |
| 2 | Resolve Open Q#1 (COPPA compliance flow) — requires legal input before any minor account functionality is built | Legal guidance documented; COPPA consent flow designed and locked in ADR |
| 3 | Resolve Open Q#4 (subscription tier member cap) — needed before Phase 3 payment build | Monetization model member cap locked; Stripe integration plan updated |
| 4 | Resolve Open Q#5 (launch geography / GDPR scope) — needed before public launch | Geographic scope locked; privacy policy and data residency approach confirmed |
| 5 | Produce Data Model document — full annotated Prisma schema with all entities, relationships, constraints, and enum definitions | Prisma schema v0.1 reference document |
| 6 | Draft investor pitch narrative (parallel to development) | Pitch deck outline with AI-first and privacy-first positioning |

---

*FamLink ADR v0.3 — Working Draft — March 2026 — CONFIDENTIAL*

*This document is the authoritative technical reference for all FamLink development. Update before changing any locked decision.*
