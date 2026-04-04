# FamLink — Cursor Prompt Library
## Phase 1 Continuation: P1-05 through P1-12

*The Family Operating System*
Version 1.0 — Restart Edition (April 2026) | CONFIDENTIAL

| Field | Value |
|---|---|
| Governing ADR | FamLink ADR v0.3 (authoritative — all prompts derive from this) |
| Governing PRD | FamLink PRD v0.1 |
| Prerequisite | P1-01 through P1-04 complete, committed, and audit-passing |
| Prompt Range | P1-05 through P1-12 |
| Build Orders Covered | 4 (Family Graph API), 5 (Invitation System), 6 (Event Hub), 7 (Calendar), 8 (Notifications), 11 (Frontend Onboarding) |

---

## 1. How to Use This Document

| Phase | Tool | Action |
|---|---|---|
| Plan | Claude | Read the prompt. Understand the objective, context, and acceptance criteria before opening Cursor. |
| Build | Cursor | Paste the Cursor Prompt into Composer (Ctrl+Shift+I). Review generated code. Accept or iterate until acceptance criteria are met. |
| Review | Claude | Use the Claude Review Prompt at the end of each section. Paste generated code into Claude. Fix flagged issues before the next prompt. |

### Critical Rules

- **Never skip a prompt.** Each depends on the deliverables of prior prompts.
- **Do not modify the stack.** All technology choices are LOCKED in ADR v0.3. If Cursor suggests an alternative library, reject it and reference the ADR.
- **TypeScript strict mode is non-negotiable.** Zero errors before marking a prompt complete.
- **Claude review is mandatory.** Do not skip it to save time.
- **Commit after each prompt.** Reference the Prompt ID in the commit message (e.g., `feat: P1-05 persons-api`).
- **ADR v0.3 governs.** If any conflict exists between this document and ADR v0.3, the ADR wins. Flag the conflict before proceeding.

---

## 2. Pre-Flight Checklist — Verify Before Running P1-05

> **Cursor instruction:** Read this section and verify each item by inspecting the codebase and running commands. Report PASS, FAIL, or MISSING for each check. Do not proceed to P1-05 until all items pass.

| # | Item | Verification |
|---|---|---|
| 2.1 | P1-01: Express API Foundation | `GET /health` returns 200; `AgeGateLevel` exported from `@famlink/shared`; `tsc --noEmit` clean in `apps/api` |
| 2.2 | P1-02: Clerk in Next.js | `clerkMiddleware` present in `apps/web/middleware.ts`; sign-in and sign-up catch-all routes exist; `tsc --noEmit` clean in `apps/web` |
| 2.3 | P1-03: Clerk in Express API | `requireAuth` middleware returns 401 for missing auth; Svix webhook verification present in `routes/webhooks.ts`; `user.created` creates Person with `ageGateLevel: 'NONE'` |
| 2.4 | P1-04: Guest Token System | `generateGuestToken` and `verifyGuestToken` exported from `lib/guestToken.ts`; `GET` and `POST /api/v1/guest/*` routes mounted **without** `requireAuth` |
| 2.5 | turbo type-check | Run `turbo type-check` — zero TypeScript errors across all packages |
| 2.6 | Git history | `git log --oneline` shows commits for P1-01, P1-02, P1-03, P1-04 |

**Do not proceed if any item above fails.** If P1-01 through P1-03 have gaps, run the audit prompt in `FamLink_Cursor_Audit_P1-01_to_P1-03.md` first. If P1-04 has gaps, verify it manually against its acceptance criteria before continuing.

---

## 3. Prompt Dependency Map

| Prompt | Build Order | Depends On | Deliverable |
|---|---|---|---|
| P1-05 | 4 | P1-03 | Persons API: CRUD for person records and profile management |
| P1-06 | 4 | P1-05 | Family Groups and Households API: create/read/update family groups, households, memberships |
| P1-07 | 4 | P1-06 | Relationships API: create with auto-reciprocal, read graph, delete both directions |
| P1-08 | 6 | P1-07 | Event Hub API: events CRUD, invitations, RSVP management, potluck assignments |
| P1-09 | 7 | P1-08 | Shared Calendar API: calendar views, in-memory birthday generation, upcoming events digest |
| P1-10 | 5 | P1-04 and P1-08 | Invitation Service: Resend email, Twilio SMS, RSVP link generation with guest tokens |
| P1-11 | 8 | P1-10 | Notification Service: unified dispatcher, Resend + Twilio + FCM, preference enforcement |
| P1-12 | 11 | P1-03, P1-06, P1-10 | Frontend: Auth + Onboarding UI — sign up, create family, invite first members |

---

## 4. Prompts

---

### Prompt P1-05 — Persons API

| Field | Value |
|---|---|
| Prompt ID | P1-05 |
| Build Order | Build Order 4 |
| Depends On | P1-03 complete and committed |
| Objective | Create the authenticated CRUD endpoints for person records, including profile reads and updates. Persons can be created for family members who do not have Clerk accounts. |

#### Context for Cursor

We are working in `apps/api/src/routes/`. All routes require authentication via `requireAuth` middleware (ADR-05). The Person model in Prisma includes `ageGateLevel` and `guardianPersonId` (ADR v0.3). A person with `userId = null` is a family member without an account (child, guest, or Reluctant Member). The authenticated user can only read/write persons within family groups they belong to.

#### Cursor Prompt

```
Create apps/api/src/routes/persons.ts

Define Zod schemas:
  CreatePersonSchema:
    firstName:        string, min 1
    lastName:         string, min 1
    preferredName:    string optional
    dateOfBirth:      string optional (ISO date YYYY-MM-DD)
    ageGateLevel:     enum ["NONE", "YOUNG_ADULT", "MINOR"], default "NONE"
    guardianPersonId: string optional (cuid)
    profilePhotoUrl:  string optional (url)

  UpdatePersonSchema: CreatePersonSchema.partial()

Endpoints (all require requireAuth):

  GET /api/v1/persons/me
    - Get the current user's Person record using userId from auth
    - If no Person record exists for this Clerk userId: return 404
      { error: "Person record not found — complete onboarding" }
    - Returns: Person record

  GET /api/v1/persons/:personId
    - Fetch a person by ID
    - Authorization: requester must share at least one family group
      with the requested person. If not: return 403.
    - Returns: Person record (omit guardianPersonId unless requester
      is the guardian or an admin of the family)

  POST /api/v1/persons
    - Create a new Person record for a family member without an account
      (e.g., adding a child, or adding Uncle Dave before he joins)
    - userId is NOT set — this creates an account-less person record
    - Body: CreatePersonSchema
    - Returns 201: created Person record

  PUT /api/v1/persons/:personId
    - Update a person's profile
    - Authorization: requester must be the person themselves (userId
      match) OR an admin of a shared family group
    - Body: UpdatePersonSchema
    - Returns: updated Person record

  GET /api/v1/persons/me/families
    - Get all family groups the current user belongs to
    - Returns: array of { familyGroup, role, joinedAt }

Add to apps/api/src/routes/index.ts:
  router.use('/api/v1/persons', requireAuth, personsRouter)

IMPORTANT: Route ordering in persons.ts — register GET /me and
GET /me/families BEFORE GET /:personId to prevent Express from
treating "me" as a personId parameter.

Do NOT run npm install. Generate files only.
```

#### Acceptance Criteria

- [ ] `GET /api/v1/persons/me` returns 404 with a helpful message if no Person record exists (new user before onboarding)
- [ ] `GET /api/v1/persons/:id` returns 403 if requester shares no family group with the requested person
- [ ] `POST /api/v1/persons` creates a Person with `userId: null` — does not use the requester's Clerk userId
- [ ] `PUT /api/v1/persons/:id` enforces authorization — only self or family admin can update
- [ ] All bodies validated with Zod — invalid input returns 400 with a descriptive error
- [ ] `ageGateLevel` field uses the string enum values from ADR v0.3: `NONE`, `YOUNG_ADULT`, `MINOR`
- [ ] `GET /me` and `GET /me/families` are registered before `GET /:personId` in the router
- [ ] All routes are mounted under `requireAuth` — no unauthenticated access
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P1-05**
> Paste `routes/persons.ts` into Claude with: "Review P1-05 against ADR v0.3. Check: (1) GET /me returns 404 not 500 for missing Person records, (2) authorization checks prevent cross-family data access, (3) ageGateLevel uses correct enum string values, (4) creating a person without userId correctly supports the Reluctant Member and minor profile patterns from ADR-05, (5) /me routes are ordered before /:personId to prevent routing conflict."

---

### Prompt P1-06 — Family Groups and Households API

| Field | Value |
|---|---|
| Prompt ID | P1-06 |
| Build Order | Build Order 4 |
| Depends On | P1-05 complete and committed |
| Objective | Create CRUD endpoints for family groups, households, and their memberships. The family group is the top-level container for all FamLink data. |

#### Context for Cursor

We are working in `apps/api/src/routes/`. All routes require `requireAuth`. A `FamilyGroup` is the extended family container. A `Household` is a physical living unit within a family group. When a user creates a family group, they are automatically added as a `FamilyMember` with roles `ADMIN` and `ORGANIZER`. The Prisma models are `FamilyGroup`, `FamilyMember`, `Household`, and `HouseholdMember`.

#### Cursor Prompt

```
Create apps/api/src/routes/families.ts

Define Zod schemas:
  CreateFamilySchema:
    name: string, min 2, max 100

  UpdateFamilySchema:
    name:               string optional
    aiEnabled:          boolean optional
    defaultVisibility:  enum ["PRIVATE","HOUSEHOLD","FAMILY","INVITED","GUEST"] optional

  CreateHouseholdSchema:
    name:    string, min 1
    street:  string optional
    city:    string optional
    state:   string optional
    zip:     string optional
    country: string optional, default "US"

  UpdateHouseholdSchema: CreateHouseholdSchema.partial()

  AddMemberSchema:
    personId:    string (cuid)
    roles:       array of string, min 1 (e.g. ["MEMBER"])
    permissions: array of string, default []

  AddHouseholdMemberSchema:
    personId: string (cuid)
    role:     string optional (e.g. "HEAD_OF_HOUSEHOLD", "DEPENDENT")

Family Group Endpoints:

  POST /api/v1/families
    - Get the requester's Person record (by Clerk userId)
    - If not found: 400 { error: "Complete onboarding before creating a family" }
    - Create FamilyGroup with createdById = person.id
    - Automatically create a FamilyMember record for the creator:
        roles: ["ADMIN", "ORGANIZER"]
        permissions: ["VIEW_EVENTS", "CREATE_EVENTS", "INVITE_MEMBERS",
                      "MANAGE_MEMBERS", "MANAGE_SETTINGS"]
    - Returns 201: { familyGroup, membership }

  GET /api/v1/families/:familyId
    - Authorization: requester must be a FamilyMember of this family
    - Returns: { familyGroup, members: [{ person, roles, joinedAt }],
                 households: [{ household, members: [person] }] }

  PUT /api/v1/families/:familyId
    - Authorization: requester must have ADMIN role in this family
    - Body: UpdateFamilySchema
    - Returns: updated FamilyGroup

  POST /api/v1/families/:familyId/members
    - Authorization: requester must have INVITE_MEMBERS permission
    - Body: AddMemberSchema
    - The personId must already exist as a Person record
    - Create FamilyMember record
    - Returns 201: FamilyMember record

  DELETE /api/v1/families/:familyId/members/:personId
    - Authorization: requester must be ADMIN or be removing themselves
    - Cannot remove the last ADMIN — return 400 if this would leave
      the family with zero ADMINs
    - Delete FamilyMember record
    - Returns 204

Household Endpoints:

  POST /api/v1/families/:familyId/households
    - Authorization: requester must be a FamilyMember with CREATE_EVENTS
      permission (or ADMIN)
    - Body: CreateHouseholdSchema
    - Returns 201: Household record

  PUT /api/v1/households/:householdId
    - Authorization: requester must be ADMIN of the household's family
    - Body: UpdateHouseholdSchema
    - Returns: updated Household

  POST /api/v1/households/:householdId/members
    - Authorization: requester must be ADMIN of the household's family
    - Body: AddHouseholdMemberSchema
    - The personId must already be a FamilyMember of the parent family
    - Create HouseholdMember record
    - Returns 201: HouseholdMember record

  DELETE /api/v1/households/:householdId/members/:personId
    - Authorization: requester must be ADMIN or the member themselves
    - Delete HouseholdMember record
    - Returns 204

Add to apps/api/src/routes/index.ts:
  router.use('/api/v1/families',   requireAuth, familiesRouter)
  router.use('/api/v1/households', requireAuth, householdsRouter)

Do NOT run npm install. Generate files only.
```

#### Acceptance Criteria

- [ ] `POST /api/v1/families` automatically creates the creator as `ADMIN` + `ORGANIZER` `FamilyMember`
- [ ] `POST /api/v1/families` returns 400 (not 500) if the requester has no Person record
- [ ] `GET /api/v1/families/:id` returns 403 if requester is not a family member
- [ ] `DELETE /api/v1/families/:familyId/members/:personId` prevents removing the last ADMIN — returns 400
- [ ] `POST /api/v1/households/:id/members` validates that `personId` is already a `FamilyMember` of the parent family
- [ ] All permission checks use the roles/permissions stored on `FamilyMember` — no hardcoded user IDs
- [ ] All Zod schemas validate inputs and return 400 with descriptive errors on failure
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P1-06**
> Paste `routes/families.ts` into Claude with: "Review P1-06 against ADR v0.3. Check: (1) family creator is correctly bootstrapped as ADMIN+ORGANIZER, (2) authorization checks are consistent across all endpoints, (3) the last-admin guard is present on member removal, (4) household member addition validates family membership, (5) no N+1 query patterns on the GET family endpoint."

---

### Prompt P1-07 — Relationships API

| Field | Value |
|---|---|
| Prompt ID | P1-07 |
| Build Order | Build Order 4 |
| Depends On | P1-06 complete and committed |
| Objective | Create the relationships API that manages edges in the family graph. Creating a relationship automatically creates its reciprocal. Deleting removes both directions. |

#### Context for Cursor

We are working in `apps/api/src/routes/`. The family relationship graph uses directed edges stored in the `Relationship` table (ADR-04). Reciprocal mapping is available from `packages/db/src/relationship-helpers.ts` (`RECIPROCAL_TYPES`). Both directions of a relationship must be maintained. All persons in a relationship must be members of the specified `familyGroupId`.

#### Cursor Prompt

```
Create apps/api/src/routes/relationships.ts

Import RECIPROCAL_TYPES from @famlink/db.

Define Zod schemas:
  CreateRelationshipSchema:
    fromPersonId: string (cuid)
    toPersonId:   string (cuid)
    type:         enum of all 19 RelationshipType values:
                  SPOUSE, PARTNER, EX_SPOUSE, PARENT, CHILD,
                  STEP_PARENT, STEP_CHILD, ADOPTIVE_PARENT, ADOPTIVE_CHILD,
                  SIBLING, HALF_SIBLING, STEP_SIBLING, GRANDPARENT,
                  GRANDCHILD, AUNT_UNCLE, NIECE_NEPHEW, COUSIN,
                  CAREGIVER, GUARDIAN, FAMILY_FRIEND
    notes:        string optional

Endpoints (all require requireAuth):

  POST /api/v1/families/:familyId/relationships
    - Authorization: requester must be a FamilyMember of this family
    - Validate: fromPersonId and toPersonId are both FamilyMembers of
      this family. If not: 400 { error: "Both persons must be family members" }
    - Validate: fromPersonId !== toPersonId. If same: 400.
    - Create the primary relationship:
        { fromPersonId, toPersonId, type, familyGroupId, notes }
    - Look up reciprocalType = RECIPROCAL_TYPES[type]
    - If reciprocalType is not null:
        Create the reciprocal relationship:
        { fromPersonId: toPersonId, toPersonId: fromPersonId,
          type: reciprocalType, familyGroupId, notes }
    - Use a Prisma transaction to create both atomically.
    - If @@unique constraint violation: 409 { error: "Relationship already exists" }
    - Returns 201: { relationship, reciprocal: relationship | null }

  GET /api/v1/families/:familyId/relationships
    - Authorization: requester must be a FamilyMember
    - Returns: all relationships in this family group with person
      details for fromPerson and toPerson
    - Useful for rendering the full family graph

  GET /api/v1/persons/:personId/relationships
    - Authorization: requester must share a family group with personId
    - Returns: all relationships where fromPersonId = personId,
      including the related person's name and ageGateLevel

  DELETE /api/v1/relationships/:relationshipId
    - Authorization: requester must be a FamilyMember of the
      relationship's family group
    - Find the relationship by ID
    - Find the reciprocal:
        where: { fromPersonId: rel.toPersonId, toPersonId: rel.fromPersonId,
                 familyGroupId: rel.familyGroupId }
    - Delete both in a Prisma transaction
    - Returns 204

Add to apps/api/src/routes/index.ts:
  router.use('/api/v1/families',      requireAuth, familiesRouter)
  router.use('/api/v1/persons',       requireAuth, personsRouter)
  router.use('/api/v1/relationships', requireAuth, relationshipsRouter)

Do NOT run npm install. Generate files only.
```

#### Acceptance Criteria

- [ ] `POST` creates both the primary and reciprocal relationship in a single Prisma transaction
- [ ] `CAREGIVER` and `GUARDIAN` relationships create no reciprocal (`RECIPROCAL_TYPES` maps them to null)
- [ ] `POST` returns 400 if either person is not a member of the family group
- [ ] `POST` returns 409 on duplicate relationship (@@unique violation), not 500
- [ ] `DELETE` removes both directions in a single Prisma transaction
- [ ] `GET /families/:id/relationships` includes `fromPerson` and `toPerson` details — not just IDs
- [ ] All 19 `RelationshipType` values are in the Zod enum — verify `FAMILY_FRIEND` is included
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P1-07**
> Paste `routes/relationships.ts` into Claude with: "Review P1-07 against ADR v0.3 ADR-04 relationship type registry. Check: (1) both directions created atomically in a transaction, (2) CAREGIVER and GUARDIAN correctly produce no reciprocal, (3) duplicate detection returns 409 not 500, (4) DELETE removes both directions atomically, (5) all 19 relationship types are present in the Zod schema."

---

### Prompt P1-08 — Event Hub API

| Field | Value |
|---|---|
| Prompt ID | P1-08 |
| Build Order | Build Order 6 |
| Depends On | P1-07 complete and committed |
| Objective | Create the complete Event Hub API: event CRUD, event invitations, RSVP management, and potluck assignments. The guest RSVP endpoint was already built in P1-04; this prompt handles authenticated event and RSVP endpoints. |

#### Context for Cursor

We are working in `apps/api/src/routes/`. Events belong to a `FamilyGroup`. RSVPs support both authenticated users and guests (via `guestToken` from P1-04). The invitation flow must generate guest tokens for persons without `userId` (Reluctant Members, minors) so they can RSVP via a link. All dates are stored as UTC ISO strings.

#### Cursor Prompt

```
Create apps/api/src/routes/events.ts

Define Zod schemas:
  CreateEventSchema:
    title:           string, min 1, max 200
    description:     string optional
    startAt:         string (ISO datetime)
    endAt:           string optional (ISO datetime)
    locationName:    string optional
    locationAddress: string optional
    locationMapUrl:  string optional (url)
    visibility:      enum ["PRIVATE","HOUSEHOLD","FAMILY","INVITED","GUEST"],
                     default "FAMILY"
    isRecurring:     boolean, default false

  UpdateEventSchema: CreateEventSchema.partial()

  SendInvitationsSchema:
    scope:        enum ["INDIVIDUAL","HOUSEHOLD","FAMILY"]
    personIds:    array of string (cuid), optional (scope=INDIVIDUAL)
    householdIds: array of string (cuid), optional (scope=HOUSEHOLD)

  UpdateRsvpSchema:
    status: enum ["YES","NO","MAYBE"]

  PotluckItemSchema:
    item:     string, min 1
    quantity: number optional, int, min 1
    notes:    string optional
    personId: string optional (cuid) — null means unassigned

Endpoints (all require requireAuth):

  POST /api/v1/families/:familyId/events
    - Authorization: requester must be a FamilyMember with CREATE_EVENTS
      permission or ADMIN role
    - Create Event with createdByPersonId = requester's Person.id
    - Returns 201: Event record

  GET /api/v1/events/:eventId
    - Authorization: requester must be a FamilyMember of the event's family group
    - Returns: { event, invitations: count, rsvps: { YES, NO, MAYBE, PENDING },
      potluckAssignments }

  PUT /api/v1/events/:eventId
    - Authorization: requester must be the event creator or family ADMIN
    - Body: UpdateEventSchema
    - Returns: updated Event

  DELETE /api/v1/events/:eventId
    - Authorization: requester must be the event creator or family ADMIN
    - Hard delete with cascade (MVP)
    - Returns 204

  POST /api/v1/events/:eventId/invitations
    - Authorization: requester must be a FamilyMember with INVITE_MEMBERS permission
    - Body: SendInvitationsSchema
    - For scope FAMILY: create EventInvitation records for all FamilyMembers;
      create RSVP records with status PENDING for each person
    - For scope HOUSEHOLD: create invitations for members of specified households
    - For scope INDIVIDUAL: create invitations for specified personIds
    - For each invited Person without a userId: generate a guestToken using
      generateGuestToken() with scope "RSVP", resourceType "EVENT", expiresIn "48h"
      Attach the token to their RSVP record (rsvps.guestToken)
    - Returns 201: { invited: count, guestTokensGenerated: count }

  GET /api/v1/events/:eventId/rsvps
    - Authorization: FamilyMember of the event's family
    - Returns: { rsvps grouped by status, each with person firstName,
      lastName, and a hasGuestToken boolean — do NOT expose the raw token string }

  PUT /api/v1/events/:eventId/rsvp  (authenticated RSVP)
    - Authorization: requireAuth
    - Body: UpdateRsvpSchema
    - Upsert RSVP for requester's Person
    - Returns: updated RSVP

  POST /api/v1/events/:eventId/potluck
    - Authorization: event creator or family ADMIN
    - Body: array of PotluckItemSchema
    - Replace all potluck assignments atomically:
        Prisma transaction: deleteMany existing, then createMany new
    - Returns: array of PotluckAssignment records

Add to apps/api/src/routes/index.ts:
  router.use('/api/v1/families', requireAuth, familiesRouter)
  router.use('/api/v1/events',   requireAuth, eventsRouter)

Import generateGuestToken from ../lib/guestToken

Do NOT run npm install. Generate files only.
```

#### Acceptance Criteria

- [ ] `POST /api/v1/events/:id/invitations` generates `guestToken`s for persons without `userId` — tokens stored on `rsvps.guestToken`
- [ ] Guest tokens use scope `'RSVP'`, resourceType `'EVENT'`, `expiresIn '48h'`
- [ ] `GET /api/v1/events/:id` returns RSVP counts by status — not raw RSVP records with personal data
- [ ] `GET /api/v1/events/:id/rsvps` returns `hasGuestToken` boolean — does NOT expose the raw token string
- [ ] `PUT /api/v1/events/:id/rsvp` is an upsert — a person can change their RSVP
- [ ] Event creation stores `createdByPersonId` as `Person.id` — not the Clerk `userId`
- [ ] Potluck replacement is atomic (deleteMany + createMany in a single transaction)
- [ ] All Zod schemas return 400 with descriptive messages on invalid input
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P1-08**
> Paste `routes/events.ts` into Claude with: "Review P1-08 against ADR v0.3 and PRD Module 2. Check: (1) invitation flow generates guest tokens for userId-null persons, (2) RSVP upsert is idempotent, (3) GET event RSVP list exposes counts and a boolean — not raw personal data or raw token strings, (4) potluck replacement is atomic, (5) authorization is enforced on all write endpoints."

---

### Prompt P1-09 — Shared Calendar API

| Field | Value |
|---|---|
| Prompt ID | P1-09 |
| Build Order | Build Order 7 |
| Depends On | P1-08 complete and committed |
| Objective | Create the calendar API endpoints: monthly queries, upcoming events, and automatic birthday event generation from family member birth dates. Birthday events are never stored in the database. |

#### Context for Cursor

We are working in `apps/api/src/routes/` and `apps/api/src/lib/`. The calendar aggregates events across the family graph. Birthday events are NOT stored in the database — they are generated on-the-fly from `Person.dateOfBirth` values and returned as synthetic event objects with `isBirthdayEvent: true`. All datetimes are UTC. The `/calendar/upcoming` endpoint is the primary feed for the Grandparent persona's weekly digest (PRD Module 3).

#### Cursor Prompt

```
Create apps/api/src/routes/calendar.ts
Create apps/api/src/lib/birthdayGenerator.ts

--- birthdayGenerator.ts ---

Export interface SyntheticBirthdayEvent:
  id:               string   // "birthday-{personId}-{year}"
  title:            string   // "{firstName}'s Birthday"
  startAt:          string   // ISO datetime: DOB month/day in given year, 00:00:00 UTC
  endAt:            string   // same day, 23:59:59 UTC
  isBirthdayEvent:  true
  birthdayPersonId: string
  visibility:       "FAMILY"
  familyGroupId:    string

Export function generateBirthdayEvents(
  persons: Array<{ id: string, firstName: string, lastName: string,
                   dateOfBirth: string | null }>,
  year: number,
  familyGroupId: string
): SyntheticBirthdayEvent[]

Implementation:
  - Iterate persons with non-null dateOfBirth
  - For each, extract month and day from DOB string (YYYY-MM-DD)
  - Set the event date to that month/day in the requested year
  - Feb 29 in non-leap years: use Feb 28 instead
  - Return one SyntheticBirthdayEvent per qualifying person

--- calendar.ts ---

Endpoints (all require requireAuth):

  GET /api/v1/families/:familyId/calendar
    Query params:
      month: string YYYY-MM (required)
    - Authorization: FamilyMember of this family
    - Compute startOfMonth, endOfMonth from the month param (UTC)
    - Fetch all Events where familyGroupId = familyId
      AND startAt >= startOfMonth AND startAt < endOfMonth
    - Get all FamilyMembers with their Person records (for birthdays)
    - Generate birthday events for this month using birthdayGenerator
    - Merge real events and birthday events
    - Sort by startAt ascending
    - Returns: { month, events: [...real events, ...birthday events] }

  GET /api/v1/families/:familyId/calendar/upcoming
    Query params:
      days: number, default 30, max 90 (clamp if over 90)
    - Authorization: FamilyMember
    - Fetch events from now to now + days (UTC)
    - Generate birthday events for the relevant month range
    - Merge, deduplicate by id, sort by startAt
    - Returns: { events, generatedAt: ISO timestamp }
    - Primary use: weekly digest emails (Grandparent persona)

  GET /api/v1/families/:familyId/calendar/birthdays
    - Authorization: FamilyMember
    - Get all FamilyMembers with non-null dateOfBirth
    - For each, compute nextBirthday (next occurrence from today, UTC)
    - Compute daysUntilBirthday (0 = today, negative = already passed this year)
    - Return sorted by daysUntilBirthday ascending (soonest first)
    - Returns: { birthdays: [{ person, nextBirthday, daysUntilBirthday }] }

Calendar routes are nested under /api/v1/families/:familyId/calendar.
Mount after the families router is already registered in routes/index.ts.

Do NOT run npm install. Generate files only.
```

#### Acceptance Criteria

- [ ] Birthday events are generated in-memory — no birthday events are written to the database
- [ ] Synthetic birthday event IDs follow the pattern `'birthday-{personId}-{year}'` — deterministic and stable
- [ ] Feb 29 birthdays are correctly handled in non-leap years (use Feb 28 instead)
- [ ] `GET /calendar` merges and sorts real events and birthday events by `startAt` ascending
- [ ] `GET /calendar/upcoming` correctly clamps the `days` limit to a maximum of 90
- [ ] `GET /calendar/upcoming` deduplicates events by `id` before sorting
- [ ] `GET /calendar/birthdays` includes `daysUntilBirthday` calculated relative to today (UTC)
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P1-09**
> Paste `routes/calendar.ts` and `lib/birthdayGenerator.ts` into Claude with: "Review P1-09 against ADR v0.3 and PRD Module 3. Check: (1) birthday events are never written to DB, (2) Feb 29 leap year handling is correct, (3) GET /calendar/upcoming clamps days to 90, (4) GET /calendar/birthdays correctly sorts by next upcoming occurrence relative to today UTC, (5) deduplication is applied before sorting in /upcoming."

---

### Prompt P1-10 — Invitation Service

| Field | Value |
|---|---|
| Prompt ID | P1-10 |
| Build Order | Build Order 5 |
| Depends On | P1-04 and P1-08 complete and committed |
| Objective | Build the invitation delivery service: Resend for email, Twilio for SMS, RSVP link generation with guest tokens. |

#### Context for Cursor

We are working in `apps/api/src/lib/`. The invitation service sends event invitations to family members via email (Resend) and SMS (Twilio) per ADR-07. Resend is the email provider — **NOT SendGrid** (SendGrid was replaced in ADR v0.3). The RSVP link format is `{WEB_APP_URL}/rsvp?token={guestToken}`. Authenticated users get a direct link to the event page; guests get the token-bearing RSVP link.

#### Cursor Prompt

```
Install (if not already present): resend, twilio in apps/api

Create apps/api/src/lib/invitationService.ts

Define types:

  InvitationRecipient:
    personId:   string
    firstName:  string
    email:      string | null
    phone:      string | null
    guestToken: string | null  // present for userId-null persons
    isGuest:    boolean        // true if userId is null

  EventInvitationPayload:
    eventId:    string
    event: {
      title:        string
      startAt:      string
      locationName: string | null
    }
    familyName:  string
    inviterName: string
    recipients:  InvitationRecipient[]

Export class InvitationService:

  constructor: initializes Resend client and Twilio client from env

  async sendEventInvitations(payload: EventInvitationPayload):
    Promise<{ emailsSent: number, smsSent: number, errors: string[] }>

    For each recipient:
      If email is present:
        Send email via Resend:
          from: "FamLink <invites@{your-resend-domain}>"
          to: recipient.email
          subject: "You're invited: {event.title}"
          html: buildEventInviteEmail(recipient, payload)
      If phone is present AND isGuest is true:
        Send SMS via Twilio:
          from: TWILIO_PHONE_NUMBER
          to: recipient.phone
          body: buildEventInviteSms(recipient, payload)
      Collect errors — do not throw — return partial success

  private buildEventInviteEmail(recipient, payload): string
    Returns an HTML string with:
      - Event title, date/time (formatted human-readable), location
      - If guestToken present: "RSVP Now" button linking to
        {WEB_APP_URL}/rsvp?token={guestToken}
      - If no guestToken: link to {WEB_APP_URL}/events/{eventId}
      - FamLink branding (simple, clean HTML — no external CSS frameworks)

  private buildEventInviteSms(recipient, payload): string
    Returns a string max 160 characters:
      "{inviterName} invited you to {event.title} on {date}.
       RSVP: {WEB_APP_URL}/rsvp?token={guestToken}"
    If over 160 chars: truncate event.title to fit.

Create apps/api/src/lib/familyInvitationService.ts

Export async function sendFamilyJoinInvitation(params: {
  inviterName:        string
  familyName:         string
  recipientEmail:     string | null
  recipientPhone:     string | null
  recipientFirstName: string
  guestToken:         string  // scope: JOIN, resourceType: FAMILY, expiresIn: "7d"
}): Promise<void>

  - Send email (if email present) via Resend:
      Subject: "{inviterName} invited you to join {familyName} on FamLink"
      Body: Explain FamLink briefly; include join link:
        {WEB_APP_URL}/join?token={guestToken}
  - Send SMS (if phone present) via Twilio:
      "{inviterName} invited you to join {familyName} on FamLink.
       Accept: {WEB_APP_URL}/join?token={guestToken}"

Do NOT hardcode any domain, URL, or phone number — all from env.
Do NOT run npm install unless packages are genuinely missing.
```

#### Acceptance Criteria

- [ ] Resend client uses `RESEND_API_KEY` from env — not SendGrid, no other email provider
- [ ] Twilio client uses `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` from env
- [ ] `sendEventInvitations` returns partial success — a single delivery failure does not throw
- [ ] RSVP link uses `WEB_APP_URL` from env — not hardcoded localhost or domain
- [ ] SMS body is max 160 characters — event title truncated to fit if necessary
- [ ] Email HTML is self-contained — no external CDN or framework dependencies
- [ ] Family join invitation uses 7-day token expiry (not 48h)
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P1-10**
> Paste `lib/invitationService.ts` and `lib/familyInvitationService.ts` into Claude with: "Review P1-10 against ADR v0.3 ADR-07. Check: (1) Resend is used — not SendGrid, (2) partial failure handling is correct — one bad email does not abort all others, (3) SMS is 160 char max, (4) RSVP link construction uses WEB_APP_URL from env, (5) family join token correctly uses 7-day expiry per ADR-05."

---

### Prompt P1-11 — Notification Service

| Field | Value |
|---|---|
| Prompt ID | P1-11 |
| Build Order | Build Order 8 |
| Depends On | P1-10 complete and committed |
| Objective | Build the unified notification service that dispatches all notification types across Resend (email), Twilio (SMS), and Firebase Cloud Messaging (push). Enforces per-user channel preferences. |

#### Context for Cursor

We are working in `apps/api/src/lib/`. The notification service is a unified dispatcher (ADR-07). It handles all non-invitation notifications: RSVP received, event reminders, birthday reminders, weekly digest. It reads `NotificationPreference` records to determine which channels are enabled per user. Resend handles email, Twilio handles SMS, Firebase Admin SDK handles push.

#### Cursor Prompt

```
Install firebase-admin in apps/api.

Add to apps/api/src/lib/env.ts:
  FIREBASE_PROJECT_ID:   string
  FIREBASE_CLIENT_EMAIL: string
  FIREBASE_PRIVATE_KEY:  string  (full PEM key from service account JSON)

Create apps/api/src/lib/notificationService.ts

Define types:

  NotificationPayload:
    type:              "EVENT_INVITE" | "RSVP_RECEIVED" | "EVENT_REMINDER" |
                       "BIRTHDAY_REMINDER" | "FAMILY_JOIN" | "WEEKLY_DIGEST"
    recipientPersonId: string
    title:             string
    body:              string
    data?:             Record<string, string>  // extra data for push payloads
    emailHtml?:        string                  // rich HTML for email channel

  DeliveryResult:
    channel:  "EMAIL" | "SMS" | "PUSH"
    success:  boolean
    error?:   string

Initialize Firebase Admin SDK at module load:
  Use admin.initializeApp() with credential from service account env vars.
  Guard against re-initialization: check admin.apps.length before calling initializeApp.

Export class NotificationService:

  constructor: initializes Resend, Twilio, Firebase Admin from env

  async send(payload: NotificationPayload): Promise<DeliveryResult[]>
    Steps:
    1. Fetch the recipient Person record from DB
    2. Fetch NotificationPreference records for this person and type
    3. For each channel (EMAIL, SMS, PUSH):
         If NotificationPreference record exists for this channel + type:
           Use its enabled flag
         If no preference record — use channel defaults:
           EMAIL: enabled by default for all users
           SMS:   enabled only for userId-null persons (Reluctant Members)
           PUSH:  enabled only if person has a registered FCM token
    4. Attempt delivery on each enabled channel
    5. Collect DeliveryResult for each attempted channel
    6. Return all results — do not throw on partial failure

  private async sendEmail(to: string, title: string,
    body: string, html?: string): Promise<boolean>
    Send via Resend. from: "FamLink <notifications@{resend-domain}>"

  private async sendSms(to: string, body: string): Promise<boolean>
    Send via Twilio. Truncate body to 160 chars.

  private async sendPush(fcmToken: string, title: string,
    body: string, data?: Record<string, string>): Promise<boolean>
    Send via Firebase Admin messaging.send():
      { token: fcmToken, notification: { title, body }, data }

  async scheduleEventReminder(eventId: string, minutesBefore: number):
    Promise<void>
    - Fetch event and all confirmed RSVPs (status = YES)
    - For each confirmed person: send notification of type EVENT_REMINDER
    - MVP: called directly. Cron scheduling deferred to Phase 2.

  async sendWeeklyDigest(familyGroupId: string): Promise<void>
    - Fetch upcoming events for the next 7 days
    - Fetch birthdays in the next 7 days (use birthdayGenerator from P1-09)
    - For each FamilyMember: send WEEKLY_DIGEST notification via email
    - MVP: called directly. Scheduling deferred to Phase 2.

Do NOT hardcode any domain, API key, or credential.
Do NOT run npm install unless firebase-admin is genuinely missing.
```

#### Acceptance Criteria

- [ ] Firebase Admin SDK is initialized once — re-initialization guard (`admin.apps.length` check) is present
- [ ] `FIREBASE_PRIVATE_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` added to `env.ts` validation
- [ ] `send()` fetches `NotificationPreference` records before dispatching — preferences are enforced
- [ ] Default channel behavior: EMAIL on by default; SMS only for `userId`-null persons; PUSH only if FCM token present
- [ ] `send()` returns `DeliveryResult[]` — partial failure does not throw
- [ ] `sendSms()` truncates to 160 characters
- [ ] `scheduleEventReminder` only sends to confirmed attendees (status = `YES`)
- [ ] `sendWeeklyDigest` uses `birthdayGenerator` from P1-09 for upcoming birthdays
- [ ] `tsc --noEmit` passes with zero errors

> **Claude Review Prompt — P1-11**
> Paste `lib/notificationService.ts` into Claude with: "Review P1-11 against ADR v0.3 ADR-07. Check: (1) all three channels are present: Resend, Twilio, FCM, (2) NotificationPreference enforcement is correct with correct defaults, (3) Firebase re-initialization guard is present, (4) SMS defaults to userId-null persons only, (5) no SendGrid code present anywhere."

---

### Prompt P1-12 — Frontend: Auth & Onboarding UI

| Field | Value |
|---|---|
| Prompt ID | P1-12 |
| Build Order | Build Order 11 |
| Depends On | P1-03, P1-06, and P1-10 complete and committed |
| Objective | Build the Next.js onboarding flow: the first-run experience after sign-up where the Organizer creates their family group, creates their first household, and invites initial family members. |

#### Context for Cursor

We are working in `apps/web/`. The Organizer persona is the primary user of this flow. After signing up via Clerk (P1-02), a new user is redirected to `/onboarding`. They must: (1) create their Person profile, (2) create a FamilyGroup, (3) create a Household, (4) invite first members. Styling uses Tailwind CSS and shadcn/ui components. State is managed with React `useState` — no external state management needed. API calls go to the Express API at `NEXT_PUBLIC_API_URL`.

#### Cursor Prompt

```
Add to apps/web/.env.example:
  NEXT_PUBLIC_API_URL=http://localhost:3001

Create apps/web/lib/api.ts:
  A typed API client for making authenticated requests to apps/api.

  Export async function apiFetch<T>(
    path: string,
    options?: RequestInit
  ): Promise<T>

  Implementation:
    - Base URL from process.env.NEXT_PUBLIC_API_URL
    - For server components: use await auth() from @clerk/nextjs/server
      to get a token, attach as Authorization: Bearer {token}
    - Content-Type: application/json
    - Throw descriptive errors on non-2xx responses (include status
      code and response body in error message)

Create the onboarding flow at apps/web/app/onboarding/:

  page.tsx — Onboarding coordinator (client component)
    - Check if user already has a family: GET /api/v1/persons/me/families
    - If families exist: redirect to /dashboard
    - Renders a 4-step wizard with progress indicator ("Step 2 of 4"):
        Step 1: Your Profile
        Step 2: Create Your Family
        Step 3: Your Household
        Step 4: Invite Family Members
    - Use useState to track currentStep and accumulated form data

  steps/ProfileStep.tsx (client component)
    Fields: firstName (required), lastName (required),
            preferredName (optional), dateOfBirth (optional)
    On submit: POST /api/v1/persons with the profile data
    On success: advance to Step 2

  steps/FamilyStep.tsx (client component)
    Fields: familyName (required, e.g., "The Johnson Family")
    Hint text: "This is the name your family will see when they join."
    On submit: POST /api/v1/families { name: familyName }
    On success: store familyGroupId in state; advance to Step 3

  steps/HouseholdStep.tsx (client component)
    Fields: householdName (required, e.g., "Sarah & Tom's House"),
            city (optional), state (optional)
    On submit: POST /api/v1/families/{familyGroupId}/households
    On success: advance to Step 4

  steps/InviteStep.tsx (client component)
    - Allow adding up to 10 initial invitees
    - Each invitee: firstName (required), email (optional), phone (optional)
    - At least one of email or phone required per invitee
    - "Add another person" button
    - "Skip for now" option — goes to /dashboard without inviting
    - On submit (if invitees present):
        For each invitee:
          POST /api/v1/persons { firstName, lastName: "", ageGateLevel: "NONE" }
          POST /api/v1/families/{familyGroupId}/members { personId, roles: ["MEMBER"] }
        Show confirmation summary; redirect to /dashboard
    - On "Skip": redirect to /dashboard immediately

  All steps:
    - Use shadcn/ui components: Input, Button, Label, Card
    - Show loading state on submit (button disabled while in-flight)
    - Show inline validation errors
    - Be responsive (mobile-friendly)

Update apps/web/app/dashboard/page.tsx:
  Replace placeholder with:
  - "Welcome, {firstName}!" heading (from GET /api/v1/persons/me)
  - Upcoming events count (GET /api/v1/families/{id}/calendar/upcoming)
  - Quick links: Create Event, View Calendar, Invite Members
  - If no family yet: redirect to /onboarding

Do NOT hardcode NEXT_PUBLIC_API_URL or any Clerk keys.
Do NOT run npm install. Generate files only.
```

#### Acceptance Criteria

- [ ] `apiFetch` attaches a Clerk Bearer token on every request — no unauthenticated API calls
- [ ] Onboarding page checks for existing families and redirects to `/dashboard` if setup is already complete
- [ ] Step 1 (Profile) calls `POST /api/v1/persons` before advancing — profile must be saved
- [ ] Step 2 (Family) calls `POST /api/v1/families` and stores `familyGroupId` in state for Steps 3 and 4
- [ ] Step 4 (Invite) includes a "Skip for now" button — onboarding can complete without inviting anyone
- [ ] All form fields use shadcn/ui components and show inline validation errors
- [ ] All steps show loading state on submit — button disabled while request is in-flight
- [ ] Dashboard page shows meaningful content — not just a user ID placeholder
- [ ] `NEXT_PUBLIC_API_URL` is from env — not hardcoded
- [ ] `tsc --noEmit` passes with zero errors in `apps/web` context

> **Claude Review Prompt — P1-12**
> Paste `apps/web/app/onboarding/page.tsx` and all step components into Claude with: "Review P1-12 against ADR v0.3 and PRD user journey 7.1 (Organizer Sets Up). Check: (1) apiFetch correctly attaches Clerk token, (2) onboarding redirect logic prevents re-running setup, (3) family creation stores familyGroupId for subsequent steps, (4) invite step is skippable per PRD Reluctant Member requirements, (5) no hardcoded API URLs."

---

## 5. Phase 1 Completion Checklist

Phase 1 is complete when all of the following are true:

- [ ] P1-01: Express API server running; health endpoint returns 200; `age_gate_level` in shared types
- [ ] P1-02: Clerk sign-in and sign-up working in Next.js; middleware protecting authenticated routes
- [ ] P1-03: Clerk JWT validation in Express; `user.created` webhook creating Person records
- [ ] P1-04: Guest token generation and validation working; `POST /api/v1/guest/rsvp` tested with `dev-guest-token-dave`
- [ ] P1-05: Persons API complete; `GET /api/v1/persons/me` returns correct data for signed-in user
- [ ] P1-06: Family groups and households API complete; creator bootstrapped as `ADMIN`+`ORGANIZER`
- [ ] P1-07: Relationships API complete; reciprocal creation verified; `RECIPROCAL_TYPES` applied correctly
- [ ] P1-08: Event Hub API complete; invitations generate guest tokens for `userId`-null persons
- [ ] P1-09: Calendar API complete; birthday events generated in-memory; Feb 29 handling verified
- [ ] P1-10: Invitation service complete; Resend email delivery verified; Twilio SMS verified
- [ ] P1-11: Notification service complete; all three channels tested; preference enforcement working
- [ ] P1-12: Onboarding flow complete; Organizer can sign up, create family, and invite first member end-to-end
- [ ] Zero TypeScript errors across all packages (`turbo type-check` passing)
- [ ] Claude review completed for each prompt before marking complete
- [ ] All prompts committed with Prompt ID in the commit message
- [ ] ADR v0.3 confirmed as governing reference — no ADR deviations introduced

---

## 6. Phase 1 → Phase 2 Handoff

When Phase 1 is complete, Phase 2 begins at Build Orders 9, 10, 12, 13, 14, 15, and 16.

| Build Order | Module | Phase |
|---|---|---|
| 9 | AI Context Assembler | Phase 2 |
| 10 | AI Assistant API | Phase 2 |
| 12 | Frontend — Family Graph UI | Phase 2 |
| 13 | Frontend — Event Hub UI | Phase 2 |
| 14 | Frontend — Calendar UI | Phase 2 |
| 15 | Frontend — AI Assistant UI | Phase 2 |
| 16 | Mobile App (Expo) | Phase 2 |

> **Before Starting Phase 2:** Add this document and ADR v0.3 to the FamLink Claude Project before generating the Phase 2 Cursor Prompt Library. Phase 2 prompts will reference ADR decisions, Phase 0 schema, and Phase 1 API endpoints directly.

---

*FamLink Cursor Prompt Library — Phase 1 Continuation (P1-05 through P1-12) — April 2026 — CONFIDENTIAL*
*All prompts are derived from ADR v0.3 and PRD v0.1. If any conflict exists between this document and ADR v0.3, the ADR governs.*
