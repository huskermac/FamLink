# P2-13: Social Relationship Graph — Design Spec

**Date:** 2026-05-28

---

## Goal

Extend the Relationship model to support full temporal history (start/end dates, end reasons, soft-delete), a cleaned-up 12-type taxonomy, deceased person tracking with family-controlled display, and a deterministic invitee-suggestion query for P2-12.

---

## Architecture

All relationships — family tree and social — share one model with the same lifecycle. No special-cased types for "ex" states; history is encoded via `endDate` + `endReason`. A `forgottenAt` field soft-deletes a record from all UI without destroying the data.

Person gets three deceased-tracking fields: a boolean flag, a date, and a display-mode preference. When a person is marked deceased, the API auto-closes all their active relationships in the same transaction.

---

## Schema Changes

### `Relationship` model

Add fields:

```prisma
startDate   DateTime?
endDate     DateTime?
endReason   String?   // DEATH | DIVORCE | SEPARATION | ESTRANGEMENT | MUTUAL | OTHER
forgottenAt DateTime?
qualifier   String?   // STEP | HALF | ADOPTIVE | FOSTER — admin-only metadata
```

Change the unique constraint (add `type` so a pair can have multiple relationship types):

```prisma
// Before
@@unique([fromPersonId, toPersonId, familyGroupId])

// After
@@unique([fromPersonId, toPersonId, familyGroupId, type])
```

> Note: this constraint still prevents two active SPOUSE records between the same pair in the same group. Remarriage to the same person is not supported — the dates on the existing record should be updated instead. This covers 99.9% of real cases.

### `Person` model

Add fields:

```prisma
isDeceased                    Boolean   @default(false)
dateOfDeath                   DateTime?
deceasedDisplayMode           String?   // MEMORIAL_MARKER | IN_MEMORY_SECTION | ARCHIVED
deceasedShowBirthdayRemembrance Boolean @default(true)
```

---

## Relationship Taxonomy

### Base types (12)

| Type | Reciprocal | Notes |
|------|-----------|-------|
| SPOUSE | SPOUSE | |
| PARTNER | PARTNER | covers boyfriend/girlfriend |
| PARENT | CHILD | |
| SIBLING | SIBLING | |
| GRANDPARENT | GRANDCHILD | |
| AUNT_UNCLE | NIECE_NEPHEW | |
| COUSIN | COUSIN | |
| GUARDIAN | WARD | legal guardian |
| FRIEND | FRIEND | replaces FAMILY_FRIEND |

### Removed types

| Removed | Replacement |
|---------|------------|
| EX_SPOUSE | SPOUSE + endDate + endReason: DIVORCE or SEPARATION |
| STEP_PARENT / STEP_CHILD | PARENT / CHILD + qualifier: STEP |
| STEP_SIBLING | SIBLING + qualifier: STEP |
| HALF_SIBLING | SIBLING + qualifier: HALF |
| ADOPTIVE_PARENT / ADOPTIVE_CHILD | PARENT / CHILD + qualifier: ADOPTIVE |
| FAMILY_FRIEND | FRIEND |

### Qualifier field

Values: `STEP`, `HALF`, `ADOPTIVE`, `FOSTER`. Stored on the relationship row. Hidden from all non-admin UI. When null, the relationship reads as biological/default.

---

## Relationship Lifecycle

Three states, derived from field values:

| State | Condition |
|-------|-----------|
| ACTIVE | `endDate IS NULL` and `forgottenAt IS NULL` |
| ENDED | `endDate IS NOT NULL` and `forgottenAt IS NULL` |
| FORGOTTEN | `forgottenAt IS NOT NULL` (hidden from all UI, retained in DB) |

End reasons: `DEATH`, `DIVORCE`, `SEPARATION`, `ESTRANGEMENT`, `MUTUAL`, `OTHER`

---

## Deceased Person Flow

1. User marks a Person as deceased via profile edit (sets `isDeceased = true`, `dateOfDeath`, `deceasedDisplayMode`, `deceasedShowBirthdayRemembrance`).
2. API transaction: for every ACTIVE relationship where `fromPersonId = personId` OR `toPersonId = personId` and `endDate IS NULL`, set `endDate = dateOfDeath`, `endReason = DEATH`.
3. The reciprocal record gets the same treatment in the same transaction.
4. `deceasedDisplayMode` controls how the person appears across the app:
   - `MEMORIAL_MARKER` — shown in family member list, dimmed with "Passed away [date]" label
   - `IN_MEMORY_SECTION` — shown in a separate "In Memory" section below active members
   - `ARCHIVED` — not shown in any list; profile accessible via direct link/search only
5. Deceased persons are **never** returned by the invitee suggestion query or shown in event invite pickers, regardless of display mode.
6. If `deceasedShowBirthdayRemembrance = true` and the person has a birthday, a "Remembrance" calendar entry is generated on their birthday each year (read-only, not an invitable event).

---

## API Changes

### Updated: `PUT /relationships/:id`

Accept new fields in request body: `startDate`, `endDate`, `endReason`, `forgottenAt`, `qualifier`.  
Validate `endReason` against allowed enum values.  
Validate `qualifier` against allowed enum values; only set if caller is family group admin.

### Updated: `POST /relationships`

Accept `startDate` and `qualifier` in request body (optional).  
Continue auto-creating reciprocal with matching temporal fields.

### New: `PATCH /persons/:id/deceased`

Request body:
```json
{
  "dateOfDeath": "2019-06-03",
  "deceasedDisplayMode": "MEMORIAL_MARKER",
  "deceasedShowBirthdayRemembrance": true
}
```

In one transaction: set Person deceased fields, close all active relationships.

### New: `GET /persons/invitee-suggestions`

Query params: `familyGroupId`, `invitedPersonIds[]`

Returns: all Persons reachable from `invitedPersonIds` via an ACTIVE PARTNER or FRIEND relationship, where the target Person:
- is not deceased
- is not already a member of `familyGroupId`
- is not already in `invitedPersonIds`

Response shape:
```json
{
  "suggestions": [
    {
      "person": { "id": "...", "displayName": "Mia Torres", "avatarUrl": null },
      "via": { "personId": "...", "personName": "Jake McLaughlin", "relationshipType": "PARTNER" }
    }
  ]
}
```

---

## Data Migration

A single Prisma migration handles:

1. Add new columns to `Relationship` (all nullable — no existing rows break).
2. Add new columns to `Person` (all nullable/defaulted — no existing rows break).
3. Change `@@unique` constraint: drop old, add new (include `type`).
4. Rename `FAMILY_FRIEND` → `FRIEND` in existing relationship rows.
5. Remove `EX_SPOUSE` rows: find all, set `endDate = createdAt` (best available date), `endReason = DIVORCE`, change `type = SPOUSE`. Add reciprocal SPOUSE record if missing.
6. Migrate compound types: update `STEP_PARENT` → `PARENT` + `qualifier: STEP`, etc. for all six compound types.

> Migration steps 4–6 are data-only SQL statements in the migration file, not Prisma model changes.

---

## UI Changes

### Person profile (edit mode)
- Add "Mark as passed away" action (admin only) → opens modal: date picker + display mode picker + remembrance toggle.
- When `isDeceased`, show deceased status badge and "Edit memorial settings" link instead of the mark-as-deceased action.

### Family member list
- Respect `deceasedDisplayMode`: dimmed row (MEMORIAL_MARKER), separate section (IN_MEMORY_SECTION), hidden (ARCHIVED).
- ARCHIVED persons remain reachable via profile URL and search.

### Relationship form (add/edit)
- Add optional `startDate` field for all relationship types.
- Qualifier field only rendered if caller is family group admin.
- "End relationship" action: opens end-date + end-reason picker. Sets `endDate` + `endReason`, marks ENDED.
- "Forget" action (admin): sets `forgottenAt`, hides from all lists.

---

## Testing

- Unit: `markDeceased` service — assert all active relationships closed, reciprocals updated, endReason = DEATH
- Unit: `getInviteeSuggestions` — assert deceased excluded, family members excluded, already-invited excluded, only PARTNER/FRIEND traversed
- Unit: qualifier write blocked for non-admin callers
- Integration: full deceased flow — person marked, relationships closed, display mode respected in member list query
- Integration: compound-type migration — STEP_PARENT rows become PARENT + qualifier:STEP with correct reciprocals
- Migration smoke test: seed data survives the unique-constraint change without conflicts

---

## Out of Scope

- Birthday remembrance calendar entry generation — flagged here but implemented as part of P2-07 calendar work or a follow-on task; P2-13 only stores the `deceasedShowBirthdayRemembrance` flag
- AI-augmented suggestion overrides (Phase 3)
- Graph traversal beyond 1 hop for suggestions (suggesting "Jake's girlfriend's sister" is AI territory)
- In-app memorial pages or tribute features
- Remarriage to the same person (update existing SPOUSE record's dates instead)
