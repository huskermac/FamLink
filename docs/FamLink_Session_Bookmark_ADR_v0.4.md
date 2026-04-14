# FamLink — Session Bookmark
## ADR v0.4 Planning Work

*April 2026 | CONFIDENTIAL*

---

## Where We Are

**Phase 0:** Complete
**Phase 1:** Complete (P1-01 through P1-12 executed and committed)
**Current work:** Resolving Phase 2 open questions before writing ADR v0.4 and the Phase 2 Cursor Prompt Library

All governing documents are in `.md` format. Word files converted by Cursor.

---

## ADR v0.4 Open Questions — Status

| # | Question | Status | Decision |
|---|---|---|---|
| P2-Q1 | AI monitoring: Helicone vs. LangSmith? | **RESOLVED** | Helicone locked for Phase 2. LangSmith revisit at Phase 3. |
| P2-Q2 | Layer 1 AI tool registry — which tools exactly? | **IN PROGRESS** | See full detail below — substantial ground covered |
| P2-Q3 | Mobile (Build Order 16) — Phase 2 or Phase 3? | OPEN | |
| P2-Q4 | Prisma 7 upgrade — now or stay on 5.16.0? | OPEN | |
| P2-Q5 | Graph DB evaluation — Neo4j/Neptune go/no-go? | OPEN | |
| P2-Q6 | Socket.io scope for Phase 2 | OPEN | |

**Next session starts at:** Q2 continued — Question 6 of ~8 on the tool registry interview

---

## P2-Q1 Decision Detail (for ADR)

| Field | Value |
|---|---|
| **Decision** | Helicone for AI observability at Phase 2 |
| **Rationale** | Lowest integration friction with Vercel AI SDK. Provides cost tracking, request logging, caching, and rate limit enforcement — exactly what's needed during initial AI layer build. LangSmith deferred: its value is in prompt evaluation discipline (regression testing, evaluation datasets), which is Phase 3 work. LangChain/LangSmith migration path remains open and is bounded to the orchestration layer when needed. |
| **ADR Status** | LOCKED — REVISIT PHASE 3 |

---

## P2-Q2 — Layer 1 AI Tool Registry (In Progress)

### Locked Decisions

**Scope of capability:**
- Read and write against all five data domains (Persons, Family Groups & Households, Relationships, Events, Calendar)
- All writes require human-in-the-loop confirmation via propose-confirm pattern — applied universally to all Layer 1 writes, not just Layer 3
- No external APIs in Phase 2
- Commerce and external search (venue finding, gift suggestions) confirmed as Layer 3 / Phase 3

**AI learning from patterns:**
- Phase 2 (Layer 1): Static graph-based suggestions — "I see these people are connected"
- Phase 3 (Layer 2): Pattern learning from historical decisions — "You've never invited Sally's cousin, not suggesting him"

**Data access:**
- Contact details (email/phone) follow user privacy preferences for active members
- Passive members' contact details restricted by default
- AI reads within authenticated user's scope boundary only

---

### New Schema Decisions (all require Prisma migrations before Phase 2 build)

#### 1. Graph Scope Model — `family_members` table

New fields:
- `scope` enum: `INTERNAL | BOUNDARY | EXTERNAL`
- `anchor_person_id` nullable FK → persons (links BOUNDARY member to the person who sponsors their inclusion)

| Scope | Meaning |
|---|---|
| `INTERNAL` | Full active members of the family group |
| `BOUNDARY` | Explicitly pulled in via anchor relationship — present in scope, treated as family, but belong primarily to another unit |
| `EXTERNAL` | Reachable through graph but outside active scope — AI cannot see them |

Example: Son's ex-wife and her new husband/children are BOUNDARY members, anchored to the granddaughter.

#### 2. Event Role Hierarchy — event membership/invitation record

| Role | Capability |
|---|---|
| `PRIMARY_ORGANIZER` | Full control; created the event; can delegate |
| `SECONDARY_ORGANIZER` | Delegated authority — manage invites, RSVPs, event details |
| `INVITEE` | RSVP only |
| `GUEST` | RSVP via guest token, no account required |

Further granularity (invite-only vs. full edit for secondary organizers) deferred to Phase 3.

#### 3. EventItems — replaces PotluckAssignment

Rename: `PotluckAssignment` → `EventItems` (Prisma migration + full codebase find-and-replace)

| Field | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `event_id` | FK → events | |
| `created_by_person_id` | FK → persons | Organizer or attendee |
| `assigned_to_person_id` | FK → persons, nullable | Null = unassigned / open to claim |
| `name` | string | "Mashed potatoes", "Paper plates" |
| `quantity` | string, nullable | "2 dozen", "1 case" |
| `notes` | string, nullable | Free text |
| `is_checklist_item` | boolean | True = organizer self-provides |
| `status` | enum | `UNCLAIMED \| CLAIMED \| PROVIDED \| CANCELLED` |
| `visibility` | enum | `PUBLIC \| PRIVATE` — default PUBLIC; enforcement Phase 3 |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

Three usage patterns:
- **Potluck delegation** — organizer creates items, attendees claim
- **Attendee extension** — any attendee adds items they're volunteering
- **Organizer checklist** — self-provided items, visible to attendees (hidden item support e.g. birthday cake deferred to Phase 3 via visibility flag)

#### 4. Household Members — expanded model

| Field | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `household_id` | FK → households | |
| `person_id` | FK → persons | |
| `status` | enum | `PRIMARY \| SECONDARY \| FORMER` |
| `role` | enum | `MEMBER \| DECISION_MAKER` |
| `joined_at` | timestamp | |
| `left_at` | timestamp, nullable | Null = current member |
| `expected_return_at` | timestamp, nullable | College, temporary absence |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

Constraints:
- One `PRIMARY` household per person at any time — enforced at DB and API layer
- A person cannot hold `PRIMARY` and `SECONDARY` status at the same household simultaneously
- Multiple `DECISION_MAKER` roles allowed per household — no artificial limit
- `FORMER` members retain historical role for record integrity but lose active authority
- Default role on creation: `MEMBER`

`DECISION_MAKER` role drives four Phase 2 features:

| Use Case | Layer | Phase |
|---|---|---|
| Notification routing — important notices go to Decision Makers first | Notification Service | Phase 2 |
| RSVP authority — Decision Maker can RSVP on behalf of household members | Events API + propose-confirm | Phase 2 |
| Organizer suggestion — AI suggests Decision Makers as likely event organizers | Layer 1 AI tool | Phase 2 |
| Permission escalation — sensitive AI actions require Decision Maker confirmation | AI guardrails layer | Phase 2 |

---

### Event Scope Model (no schema change required)

- Events are ad hoc scope expansions — any reachable person in the graph can be invited regardless of standing scope status
- Organizer controls event-level inclusion; can delegate to Secondary Organizers
- AI suggests cross-boundary invites based on graph relationships (static logic in Phase 2)
- Notification fan-out: INTERNAL per preferences; BOUNDARY per anchor relevance; EXTERNAL via explicit invitation

---

### AI Context Assembler — Two-Tier Model

**Tier 1 — Always loaded (standing context):**
- Authenticated user's profile and preferences
- INTERNAL family members (names, relationships, birthdays)
- Upcoming events in the next 30 days
- Open RSVPs awaiting response

**Tier 2 — Loaded on demand (dynamic context):**
- Specific event details including invitations, RSVPs, EventItems
- BOUNDARY members relevant to the query
- Historical data when the question requires it

Context Assembler must be built with a **configuration layer** controlling:
- Tier 1 content definition
- Token budget per tier
- Lookback/lookahead windows (e.g., 30 days = config value, not hardcoded)

---

### Layer 1 Tool Registry — Draft (30 tools)

**Persons**
- `get_person` — look up a family member's profile
- `list_family_members` — list members within scope
- `create_person` — add a new family member record (propose-confirm)
- `update_person` — update a profile field (propose-confirm)

**Family Groups & Households**
- `get_family_group` — retrieve family group details
- `list_households` — list households within the family group
- `create_household` — add a new household (propose-confirm)
- `update_household` — update household details (propose-confirm)

**Relationships**
- `get_relationship` — look up how two people are related
- `create_relationship` — add a relationship between two people (propose-confirm)
- `list_relationships` — list all relationships for a person

**Events**
- `get_event` — retrieve event details
- `list_events` — list upcoming or past events
- `create_event` — create a new event (propose-confirm)
- `update_event` — modify event details (propose-confirm)
- `cancel_event` — cancel an event (propose-confirm)
- `list_event_invitations` — who's been invited
- `create_event_invitation` — invite someone (propose-confirm)
- `get_rsvp_status` — who has/hasn't responded
- `update_rsvp` — record or change an RSVP (propose-confirm)

**EventItems**
- `list_event_items` — what's on the list
- `create_event_item` — add an item (propose-confirm)
- `update_event_item` — modify or claim an item (propose-confirm)
- `delete_event_item` — remove an item (propose-confirm)

**Calendar**
- `get_upcoming_events` — next N days of events
- `get_birthday_digest` — upcoming birthdays within scope
- `get_calendar_view` — full calendar for a date range

**Notifications** *(propose-confirm on all)*
- `send_event_reminder` — remind invitees about an upcoming event
- `send_rsvp_nudge` — nudge non-responders
- `send_announcement` — broadcast to a defined group

---

### Questions Remaining in Tool Registry Interview

- Question 6 of ~8 ← **next session starts here**
- Question 7 of ~8
- Question 8 of ~8

---

## Phase 2 Pre-Flight Migration List

All four are additive — no Phase 1 data is broken. Johnson family seed data survives intact.

| # | Migration | Type |
|---|---|---|
| 1 | Rename `PotluckAssignment` → `EventItems` + expand model | Rename + new fields |
| 2 | Add `scope` enum + `anchor_person_id` to `family_members` | New fields |
| 3 | Add event role hierarchy to event membership/invitation record | New enum + fields |
| 4 | Expand `household_members` — add `status`, `role`, `left_at`, `expected_return_at`; enforce single-PRIMARY constraint | New fields + constraint |

---

## Key Rules (carry into every session)

- ADR v0.3 is the current governing document until v0.4 is produced
- All new documents are `.md` format
- Documents are created by Claude, downloaded by Steve, placed in `/docs` manually
- No decisions are locked until explicitly confirmed by Steve
- Principle: don't model for imagined complexity — model for known requirements
- Commit format: `feat: P2-XX <short description>`

---

*Resume by loading this bookmark in a new Claude session. FamLink project context is in project knowledge.*
