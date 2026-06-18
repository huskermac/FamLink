# FamLink
## *The Family Operating System*
## Architecture Decision Record
### Version 0.4 — Working Draft

*April 2026 | CONFIDENTIAL*

| **Field** | **Value** |
|---|---|
| Companion Document | FamLink PRD v0.1 |
| Document Version | v0.4.7 — Working Draft |
| Prior Version | v0.4.6 (ADR-15: content moderation strategy locked; Q#6 resolved) |
| Status | Decisions locked unless marked OPEN or DEFERRED |
| AI Architecture | First-class concern — reviewed alongside conventional stack |
| Build Strategy | AI-assisted development (Cursor / Claude Code), small team |
| Primary Author | Founder + Claude (planning assistant) |

---

## Version History

| **Version** | **Date** | **Summary of Changes** |
|---|---|---|
| v0.1 | March 2026 | Initial ADR — all baseline decisions locked. Open questions identified. |
| v0.2 | March 2026 | ADR-00 added (Turborepo + npm workspaces locked). Open Q#3 resolved: AI rate limit 20 queries/user/day; max iteration limits; no recursive tool calls. Prisma pinned at 5.16.0; v7 upgrade deferred to Phase 2. Next.js patched from 14.1.0 to 14.2.35 (security CVE). |
| v0.3 | March 2026 | ADR-07 updated: Resend replaces SendGrid. Open Q#4 partially resolved: is_minor boolean replaced with age_gate_level enum (NONE / YOUNG_ADULT / MINOR) + nullable guardian_person_id. MVP adults-only for accounts and communications; minors are passive graph nodes only. |
| v0.4 | April 2026 | Phase 2 planning complete. All six Phase 2 open questions resolved and locked. ADR-04 updated: Prisma 7 upgrade promoted to Phase 2, executed first. ADR-06 updated: Layer 1 AI tool registry locked (10 tools); Helicone locked for AI observability. ADR-09 updated: Socket.io Phase 2 scope defined (new event push + RSVP push only). ADR-12 added: AI Observability (Helicone). Build dependency map updated for full Phase 2 scope. Mobile (React Native + Expo) confirmed for Phase 2. Graph DB evaluation approach locked as evidence-based spike. |
| v0.4.1 | April 2026 | P2-00 pre-flight clarifications. ADR-04 updated: Prisma canonical location is `packages/db` (not `apps/api`); upgrade targets that package. ADR-12 updated: Vercel AI Gateway OIDC auth considered and deferred — not available on Railway; direct provider keys via Helicone remain correct for current deployment target. ADR-13 added: Test framework locked — Vitest (API + web), Jest + Expo preset (mobile); Phase 1 Jest integration tests migrated to Vitest (not run alongside). |
| v0.4.2 | April 2026 | ADR-10 updated: P2-10 photo sharing scope locked. Profile photos + event photo galleries ship in Phase 2. Family/general album, image resize pipeline, and facial recognition search explicitly deferred to Phase 3. |
| v0.4.3 | May 2026 | ADR-07 updated: age_gate_level values renamed to ADULT / TEEN / CHILD with explicit age cutoffs. Passive-only policy for CHILD confirmed; TEEN default passive with parental permission plan deferred to Phase 3+. Open Q#4 further resolved. |
| v0.4.4 | May 2026 | ADR-11 updated: subscription tier structure and billing architecture locked. Open Q#2 resolved. |
| v0.4.5 | May 2026 | ADR-14 added: geographic scope and data residency locked. Open Q#5 resolved. |
| v0.4.6 | May 2026 | ADR-15 added: content moderation strategy locked. Open Q#6 resolved. |
| v0.4.7 | June 2026 | Phase 3 reconciliation to shipped reality. ADR-02 updated: Next.js upgraded 14.2.35 → 15.2.8 (App Router) during Phase 3 deploy bring-up. ADR-11 updated: Stripe subscription billing shipped in P3-01 (not deferred); `includedSeats` refinement added — base price covers a configurable number of active seats, only the overflow is billed. ADR-13 updated: 80% line-coverage threshold now CI-enforced (vitest `coverage.thresholds` + GitHub Actions gate). P3-00 Privacy & Billing Integrity hardening recorded: private events fully hidden, billing admin-only with Stripe as source of truth, per-family AI tool binding, atomic AI rate-limit, server-derived photo URLs, guest-endpoint rate limiting. |

---

## 1. Purpose & Scope

This Architecture Decision Record (ADR) documents the significant technical choices made for FamLink's MVP and Phase 2 build. Each decision captures the options considered, the choice made, and the reasoning behind it. These decisions collectively define the technical foundation that all development — including AI-assisted Cursor prompts — will be built upon.

This document should be read alongside the PRD. Where the PRD defines **what** to build and for whom, the ADR defines **how** to build it. Together they are the two source-of-truth documents that govern every development decision.

### Status Badge Reference

| **Status Badge** | **Meaning** |
|---|---|
| **LOCKED** | Decision is final. Do not revisit without a documented reason. |
| **LOCKED — REVISIT PHASE 3** | Final for current phase, but explicitly planned for re-evaluation at Phase 3. |
| **RESOLVED** | Was OPEN in a prior version. Decision made and locked. Retained for traceability. |
| **OPEN** | Decision not yet made. Blocks development until resolved. |
| **DEFERRED** | Not needed for current phase. Will be decided before the relevant phase begins. |

---

## 2. Architecture Overview

FamLink is a three-tier web and mobile application with an AI layer that is architecturally first-class — not bolted on.

| **Layer** | **Components** | **Role** |
|---|---|---|
| Client | React web app (Next.js) + React Native mobile app (Expo) | User interface across all personas and devices |
| API | Node.js / Express REST API + WebSocket server (Socket.io) | Business logic, auth, data access, AI orchestration |
| AI Layer | LLM abstraction (Vercel AI SDK) + Tool registry + Context assembler + Helicone observability | Family assistant, suggestions, agentic actions |
| Data | PostgreSQL (primary) + Redis (cache/sessions) | All persistent data; family graph modeled relationally |
| Services | Clerk (auth) + Resend (email) + Twilio (SMS) + FCM (push) | External integrations for identity and notifications |
| Infrastructure | Vercel (frontend) + Railway (backend) + Cloudflare R2 (media, Phase 2) | Hosting, CDN, storage |

*Principle: Every component chosen is mainstream, well-documented, and well-supported by AI coding tools. Exotic or niche choices are explicitly avoided.*

---

## 3. Architecture Decisions

### ADR-00 — Monorepo Tooling [LOCKED]

**Decision:** Turborepo with npm workspaces. Monorepo structure spans: apps/web (Next.js), apps/mobile (Expo), apps/api (Node/Express), packages/shared (types + utils), packages/ui (component library).

**Rationale:** Turborepo is the leading monorepo build system in the React/Node.js ecosystem with native Next.js, Expo, and Node.js support. npm workspaces chosen over Yarn or pnpm for simplicity and universal compatibility. Turborepo task-pipeline caching reduces CI build times as the codebase grows. This combination is the most AI-tool-friendly monorepo setup available. Resolved from Open Q#1 in v0.2.

#### Workspace Structure

| **Package** | **Path** | **Purpose** |
|---|---|---|
| web | apps/web | Next.js 15 frontend application |
| mobile | apps/mobile | React Native + Expo application |
| api | apps/api | Node.js + Express REST API |
| shared | packages/shared | Shared TypeScript types, utilities, constants |
| ui | packages/ui | Shared React component library (shadcn/ui base) |

---

### ADR-01 — Frontend Framework [LOCKED]

**Decision:** React (TypeScript) — web application built with Next.js App Router. Originally pinned to v14.2.35 (Phase 0 security patch from 14.1.0); upgraded to v15.2.8 during Phase 3 deploy bring-up.

**Rationale:** React is the dominant frontend framework with the largest ecosystem, best AI coding tool support, and most available talent. Next.js adds SSR, API routes, and file-based routing out of the box. TypeScript strict mode is mandatory — it prevents an entire class of runtime errors especially costly in AI-assisted build workflows.

#### Key Conventions

- TypeScript strict mode enabled across the entire codebase
- Tailwind CSS for styling — utility-first, no custom CSS framework
- shadcn/ui for component library — accessible, unstyled, fully owned in codebase
- TanStack Query (React Query v5) for server state management
- Zustand for client-side state — lightweight, simple, AI-tool friendly

---

### ADR-02 — Mobile Strategy [LOCKED]

**Decision:** React Native with Expo — shared codebase targeting iOS and Android. Expo managed workflow. Mobile is confirmed for Phase 2. Both web and mobile UIs are in scope for Phase 2, scoped to wedge features only (event coordination and shared calendar).

**Rationale:** FamLink must be mobile-first. The Organizer, Grandparent, and Co-Parent personas all primarily live on their phones. Investor conversations require demonstrated real usage, and real usage requires mobile — the core user personas will not engage reliably with a web-only product. Expo managed workflow and EAS handle App Store and Play Store deployment without a native developer on the team. Shared types, business logic, API clients, and design tokens across web and mobile via packages/shared reduce total codebase size. Confirmed for Phase 2 in v0.4 (previously DEFERRED).

**Phase 2 Mobile Scope Constraint:** React Native screens covering wedge features only — event coordination and shared calendar. Feature parity with web on core flows. No mobile-exclusive features in Phase 2.

---

### ADR-03 — Backend Framework [LOCKED]

**Decision:** Node.js with Express (TypeScript) — REST API with WebSocket support via Socket.io.

**Rationale:** Node.js/Express is the highest-supported backend stack in AI coding tools and has the largest available reference codebase for Cursor to draw on. TypeScript throughout maintains type safety end-to-end. Express is intentionally minimal — it adds structure without imposing opinion, keeping AI-generated code legible and consistent. Socket.io is added for real-time features. GraphQL explicitly deferred — REST is simpler to build, debug, and prompt-engineer at MVP stage.

#### API Structure

- RESTful resource-based routing: /api/v1/families, /api/v1/events, /api/v1/members, etc.
- Versioned from day one (/api/v1/) to allow non-breaking changes
- JWT-based authentication via Clerk — no custom auth logic
- Zod for request/response validation — schema-first, TypeScript-native
- Prisma ORM for all database access — type-safe, excellent AI tool support

---

### ADR-04 — Database Architecture [UPDATED — v0.4]

**Decision:** PostgreSQL (primary database) + Redis (cache and session store). Prisma ORM. **Prisma 7 upgrade is the first build order item in Phase 2.** Graph DB (Neo4j / AWS Neptune) to be evaluated via a timebox spike in Phase 2; migration only if query complexity evidence justifies it.

**v0.4 Changes:**

1. **Prisma 7 upgrade promoted to Phase 2, executed first.** The original deferral rationale was avoiding risk mid-build. With Phase 1 complete and only seed/test data in the system, this is the lowest-friction window for the upgrade. Executing before any new Phase 2 models are added and before real users are on the system is the correct sequencing. The Prisma 7 upgrade is Build Order 0 for Phase 2 — nothing else begins until it is complete and validated.

2. **Graph DB evaluation approach locked.** A native graph database will not be adopted speculatively. A timebox spike will evaluate PostgreSQL relationship traversal query complexity against the Layer 1 AI tool requirements (particularly `get_relationship_path` and `get_family_members`). If query patterns prove painful in practice, evidence will be clear and a migration decision will be made at that point. Neo4j and AWS Neptune remain the evaluated candidates.

**Rationale (carried from v0.3):** PostgreSQL is the mainstream, production-grade relational database with the strongest ecosystem, best AI tool support, and lowest operational complexity for a small team. The family relationship graph is modeled relationally using a nodes-and-edges table pattern.

#### Prisma Version

| **Item** | **Value** |
|---|---|
| Phase 1 pinned version | 5.16.0 |
| Phase 2 target version | Prisma 7 (latest stable) |
| Upgrade timing | First action in Phase 2, before any other build work |
| Canonical package location | `packages/db` — Prisma schema, migrations, seed, and client generation all live here |
| Consumer access | `apps/api` imports the generated client via the `@famlink/db` internal package — Prisma is never installed directly in `apps/api` |
| Graph DB decision | Evidence-based spike; migration only if PostgreSQL traversal proves insufficient |

#### Core Schema Tables

| **Table** | **Purpose** | **Key Columns** |
|---|---|---|
| persons | Individual user/member records | id, user_id (nullable), name, dob, age_gate_level (enum), guardian_person_id (nullable) |
| relationships | Edges in the family graph | id, from_person_id, to_person_id, type, family_id, created_at |
| family_groups | Extended family containers | id, name, created_by, settings, created_at |
| households | Physical living unit | id, family_id, name, address, created_at |
| household_members | Person to Household edges | id, household_id, person_id, role, joined_at |
| family_members | Person to Family edges | id, family_id, person_id, roles[], permissions, joined_at |

---

### ADR-05 — Authentication & Identity [LOCKED]

**Decision:** Clerk — managed authentication with social OAuth (Google, Apple) and email/password. Guest token system for Reluctant Member participation without account creation.

**Rationale:** Authentication is security-critical and should not be built from scratch. Clerk provides production-grade auth, social OAuth, user management, session handling, MFA, and compliance features out of the box. It integrates natively with Next.js and Expo. Google and Apple OAuth are required at launch — they are the primary onboarding paths for the Organizer persona.

#### Guest Participation Architecture

- Invitations generate a time-limited signed JWT token (24-48 hour expiry for event RSVPs; 7 days for family join invitations)
- Token encodes: invited person ID, event/family ID, permission scope (RSVP-only / view-only / join-pending)
- Guest endpoints (/api/v1/guest/*) validate token signature without requiring a Clerk session
- Guest actions recorded against the person record, not a user account
- Soft upgrade prompt shown after successful guest action — never mandatory, never blocking

#### Minor Profile Handling [UPDATED v0.4.3 — Open Q#4 Further Resolved]

| **Field** | **Type** | **Values / Notes** |
|---|---|---|
| age_gate_level | String | `ADULT` (default, 18+) / `TEEN` (12–17) / `CHILD` (<12) — stored on the persons table |
| guardian_person_id | UUID (nullable) | Foreign key to persons.id — links a child or teen record to their guardian |

**Age tier definitions (locked v0.4.3):**
- **ADULT** — 18 and older. Full account, all communications, AI personalization.
- **TEEN** — 12 through 17. Default passive (no account, no direct comms). Parental permission to activate teen accounts deferred to Phase 3+.
- **CHILD** — Under 12. Always passive. No account, no comms, no AI exposure. Maps to COPPA threshold (under 13).

**Current MVP scope:**
- ADULT: full platform access
- TEEN: passive graph node only — person record exists, no user account, no AI personalization, no direct communications. Default passive unless parental permission flow is activated (Phase 3+).
- CHILD: passive graph node only — person record exists with guardian link; no account, no comms, no behavioral tracking, no AI personalization under any circumstances

**Deferred (Phase 3+) — Teen Parental Permission Plan:**
- A parental consent flow will allow guardians to activate teen (TEEN-tier) accounts
- Teen accounts will operate in a restricted mode: limited AI features, guardian visibility into activity
- Flow design requires legal input and COPPA compliance review before implementation
- Until activated, all TEEN-tier persons remain passive (same as CHILD for practical purposes today)

**Open Q#4 status:** Further resolved. Age tiers, cutoffs, and passive policies are locked. Full COPPA consent flow (especially the guardian activation flow for TEENs) remains open — requires legal input, pre-launch blocker.

---

### ADR-06 — AI Architecture [UPDATED — v0.4]

**Decision:** Vercel AI SDK for LLM abstraction + model-agnostic provider routing + three-layer capability model (Knowledge > Proactive > Agentic). AI rate limit: 20 queries per user per day (beta). Max iteration limits enforced on all agentic tool calls. No recursive tool calls permitted. Layer 1 tool registry locked at 10 tools for Phase 2.

**v0.4 Changes:** Layer 1 tool registry explicitly defined and locked. `create_person` excluded — person creation remains in the invitation flow. Governing principle locked: Layer 1 = one tool call, one answer, one optional propose/confirm write. No tool chaining in Layer 1 under any circumstance.

#### AI Capability Model

| **Layer** | **Phase** | **Capabilities** | **Example Interactions** |
|---|---|---|---|
| Layer 1 — Knowledge | Phase 2 | Answers questions about family data; natural language event creation with propose/confirm | 'When is Dad's birthday?' / 'Who hasn't RSVP'd?' / 'Create a family dinner Saturday at 6pm at Mom's' |
| Layer 2 — Proactive | Phase 3 | Notices patterns; surfaces suggestions; monitors for coordination gaps | 'Emma's recital is Friday — want to invite the grandparents?' / '3 people haven't responded to Thanksgiving' |
| Layer 3 — Agentic | Phase 3 | Takes actions with explicit confirmation; commerce integrations | 'Send reminders to non-responders' / 'Find a venue for 20 near Grandma's and book it' |

#### Layer 1 Tool Registry [LOCKED — v0.4]

**Governing principle: One tool call, one answer, one optional propose/confirm write. No tool chaining. No multi-step reasoning across tools.**

**People & Relationships**

| **Tool** | **What It Does** | **Type** |
|---|---|---|
| `get_person` | Look up a person by name or relationship label | Read |
| `get_family_members` | List members of a family or household | Read |
| `get_relationship_path` | Explain how two people are related | Read |
| `get_upcoming_birthdays` | Return birthdays within a specified time window | Read |

**Events & Calendar**

| **Tool** | **What It Does** | **Type** |
|---|---|---|
| `get_upcoming_events` | List events on the shared calendar | Read |
| `get_event_details` | Return full details for a specific event | Read |
| `get_rsvp_status` | Return attendance status for an event | Read |
| `create_event` | Draft a new event from natural language — propose/confirm guardrail required | Write (guarded) |

**Household & Structure**

| **Tool** | **What It Does** | **Type** |
|---|---|---|
| `get_household_members` | List people in a specific household | Read |
| `get_contact_info` | Return contact details for a person | Read |

**Excluded from Layer 1:** `create_person` — person creation is handled exclusively by the invitation flow (Build Order 5). AI-driven person creation is excluded because it requires relationship context and a second write to produce a valid graph node, violating the single-tool-call principle. It also bypasses the established invitation flow and introduces COPPA exposure risk on age_gate_level misclassification.

**Deferred to Layer 2/3:** Proactive suggestions, bulk operations, fan-out messaging, autonomous invitation sending, family tree generation.

#### Rate Limiting & Guardrails [LOCKED]

| **Guardrail** | **Value** | **Notes** |
|---|---|---|
| AI queries per user per day (beta) | 20 | Hard limit; resets at UTC midnight; surfaced in UI when approaching limit |
| Max tool call iterations per request | Defined per tool | Cap applied to all agentic tool call chains; prevents infinite loops |
| Recursive tool calls | PROHIBITED | No tool may invoke another tool recursively under any circumstance |
| Propose-confirm pattern | REQUIRED on all write tools | AI never modifies family data without explicit user confirmation step |

#### LLM Provider Strategy

| **Provider** | **Use Case** | **Rationale** |
|---|---|---|
| Anthropic Claude Sonnet | Primary assistant model | Strongest instruction-following and structured output; best for family context tasks |
| OpenAI GPT-4o | Fallback / A-B testing | Fastest, widest tool-calling support; good for latency-sensitive interactions |
| GPT-4o-mini / Claude Haiku | High-frequency low-stakes tasks | Proactive suggestions, notification drafting — cost efficiency at scale |
| Google Gemini | Future multimodal features | Photo analysis, voice interaction — Phase 3+ consideration |

---

### ADR-07 — Notifications Infrastructure [LOCKED — UPDATED v0.3]

**Decision:** Three-channel notification stack: Resend (email) + Twilio (SMS) + Firebase Cloud Messaging (push). All three required at MVP.

**v0.3 Change:** SendGrid replaced by Resend as the email provider due to Gmail sender verification restrictions that blocked reliable delivery in development and would create launch risk in production.

| **Channel** | **Provider** | **Use Cases** | **Persona Priority** |
|---|---|---|---|
| Email | Resend | Event invitations, RSVP links, weekly digests, birthday reminders, account management | Reluctant Member (primary), Grandparent (primary), all users |
| SMS | Twilio | Event invitations with RSVP link, day-of reminders, urgent family notifications | Reluctant Member (primary), Grandparent (secondary) |
| Push | Firebase (FCM) | Real-time alerts, RSVP received, new event, AI assistant suggestions | Organizer (primary), Co-Parent (primary), engaged members |

---

### ADR-08 — Hosting & Infrastructure [LOCKED — REVISIT PHASE 3]

**Decision:** Vercel (Next.js frontend) + Railway (Node.js API + PostgreSQL + Redis) for MVP and Phase 2. Evaluate migration to AWS/GCP at Phase 3 when team size or cost efficiency demands it.

#### Environment Strategy

| **Environment** | **Purpose** | **Deployment Trigger** |
|---|---|---|
| Development | Local developer machines | Manual / local only |
| Preview | Per-PR preview deployments (Vercel) | Every pull request — automatic |
| Staging | Pre-production validation | Merge to main branch — automatic |
| Production | Live product | Manual promotion from staging |

---

### ADR-09 — Real-Time & Chat [UPDATED — v0.4]

**Decision:** Socket.io for real-time needs. Phase 2 Socket.io scope is explicitly bounded to two event types. Stream.io for full family group chat deferred to Phase 3.

**v0.4 Change:** Phase 2 Socket.io scope defined and locked.

#### Phase 2 Real-Time Scope [LOCKED]

| **Event** | **Trigger** | **Recipients** |
|---|---|---|
| New event created | Family Organizer creates an event | All family members with access to that family group |
| RSVP updated | Any member responds to an event invitation | Event organizer |

All other real-time capabilities (typing indicators, presence, read receipts, group chat, AI streaming progress beyond basic) are deferred to Phase 3.

**Full real-time is a Phase 3 imperative.** The Phase 2 scope is a bounded MVP that proves the real-time architecture without building full infrastructure. Stream.io remains the chosen platform for full family group chat when Phase 3 begins. Do not build a chat system from scratch under any circumstances.

---

### ADR-10 — Media & File Storage [UPDATED — v0.4.2]

**Decision:** Cloudflare R2 for photo and media storage. P2-10 scope is locked as defined below.

**Rationale:** Cloudflare R2 is preferred: S3-compatible API, zero egress fees critical for photo-heavy usage patterns, strong CDN integration, competitive pricing.

#### P2-10 Scope — Locked

| Feature | Decision | Notes |
|---|---|---|
| Profile photos | **In scope — Phase 2** | Upload headshot to person profile; replaces initials avatar on web + mobile |
| Event photo gallery | **In scope — Phase 2** | Any family member can upload photos to an event; all members can view |
| Originals served from R2 | **In scope — Phase 2** | No resize pipeline at Phase 2; originals served via R2 public URL |
| Family / general photo album | **Deferred — Phase 3** | A standalone family album not attached to a specific event |
| Image resizing / thumbnail pipeline | **Deferred — Phase 3** | Thumbnails, responsive sizes, CDN optimization; add when gallery scale demands it |
| Facial recognition — person search | **Deferred — Phase 3** | Search across all photos (event or album) by person name; requires ML pipeline (AWS Rekognition or equivalent) |

#### Phase 3 Facial Recognition Note

Facial recognition search is a planned Phase 3 capability: given a person name (from the family graph), surface all photos in which that person appears — across events and the family album. This requires a face-indexing pipeline triggered on upload and a query layer against the index. AWS Rekognition is the leading candidate. This feature is explicitly not built in Phase 2 and must not influence the Phase 2 storage or data model decisions.

---

### ADR-11 — Commerce & Payments [UPDATED — v0.4.4]

**Decision:** Stripe for subscriptions and payment processing. Affiliate commerce via partner APIs (Amazon, travel, venues) in Phase 3.

**Rationale:** Two distinct payment concerns exist: (1) user subscriptions for the paid tier, and (2) affiliate/transactional commerce for gifts, reservations, and event services. The AI agentic layer (ADR-06) is designed with commerce tool hooks built in, so the commerce capability plugs in without an architecture change when Phase 3 begins.

#### Subscription Tier Structure [LOCKED — v0.4.4]

**User types:**
- **Active** — has a Clerk account (`userId ≠ null`). Full platform access. Counts toward seat limits.
- **Passive** — person record only (`userId = null`). Receives email/SMS invitations, RSVPs via token link, no login. Always free, never counts toward seat limits.

**Tier model:**

| Tier | Active users included | Passive users | Additional actives |
|---|---|---|---|
| **Base** | 1 (Admin) | Unlimited | Seat surcharge per additional active user |
| **Mid** | Up to N (TBD) | Unlimited | Included up to cap |
| **Unlimited** | Unlimited | Unlimited | — |

Specific prices and exact tier counts (N) are configurable — not hardcoded. See Pricing Architecture below.

**Seat-based billing:** active user count is a declared seat count, not metered. The FamilyGroup owner adjusts seat count explicitly; billing updates at the next Stripe billing cycle.

**`includedSeats` refinement [v0.4.7]:** each tier row carries an `includedSeats` count — the base price covers that many active seats, and only the overflow is billed at the per-seat price. Shipped in P3-01.

#### Pricing Architecture [LOCKED — v0.4.4]

Stripe is the billing engine. The app holds a thin configuration layer:

**`pricing_tiers` table** — maps tier identifiers to Stripe Price IDs plus display metadata. Changing a price = create a new Stripe Price object, update this row. Existing subscribers are unaffected (grandfathered on their current Stripe Price ID).

| Column | Purpose |
|---|---|
| `tier_key` | `BASE`, `MID`, `UNLIMITED` |
| `stripe_price_id` | Stripe Price object ID for base subscription |
| `stripe_seat_price_id` | Stripe Price object ID for per-seat surcharge (BASE tier only) |
| `active_user_limit` | null = unlimited |
| `display_name` | User-facing label |
| `is_active` | Whether this tier is currently offered to new subscribers |

**`promotions` table** — manages promotional pricing windows:

| Column | Purpose |
|---|---|
| `stripe_coupon_id` | Stripe Coupon object reference |
| `name` | Internal label |
| `starts_at` | Promotion window open |
| `ends_at` | Promotion window close (null = indefinite) |
| `eligible_tier_keys` | Which tiers this promotion applies to |
| `is_stackable` | Whether multiple promos can apply simultaneously |

**`family_subscriptions` table** — per-FamilyGroup subscription record:

| Column | Purpose |
|---|---|
| `family_group_id` | FK to FamilyGroup |
| `stripe_subscription_id` | Stripe Subscription object |
| `tier_key` | Current tier |
| `seat_count` | Declared active user seats |
| `grandfathered` | True if subscriber is on a legacy price |
| `price_locked_at` | When grandfathering took effect |

**Grandfathering:** implemented by not migrating existing subscriptions to new Stripe Price IDs when prices increase. Existing `stripe_subscription_id` retains its original `price_id`. The `grandfathered` flag makes these queryable for reporting and eventual migration offers.

**What is NOT locked:** specific price amounts, specific N values for Mid tier, promotional discount amounts. These are all Stripe configuration, not code.

---

### ADR-12 — AI Observability [NEW — v0.4] [LOCKED — REVISIT PHASE 3]

**Decision:** Helicone for AI observability in Phase 2. LangSmith deferred to Phase 3 evaluation. Vercel AI Gateway considered and deferred — see note below.

**Rationale:** Helicone provides the lowest integration friction with the Vercel AI SDK. It delivers cost tracking, request logging, response caching, and rate limit enforcement — exactly the capabilities needed during initial AI layer build and early user testing. LangSmith's primary value is in prompt evaluation discipline: regression testing, evaluation datasets, and systematic prompt quality measurement. That discipline is Phase 3 work, aligned with when the proactive and agentic layers require rigorous quality control. LangChain/LangSmith migration path remains open and is bounded to the orchestration layer when needed.

| **Capability** | **Phase 2 (Helicone)** | **Phase 3 (LangSmith — evaluate)** |
|---|---|---|
| Request logging | ✓ | ✓ |
| Cost tracking | ✓ | ✓ |
| Response caching | ✓ | ✓ |
| Rate limit enforcement | ✓ | ✓ |
| Prompt regression testing | — | ✓ |
| Evaluation datasets | — | ✓ |
| LangChain orchestration | — | ✓ (if adopted) |

**v0.4.1 Note — Vercel AI Gateway:** The Vercel AI Gateway was evaluated as an alternative to direct provider API keys. It offers OIDC auth (no stored provider secrets), built-in model failover, and unified Vercel-dashboard observability. It was deferred because FamLink's API is hosted on Railway, not Vercel — the Gateway's OIDC credential issuance requires the Vercel platform and is unavailable in a Railway deployment. Direct `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars via Helicone remain correct for the current deployment target. If FamLink's API migrates to Vercel in a future phase, replacing Helicone with the AI Gateway is a one-file change to `aiClient.ts`.

---

### ADR-13 — Test Framework [NEW — v0.4.1] [LOCKED]

**Decision:** Vitest for `apps/api` and `apps/web`; Jest with Expo preset for `apps/mobile`. Phase 1 Jest integration tests in `apps/api` migrated to Vitest — not run alongside.

**Rationale:** Phase 1 shipped a Jest test suite in `apps/api` (13 tests, real-database integration pattern via `globalSetup`/`globalTeardown`). P2-00 migrates these to Vitest to establish a single test runner across API and web. Running two test frameworks in the same package indefinitely creates cognitive overhead, inconsistent mock APIs (`jest.mock` vs `vi.mock`), and `turbo test` pipeline complexity. Vitest is materially faster than Jest (native ESM, no transform overhead) and its mock API is a near-identical superset. The migration is mechanical and bounded to 13 existing test files. Mobile uses Jest + Expo preset because `jest-expo` is the only officially supported test runner for Expo managed workflow.

| **Package** | **Test Runner** | **Mock Strategy** | **Environment** |
|---|---|---|---|
| `apps/api` | Vitest | `vi.mock()` — Prisma mocked at module level; no real DB in unit tests | node |
| `apps/web` | Vitest | `vi.mock()` — API calls mocked | jsdom |
| `apps/mobile` | Jest + `jest-expo` preset | Jest mocks | React Native (Expo) |

**Coverage threshold:** 80% line coverage minimum across all packages — CI-enforced via vitest `coverage.thresholds` (API + web) and the GitHub Actions test gate [v0.4.7].

**Migration note:** The Phase 1 `globalSetup`/`globalTeardown` real-database pattern is replaced by module-level Prisma mocks (`vi.mock('@famlink/db')`). This gives faster, deterministic unit tests. Integration tests requiring a live database are explicitly out of scope for the Phase 2 test suite — if needed in future, they would be a separate `test:integration` script.

---

### ADR-14 — Geographic Scope & Data Residency [NEW — v0.4.5] [LOCKED]

**Decision:** US-only for active users at launch. Passive users permitted worldwide. Full international expansion deferred to Phase 3+.

**Active users (US only):**
- Clerk signup is soft geo-restricted to US at launch — IP-based country check discourages non-US account creation. Not a hard block (VPNs exist, edge cases are handled gracefully), but the product is not marketed or supported outside the US.
- US-only scope means GDPR does not govern the core product at launch.

**Passive users (worldwide):**
- A US active user may invite a family member anywhere in the world as a passive guest.
- Passive person records hold minimal data: name + one contact method (email or phone).
- No behavioral tracking, no AI personalization, no Clerk account for passive persons.
- Legal basis for holding passive EU-resident data: legitimate interest (family coordination) + implied consent via invitation acceptance.
- Privacy policy must acknowledge worldwide passive data collection and state the legal basis.

**GDPR surface area:**
- Technically applies to any EU-resident passive person's data, but exposure is narrow: name + contact only, no tracking, no profiling.
- Right-to-erasure for passive persons is partially implemented via the `forgottenAt` field on Relationship records. Full erasure support (including Person record deletion) is a Phase 3+ requirement before any international marketing.
- Right-to-access requests for passive EU persons: handled manually at launch (support ticket → admin DB lookup).

**Data residency:**
- All data hosted in Railway US region (PostgreSQL + Redis). No data leaves US infrastructure.
- No EU data residency requirement at launch given passive-only EU exposure.
- Revisit if active user expansion to EU is scoped in Phase 3+.

**Deferred:**
- Full GDPR compliance program (DPA, SCCs, EU data residency) — deferred to Phase 3+ international expansion
- CCPA compliance review — medium priority, revisit before public launch given US focus
- Hard geo-blocking on Clerk signup — deferred; soft restriction sufficient at launch

### ADR-15 — Content Moderation Strategy [NEW — v0.4.6] [LOCKED]

**Decision:** Two-track moderation — family admin manual suppression + AI automated review. Post-publish review for text/links; pre-publish hold for images/videos. Dual escalation path to family admin and FamLink staff for both flagged and auto-suppressed content.

**Manual suppression (family admin):**
- Any family admin may suppress any content item (posts, photos, comments, event descriptions) within their family group.
- Suppression is a soft delete — content is hidden from all members but retained in the database for audit and potential reinstatement.
- Hard deletion requires a FamLink staff action (escalated via the staff moderation queue).
- Suppression is logged with timestamp and acting admin ID.

**AI automated moderation:**
- All published content passes through an AI moderation pipeline. The pipeline runs asynchronously for text/links and synchronously for images/videos.

*Text and link content (post-publish):*
- Content goes live immediately upon submission.
- AI reviews in the background; result arrives within seconds.
- If flagged or severe: suppression applied retroactively and escalation triggered.
- Net user experience: slight delay between live appearance and moderation action in edge cases — acceptable for text given real-time social expectations.

*Image and video content (pre-publish):*
- Content is held in a pending state after upload; not visible to other members.
- AI review runs synchronously before release. Content appears in the feed only after AI clears it.
- Latency is acceptable — uploads already introduce a processing wait; extending it for safety review is a reasonable tradeoff.
- If AI cannot produce a decision (timeout, error): content defaults to held and routed to the staff queue.

**Severity tiers:**

| **Tier** | **AI Verdict** | **Action** |
|---|---|---|
| Clean | No policy concern detected | Content published/remains live; no escalation |
| Flagged | Potential policy concern | Content remains visible; queued for family admin review; FamLink staff notified |
| Severe | Clear policy violation | Content auto-suppressed immediately; dual escalation to family admin + FamLink staff |

**Escalation — dual track:**
- All flagged or severe verdicts trigger notifications on both tracks simultaneously.
- **Family admin track:** In-app notification to all family group admins; surfaced in an admin moderation panel (Phase 3 deliverable).
- **FamLink staff track:** Item routed to an internal staff moderation queue for independent review and potential hard-delete or account action.
- Dual escalation ensures no single actor (admin or staff) has unilateral authority over disputed content.

**Data model (Phase 3 implementation):**
- `ModerationEvent` table: `contentType`, `contentId`, `verdict` (CLEAN/FLAGGED/SEVERE), `modelUsed`, `confidence`, `reviewedAt`, `reviewedBy` (null for AI), `suppressedAt`, `restoredAt`
- Suppression state on content records: `suppressedAt`, `suppressedBy`, `suppressionSource` (ADMIN/AI/STAFF)
- Staff queue: separate table; consumed by internal tooling outside the family-facing app

**Deferred:**
- Family admin moderation panel UI — Phase 3 deliverable
- FamLink staff moderation tooling — Phase 3 deliverable; internal admin app outside family-facing product
- Appeals flow (member disputes admin suppression) — deferred, post-launch
- Fine-grained content category labels (violence, harassment, CSAM, etc.) — AI model-dependent; implement alongside model selection

---

## 4. Confirmed Technology Stack — Summary

| **Category** | **Technology** | **Version / Notes** | **Status** |
|---|---|---|---|
| Frontend Framework | Next.js (React) | v15.2.8 — App Router (upgraded Phase 3) | **LOCKED** |
| Frontend Language | TypeScript | Strict mode | **LOCKED** |
| Styling | Tailwind CSS + shadcn/ui | Utility-first; unstyled components | **LOCKED** |
| State — Server | TanStack Query (React Query) | v5 | **LOCKED** |
| State — Client | Zustand | Lightweight store | **LOCKED** |
| Mobile | React Native + Expo | Managed workflow; Expo Router; Phase 2 | **LOCKED** |
| Backend Framework | Node.js + Express | TypeScript; REST API | **LOCKED** |
| Validation | Zod | Schema-first; TypeScript-native | **LOCKED** |
| ORM | Prisma | v7 (Phase 2 upgrade — first Phase 2 action); v5.16.0 pinned through Phase 1 | **LOCKED** |
| Primary Database | PostgreSQL | Via Railway managed service | **LOCKED** |
| Cache / Sessions | Redis | Via Railway managed service | **LOCKED** |
| Monorepo Tooling | Turborepo + npm workspaces | ADR-00 | **LOCKED** |
| Authentication | Clerk | Social OAuth + email/password + guest tokens | **LOCKED** |
| AI Abstraction | Vercel AI SDK | Model-agnostic; streaming support | **LOCKED** |
| AI — Primary Model | Anthropic Claude Sonnet | Via Vercel AI SDK | **LOCKED** |
| AI — Fallback Model | OpenAI GPT-4o | Via Vercel AI SDK | **LOCKED** |
| AI Observability | Helicone | Phase 2; LangSmith revisit at Phase 3; Vercel AI Gateway deferred (Railway deployment) | **LOCKED — REVISIT PHASE 3** |
| Test Framework — API/Web | Vitest | `@vitest/coverage-v8`; 80% line threshold; node env (API), jsdom (web) | **LOCKED** |
| Test Framework — Mobile | Jest + jest-expo | `@testing-library/react-native`; 80% line threshold | **LOCKED** |
| AI Rate Limit | 20 queries/user/day (beta) | Max iteration limits; no recursive tool calls | **LOCKED** |
| AI Tool Registry (Layer 1) | 10 tools (9 read + create_event) | Single-tool-call principle; propose/confirm on writes | **LOCKED** |
| Email | Resend | Transactional + invitations (replaced SendGrid v0.3) | **LOCKED** |
| SMS | Twilio | Invitations + reminders | **LOCKED** |
| Push Notifications | Firebase Cloud Messaging | iOS + Android | **LOCKED** |
| Real-Time (Phase 2) | Socket.io | New event push + RSVP push only | **LOCKED** |
| Real-Time (Phase 3) | Stream.io | Full family group chat | **DEFERRED** |
| Frontend Hosting | Vercel | Native Next.js platform | **LOCKED** |
| Backend Hosting | Railway | API + DB + Redis managed | **LOCKED** |
| Media Storage | Cloudflare R2 | Phase 2 — profile photos + event galleries (P2-10); family album + image resize + facial recognition → Phase 3 | **LOCKED** |
| Payments | Stripe | Phase 3 — subscriptions + commerce | **DEFERRED** |
| Graph DB | Neo4j / AWS Neptune | Phase 2 spike; migrate only if PostgreSQL traversal insufficient | **DEFERRED — pending spike** |

---

## 5. Build Dependency Map

The following sequence governs what must be built before what. Cursor prompts must follow this order. Phase 0 and Phase 1 are complete. Phase 2 begins with the Prisma 7 upgrade.

| **Build Order** | **Module** | **Depends On** | **Key Deliverable** | **Phase** |
|---|---|---|---|---|
| 1 | Project scaffold + TypeScript config | — | Next.js + Expo monorepo, shared types, CI pipeline | Phase 0 — DONE |
| 2 | Database schema + Prisma setup | — | Prisma schema, migrations, seed data, Postgres connection | Phase 0 — DONE |
| 3 | Authentication (Clerk) | 1 | Login, OAuth, session management, guest token system | Phase 1 — DONE |
| 4 | Family Graph API | 2, 3 | Persons, relationships, households, family groups — CRUD | Phase 1 — DONE |
| 5 | Invitation System | 3, 4 | Email + SMS invite delivery, guest token generation, RSVP capture | Phase 1 — DONE |
| 6 | Event Hub API | 2, 3, 4 | Event CRUD, invitation, RSVP, potluck assignments | Phase 1 — DONE |
| 7 | Shared Calendar API | 2, 3, 4, 6 | Calendar views, birthday auto-population, event aggregation | Phase 1 — DONE |
| 8 | Notification Service | 3, 5, 6 | Resend + Twilio + FCM integration, preference management | Phase 1 — DONE |
| 9 | Frontend — Auth + Onboarding | 3 | Sign up, login, create family, invite first members | Phase 1 — DONE |
| P2-00 | Prisma 7 upgrade | All Phase 1 complete | Prisma 7 installed, all migrations validated, seed data confirmed, no regressions | **Phase 2 — FIRST** |
| P2-01 | PostgreSQL graph traversal spike | P2-00, 4 | Layer 1 traversal queries benchmarked; graph DB go/no-go recommendation | Phase 2 |
| P2-02 | AI Context Assembler | P2-00, 4, 6, 7 | Family context builder, token budget management | Phase 2 |
| P2-03 | AI Assistant API + Layer 1 Tools | 3, P2-02 | Chat endpoint, streaming, all 10 Layer 1 tools, Helicone integration | Phase 2 |
| P2-04 | Socket.io — Phase 2 Scope | 3, 6 | New event push + RSVP push; WebSocket server | Phase 2 |
| P2-05 | Frontend — Family Graph UI (Web) | 4, 9 | Member directory, relationship view, profile pages | Phase 2 |
| P2-06 | Frontend — Event Hub UI (Web) | 6, 8, 9 | Event creation, invitation, RSVP management, organizer dashboard | Phase 2 |
| P2-07 | Frontend — Calendar UI (Web) | 7, P2-06 | Unified calendar, birthday view, event detail | Phase 2 |
| P2-08 | Frontend — AI Assistant UI (Web) | P2-03, P2-06 | Chat interface, tool result cards, streaming display | Phase 2 |
| P2-09 | Mobile — Core Screens (Expo) | All API complete, P2-04 | React Native screens: auth, family graph, event hub, calendar, AI assistant | Phase 2 |
| P2-10 | Cloudflare R2 + Photo Sharing | P2-05, P2-09 | Media upload, storage, CDN delivery | Phase 2 |
| P2-11 | Stream.io — Group Chat | All Phase 2 complete | Full family group chat; managed real-time messaging | Phase 3 |
| P2-12 | Stripe — Subscriptions | All Phase 2 complete | Subscription billing, paid tier enforcement | Phase 3 |
| P2-13 | Layer 2 — Proactive AI | P2-03 | Proactive suggestions, pattern detection, coordination gap monitoring | Phase 3 |
| P2-14 | Layer 3 — Agentic AI + Commerce | P2-13, P2-12 | Agentic actions with propose/confirm; affiliate commerce integrations | Phase 3 |

---

## 6. Open Architectural Questions

Questions resolved in prior versions are shown with RESOLVED status for traceability.

| **#** | **Question** | **Status** | **Blocks** | **Notes** |
|---|---|---|---|---|
| 1 | Monorepo tooling: Turborepo vs. Nx vs. npm workspaces? | **RESOLVED** | — | Turborepo + npm workspaces. Locked ADR-00. Resolved v0.2. |
| 2 | What is the exact member cap for the family subscription tier? | **RESOLVED** | — | Resolved v0.4.4: seat-based model; Active/Passive user distinction; Base/Mid/Unlimited tiers; configurable pricing via Stripe + DB config layer; grandfathering + promotional pricing architecture locked. Locked ADR-11. |
| 3 | AI rate limits per user per day — cost-sustainable thresholds? | **RESOLVED** | — | 20 queries/user/day (beta). Max iteration limits. No recursive tool calls. Locked ADR-06. Resolved v0.2. |
| 4 | COPPA compliance: parental consent flow design for minor profiles? | **OPEN** | Minor account functionality | Further resolved v0.4.3: age tiers renamed ADULT/TEEN/CHILD with explicit cutoffs (18+/12-17/<12). CHILD always passive. TEEN default passive — parental permission activation deferred to Phase 3+. Full COPPA consent flow requires legal input. Pre-launch blocker. |
| 5 | What US states / regions are in scope at launch? (GDPR scope?) | **RESOLVED** | — | Resolved v0.4.5: US-only active users; passive users worldwide (minimal data, invitation-consent basis). GDPR surface area narrow but present for passive EU persons — full compliance program deferred to Phase 3+ international expansion. Locked ADR-14. |
| 6 | Moderation strategy for harmful or abusive family content? | **RESOLVED** | — | Resolved v0.4.6: dual-track moderation — family admin manual suppression + AI automated review. Post-publish for text/links; pre-publish hold for images/videos. Dual escalation to family admin + FamLink staff. Three severity tiers: Clean / Flagged / Severe. Locked ADR-15. |
| P2-Q1 | AI monitoring: Helicone vs. LangSmith? | **RESOLVED** | — | Helicone locked for Phase 2. LangSmith revisit Phase 3. Locked ADR-12. Resolved v0.4. |
| P2-Q2 | Layer 1 AI tool registry — which tools exactly? | **RESOLVED** | — | 10 tools locked. create_person excluded. Single-tool-call principle locked. Locked ADR-06. Resolved v0.4. |
| P2-Q3 | Mobile (Build Order P2-09) — Phase 2 or Phase 3? | **RESOLVED** | — | Mobile in Phase 2. Both web and mobile UIs in scope. Wedge features only. Locked ADR-02. Resolved v0.4. |
| P2-Q4 | Prisma 7 upgrade — now or stay on 5.16.0? | **RESOLVED** | — | Upgrade is Phase 2 Build Order 0 (first action). Locked ADR-04. Resolved v0.4. |
| P2-Q5 | Graph DB evaluation — Neo4j/Neptune go/no-go? | **RESOLVED** | — | Evidence-based spike (P2-01). Migration only if PostgreSQL traversal proves insufficient. Locked ADR-04. Resolved v0.4. |
| P2-Q6 | Socket.io scope for Phase 2 | **RESOLVED** | — | Phase 2 scope: new event push + RSVP push only. Full real-time is Phase 3. Locked ADR-09. Resolved v0.4. |
| P2-Q7 | Test framework: Vitest vs. Jest vs. coexistence? | **RESOLVED** | — | Vitest for API + web; Jest+Expo for mobile. Phase 1 Jest tests migrated to Vitest (not coexisted). Locked ADR-13. Resolved v0.4.1. |
| P2-Q8 | Vercel AI Gateway vs. direct provider keys? | **RESOLVED** | — | Direct keys via Helicone. AI Gateway deferred — requires Vercel platform; FamLink API on Railway. Revisit if API migrates to Vercel. Locked ADR-12. Resolved v0.4.1. |

---

## 7. Next Steps

| **Priority** | **Action** | **Output** |
|---|---|---|
| 1 | Produce Phase 2 Cursor Prompt Library (P2-00 through P2-10) | Prompt library with pre-flight checklists, build prompts, acceptance criteria, and review prompts for each Phase 2 build order item |
| 2 | Execute Prisma 7 upgrade (P2-00) — first Phase 2 action before any other build work | Validated Prisma 7 installation, all migrations passing, seed data confirmed |
| 3 | Execute PostgreSQL graph traversal spike (P2-01) — graph DB go/no-go | Benchmark results; recommendation for or against graph DB migration |
| 4 | Resolve Open Q#4 (COPPA compliance flow) — pre-launch blocker — requires legal input | COPPA consent flow designed and locked; ADR updated |
| 5 | Resolve Open Q#2 (subscription tier member cap) — needed before Phase 3 payment build | Monetization model member cap locked; Stripe integration plan updated |
| 6 | Resolve Open Q#5 (launch geography / GDPR scope) — needed before public launch | Geographic scope locked; privacy policy and data residency approach confirmed |
| 7 | ~~Resolve Open Q#6 (content moderation strategy)~~ **DONE** | Dual-track moderation locked: admin suppression + AI review + dual escalation. Locked ADR-15. |
| 8 | Corporate formation (Delaware C-Corp via Clerky) — execute before any contractor or advisor engagements | Incorporation complete; IP assignment, NDA, contractor agreements executed |

---

*FamLink ADR v0.4.6 — Working Draft — May 2026 — CONFIDENTIAL*

*This document is the authoritative technical reference for all FamLink development. Update before changing any locked decision.*
