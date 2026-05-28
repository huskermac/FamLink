# P2-13: Social Relationship Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the relationship model with full temporal history, a 14-type taxonomy, deceased-person tracking, and a deterministic invitee-suggestion query.

**Architecture:** All changes are additive to existing schema (nullable columns + new unique constraint). The route layer gains a PATCH endpoint for ending/forgetting relationships, a PATCH endpoint for marking persons deceased, and a GET endpoint for invitee suggestions. A small service module handles the suggestion graph query.

**Tech Stack:** Prisma 7, PostgreSQL, Express 4, Zod, Vitest

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `packages/db/prisma/schema.prisma` | New fields + constraint |
| Modify | `packages/db/src/relationship-helpers.ts` | Updated type registry |
| Modify | `packages/db/prisma/migrations/<timestamp>/migration.sql` | Add data-migration SQL after DDL |
| Modify | `apps/api/src/routes/relationships.ts` | Schema enum, serializers, POST fix, PATCH, GET suggestions route |
| Modify | `apps/api/src/routes/persons.ts` | Deceased endpoint + updated serializer |
| Modify | `apps/api/src/__tests__/routes/relationships.test.ts` | New tests for temporal + suggestions |
| Create | `apps/api/src/lib/inviteeSuggestions.ts` | Graph query service |
| Create | `apps/api/src/lib/__tests__/inviteeSuggestions.test.ts` | Unit tests for suggestion logic |

---

## Task 1: Prisma Schema — New Fields + Constraint

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Edit schema.prisma — add temporal fields to Relationship**

In `packages/db/prisma/schema.prisma`, replace the `Relationship` model (lines 115–132) with:

```prisma
model Relationship {
  id            String      @id @default(cuid())
  fromPersonId  String
  fromPerson    Person      @relation("RelationshipFrom", fields: [fromPersonId], references: [id], onDelete: Cascade)
  toPersonId    String
  toPerson      Person      @relation("RelationshipTo", fields: [toPersonId], references: [id], onDelete: Cascade)
  type          String
  familyGroupId String
  familyGroup   FamilyGroup @relation(fields: [familyGroupId], references: [id], onDelete: Cascade)
  notes         String?     @db.Text
  startDate     DateTime?
  endDate       DateTime?
  endReason     String?
  forgottenAt   DateTime?
  qualifier     String?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@unique([fromPersonId, toPersonId, familyGroupId, type])
  @@index([fromPersonId])
  @@index([toPersonId])
  @@index([familyGroupId])
}
```

- [ ] **Step 2: Add deceased fields to Person model**

In `packages/db/prisma/schema.prisma`, inside the `Person` model (after `fcmToken String?` on ~line 26), add:

```prisma
  isDeceased                      Boolean   @default(false)
  dateOfDeath                     DateTime?
  deceasedDisplayMode             String?
  deceasedShowBirthdayRemembrance Boolean   @default(true)
```

- [ ] **Step 3: Create migration without applying it**

Run from repo root:
```bash
cd packages/db && npx prisma migrate dev --create-only --name temporal_relationship_deceased
```

Expected: A new file created at `packages/db/prisma/migrations/<timestamp>_temporal_relationship_deceased/migration.sql`. The generated SQL will:
- Add the 5 new Relationship columns
- Add the 4 new Person columns
- Drop `Relationship_fromPersonId_toPersonId_familyGroupId_key`
- Create `Relationship_fromPersonId_toPersonId_familyGroupId_type_key`

- [ ] **Step 4: Append data-migration SQL to the generated migration file**

Open `packages/db/prisma/migrations/<timestamp>_temporal_relationship_deceased/migration.sql` and append at the bottom:

```sql
-- Data migration: rename FAMILY_FRIEND → FRIEND
UPDATE "Relationship" SET "type" = 'FRIEND', "updatedAt" = NOW() WHERE "type" = 'FAMILY_FRIEND';

-- Data migration: EX_SPOUSE → SPOUSE with endDate + endReason
UPDATE "Relationship"
SET "type" = 'SPOUSE',
    "endDate" = "createdAt",
    "endReason" = 'DIVORCE',
    "updatedAt" = NOW()
WHERE "type" = 'EX_SPOUSE';

-- Data migration: compound parent/sibling types → base type + qualifier
UPDATE "Relationship" SET "type" = 'PARENT',  "qualifier" = 'STEP',     "updatedAt" = NOW() WHERE "type" = 'STEP_PARENT';
UPDATE "Relationship" SET "type" = 'CHILD',   "qualifier" = 'STEP',     "updatedAt" = NOW() WHERE "type" = 'STEP_CHILD';
UPDATE "Relationship" SET "type" = 'SIBLING', "qualifier" = 'STEP',     "updatedAt" = NOW() WHERE "type" = 'STEP_SIBLING';
UPDATE "Relationship" SET "type" = 'SIBLING', "qualifier" = 'HALF',     "updatedAt" = NOW() WHERE "type" = 'HALF_SIBLING';
UPDATE "Relationship" SET "type" = 'PARENT',  "qualifier" = 'ADOPTIVE', "updatedAt" = NOW() WHERE "type" = 'ADOPTIVE_PARENT';
UPDATE "Relationship" SET "type" = 'CHILD',   "qualifier" = 'ADOPTIVE', "updatedAt" = NOW() WHERE "type" = 'ADOPTIVE_CHILD';
```

- [ ] **Step 5: Apply migration and regenerate client**

```bash
cd packages/db && npx prisma migrate dev && npx prisma generate
```

Expected: Migration applied, no errors. Prisma client regenerated with new fields.

- [ ] **Step 6: Verify type-check passes**

```bash
cd apps/api && npm run type-check
```

Expected: 0 errors (new Person/Relationship fields are nullable, so no breakage).

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat: P2-13 schema — temporal relationship fields + deceased person tracking"
```

---

## Task 2: Update Relationship Type Registry

**Files:**
- Modify: `packages/db/src/relationship-helpers.ts`

- [ ] **Step 1: Write the failing test**

Add a new test file `packages/db/src/__tests__/relationship-helpers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { RECIPROCAL_TYPES } from "../relationship-helpers";

describe("RECIPROCAL_TYPES", () => {
  it("GUARDIAN ↔ WARD", () => {
    expect(RECIPROCAL_TYPES["GUARDIAN"]).toBe("WARD");
    expect(RECIPROCAL_TYPES["WARD"]).toBe("GUARDIAN");
  });

  it("FRIEND is symmetric", () => {
    expect(RECIPROCAL_TYPES["FRIEND"]).toBe("FRIEND");
  });

  it("removed types are absent", () => {
    expect(RECIPROCAL_TYPES["EX_SPOUSE"]).toBeUndefined();
    expect(RECIPROCAL_TYPES["FAMILY_FRIEND"]).toBeUndefined();
    expect(RECIPROCAL_TYPES["STEP_PARENT"]).toBeUndefined();
    expect(RECIPROCAL_TYPES["HALF_SIBLING"]).toBeUndefined();
    expect(RECIPROCAL_TYPES["ADOPTIVE_PARENT"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/db && npx vitest run src/__tests__/relationship-helpers.test.ts
```

Expected: FAIL — `GUARDIAN` returns `null`, `FRIEND` undefined, removed types still present.

- [ ] **Step 3: Replace relationship-helpers.ts**

Full replacement of `packages/db/src/relationship-helpers.ts`:

```typescript
export const RECIPROCAL_TYPES: Record<string, string | null> = {
  PARENT:      "CHILD",
  CHILD:       "PARENT",
  SPOUSE:      "SPOUSE",
  PARTNER:     "PARTNER",
  SIBLING:     "SIBLING",
  GRANDPARENT: "GRANDCHILD",
  GRANDCHILD:  "GRANDPARENT",
  AUNT_UNCLE:  "NIECE_NEPHEW",
  NIECE_NEPHEW:"AUNT_UNCLE",
  COUSIN:      "COUSIN",
  GUARDIAN:    "WARD",
  WARD:        "GUARDIAN",
  FRIEND:      "FRIEND",
  CAREGIVER:   null,
};
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd packages/db && npx vitest run src/__tests__/relationship-helpers.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/relationship-helpers.ts packages/db/src/__tests__/relationship-helpers.test.ts
git commit -m "feat: P2-13 relationship-helpers — 14-type registry, GUARDIAN↔WARD, FRIEND"
```

---

## Task 3: Update Route — Type Enum, Serializers, POST Duplicate Check

**Files:**
- Modify: `apps/api/src/routes/relationships.ts`
- Modify: `apps/api/src/__tests__/routes/relationships.test.ts`

- [ ] **Step 1: Write failing tests for new type enum and serialized fields**

In `apps/api/src/__tests__/routes/relationships.test.ts`, add inside `describe("POST /api/v1/families/:familyId/relationships")`:

```typescript
it("accepts FRIEND type (replaces FAMILY_FRIEND)", async () => {
  const { admin, other, familyGroup } = await seedFamilyWithTwoMembers();
  mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
  const res = await request(app)
    .post(`/api/v1/families/${familyGroup.id}/relationships`)
    .set("Authorization", "Bearer mock")
    .send({ fromPersonId: admin.id, toPersonId: other.id, type: "FRIEND" });
  expect(res.status).toBe(201);
  expect(res.body.relationship.type).toBe("FRIEND");
});

it("rejects removed type EX_SPOUSE", async () => {
  const { admin, other, familyGroup } = await seedFamilyWithTwoMembers();
  mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
  const res = await request(app)
    .post(`/api/v1/families/${familyGroup.id}/relationships`)
    .set("Authorization", "Bearer mock")
    .send({ fromPersonId: admin.id, toPersonId: other.id, type: "EX_SPOUSE" });
  expect(res.status).toBe(400);
});

it("serialized response includes temporal fields", async () => {
  const { admin, other, familyGroup } = await seedFamilyWithTwoMembers();
  mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
  const res = await request(app)
    .post(`/api/v1/families/${familyGroup.id}/relationships`)
    .set("Authorization", "Bearer mock")
    .send({ fromPersonId: admin.id, toPersonId: other.id, type: "FRIEND" });
  expect(res.status).toBe(201);
  expect(res.body.relationship).toHaveProperty("startDate");
  expect(res.body.relationship).toHaveProperty("endDate");
  expect(res.body.relationship).toHaveProperty("endReason");
  expect(res.body.relationship).toHaveProperty("forgottenAt");
});

it("allows two different types between the same pair", async () => {
  const { admin, other, familyGroup } = await seedFamilyWithTwoMembers();
  mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
  await request(app)
    .post(`/api/v1/families/${familyGroup.id}/relationships`)
    .set("Authorization", "Bearer mock")
    .send({ fromPersonId: admin.id, toPersonId: other.id, type: "PARENT" });
  const res = await request(app)
    .post(`/api/v1/families/${familyGroup.id}/relationships`)
    .set("Authorization", "Bearer mock")
    .send({ fromPersonId: admin.id, toPersonId: other.id, type: "FRIEND" });
  expect(res.status).toBe(201);
});
```

Also update the existing `FAMILY_FRIEND` duplicate test — change `"FAMILY_FRIEND"` to `"FRIEND"` in both requests at lines ~106–119.

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/api && npm test -- relationships
```

Expected: FAIL — `FRIEND` rejected (not in enum), `EX_SPOUSE` accepted, no temporal fields in response.

- [ ] **Step 3: Update RelationshipTypeSchema**

In `apps/api/src/routes/relationships.ts`, replace lines 16–37:

```typescript
const RelationshipTypeSchema = z.enum([
  "SPOUSE",
  "PARTNER",
  "PARENT",
  "CHILD",
  "SIBLING",
  "GRANDPARENT",
  "GRANDCHILD",
  "AUNT_UNCLE",
  "NIECE_NEPHEW",
  "COUSIN",
  "GUARDIAN",
  "WARD",
  "FRIEND",
  "CAREGIVER",
]);
```

- [ ] **Step 4: Add startDate to CreateRelationshipSchema**

Replace lines 39–44:

```typescript
const CreateRelationshipSchema = z.object({
  fromPersonId: z.string().min(1),
  toPersonId:   z.string().min(1),
  type:         RelationshipTypeSchema,
  notes:        z.string().optional(),
  startDate:    z.string().regex(/^\d{4}(-\d{2}-\d{2})?$/).optional(),
});
```

- [ ] **Step 5: Update serializeRelationship to include new fields**

Replace the `serializeRelationship` function (lines 99–119):

```typescript
function serializeRelationship(
  r: {
    id: string; fromPersonId: string; toPersonId: string; type: string;
    familyGroupId: string; notes: string | null;
    startDate: Date | null; endDate: Date | null; endReason: string | null;
    forgottenAt: Date | null; qualifier: string | null;
    createdAt: Date; updatedAt: Date;
  },
  includeQualifier = false
) {
  return {
    id:           r.id,
    fromPersonId: r.fromPersonId,
    toPersonId:   r.toPersonId,
    type:         r.type,
    familyGroupId:r.familyGroupId,
    notes:        r.notes,
    startDate:    r.startDate?.toISOString() ?? null,
    endDate:      r.endDate?.toISOString() ?? null,
    endReason:    r.endReason ?? null,
    forgottenAt:  r.forgottenAt?.toISOString() ?? null,
    ...(includeQualifier ? { qualifier: r.qualifier ?? null } : {}),
    createdAt:    r.createdAt.toISOString(),
    updatedAt:    r.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 6: Fix POST duplicate check to include type in query**

In the POST handler transaction (around line 170), replace the duplicate check:

```typescript
// Before
const existingPrimary = await tx.relationship.findFirst({
  where: { fromPersonId, toPersonId, familyGroupId: familyId }
});
if (existingPrimary) { throw new DuplicateRelationshipConflict(); }
if (reciprocalType !== null) {
  const existingReciprocal = await tx.relationship.findFirst({
    where: { fromPersonId: toPersonId, toPersonId: fromPersonId, familyGroupId: familyId }
  });
  if (existingReciprocal) { throw new DuplicateRelationshipConflict(); }
}
```

Replace with:

```typescript
const existingPrimary = await tx.relationship.findUnique({
  where: {
    fromPersonId_toPersonId_familyGroupId_type: {
      fromPersonId, toPersonId, familyGroupId: familyId, type
    }
  }
});
if (existingPrimary) { throw new DuplicateRelationshipConflict(); }
if (reciprocalType !== null) {
  const existingReciprocal = await tx.relationship.findUnique({
    where: {
      fromPersonId_toPersonId_familyGroupId_type: {
        fromPersonId: toPersonId, toPersonId: fromPersonId,
        familyGroupId: familyId, type: reciprocalType
      }
    }
  });
  if (existingReciprocal) { throw new DuplicateRelationshipConflict(); }
}
```

- [ ] **Step 7: Pass startDate through to relationship.create**

In the POST handler's `tx.relationship.create` call (around line 189), add `startDate`:

```typescript
const relationship = await tx.relationship.create({
  data: {
    fromPersonId,
    toPersonId,
    type,
    familyGroupId: familyId,
    notes:     notes ?? null,
    startDate: parsed.data.startDate ? parseFlexDate(parsed.data.startDate) : null,
  }
});
```

Add the helper function near the top of the file (after imports):

```typescript
function parseFlexDate(s: string): Date {
  // Accepts "2018" (→ 2018-01-01) or "2018-06-15"
  return new Date(s.length === 4 ? `${s}-01-01T00:00:00.000Z` : `${s}T00:00:00.000Z`);
}
```

- [ ] **Step 8: Run tests — expect pass**

```bash
cd apps/api && npm test -- relationships
```

Expected: all tests PASS

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/relationships.ts apps/api/src/__tests__/routes/relationships.test.ts
git commit -m "feat: P2-13 relationship route — 14-type enum, temporal fields, FRIEND type"
```

---

## Task 4: PATCH /relationships/:id — End and Forget

**Files:**
- Modify: `apps/api/src/routes/relationships.ts`
- Modify: `apps/api/src/__tests__/routes/relationships.test.ts`

- [ ] **Step 1: Write failing tests**

In `apps/api/src/__tests__/routes/relationships.test.ts`, add a new `describe` block:

```typescript
describe("PATCH /api/v1/relationships/:relationshipId", () => {
  it("ends a relationship — sets endDate + endReason on both primary and reciprocal", async () => {
    const { admin, other, familyGroup } = await seedFamilyWithTwoMembers();
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const created = await request(app)
      .post(`/api/v1/families/${familyGroup.id}/relationships`)
      .set("Authorization", "Bearer mock")
      .send({ fromPersonId: admin.id, toPersonId: other.id, type: "SPOUSE" });
    const primaryId = created.body.relationship.id as string;

    const patch = await request(app)
      .patch(`/api/v1/relationships/${primaryId}`)
      .set("Authorization", "Bearer mock")
      .send({ endDate: "2020", endReason: "DIVORCE" });
    expect(patch.status).toBe(200);
    expect(patch.body.relationship.endDate).not.toBeNull();
    expect(patch.body.relationship.endReason).toBe("DIVORCE");
    expect(patch.body.reciprocal.endDate).not.toBeNull();
  });

  it("forget requires admin role", async () => {
    const { admin, other, familyGroup } = await seedFamilyWithTwoMembers();
    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const rel = await db.relationship.create({
      data: { fromPersonId: other.id, toPersonId: admin.id, type: "FRIEND", familyGroupId: familyGroup.id }
    });
    const patch = await request(app)
      .patch(`/api/v1/relationships/${rel.id}`)
      .set("Authorization", "Bearer mock")
      .send({ forget: true });
    expect(patch.status).toBe(403);
  });

  it("forget sets forgottenAt on both sides (admin)", async () => {
    const { admin, other, familyGroup } = await seedFamilyWithTwoMembers();
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const created = await request(app)
      .post(`/api/v1/families/${familyGroup.id}/relationships`)
      .set("Authorization", "Bearer mock")
      .send({ fromPersonId: admin.id, toPersonId: other.id, type: "FRIEND" });
    const primaryId = created.body.relationship.id as string;

    const patch = await request(app)
      .patch(`/api/v1/relationships/${primaryId}`)
      .set("Authorization", "Bearer mock")
      .send({ forget: true });
    expect(patch.status).toBe(200);
    const rows = await db.relationship.findMany({ where: { familyGroupId: familyGroup.id } });
    expect(rows.every(r => r.forgottenAt !== null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/api && npm test -- relationships
```

Expected: FAIL — 404 for PATCH endpoint.

- [ ] **Step 3: Add schemas for PATCH body**

In `apps/api/src/routes/relationships.ts`, after the existing schemas, add:

```typescript
const EndRelationshipSchema = z.object({
  endDate:   z.string().regex(/^\d{4}(-\d{2}-\d{2})?$/),
  endReason: z.enum(["DEATH", "DIVORCE", "SEPARATION", "ESTRANGEMENT", "MUTUAL", "OTHER"]),
});

const ForgetRelationshipSchema = z.object({
  forget: z.literal(true),
});
```

- [ ] **Step 4: Add PATCH handler to relationshipsRouter**

In `apps/api/src/routes/relationships.ts`, inside `relationshipsRouter` (after the DELETE handler):

```typescript
relationshipsRouter.patch("/:relationshipId", async (req, res) => {
  const p = relationshipIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid relationship id" });
    return;
  }
  const { relationshipId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }

  const rel = await db.relationship.findUnique({ where: { id: relationshipId } });
  if (!rel) {
    res.status(404).json({ error: "Relationship not found" });
    return;
  }

  if (!(await isFamilyMember(requester.id, rel.familyGroupId))) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  // Attempt forget (admin only)
  const forgetParsed = ForgetRelationshipSchema.safeParse(req.body);
  if (forgetParsed.success) {
    const isAdmin = await db.familyMember.findFirst({
      where: { personId: requester.id, familyGroupId: rel.familyGroupId, roles: { has: "ADMIN" } }
    });
    if (!isAdmin) {
      res.status(403).json({ error: "Admin role required to forget a relationship" });
      return;
    }
    const now = new Date();
    const reciprocalType = RECIPROCAL_TYPES[rel.type] ?? null;
    const result = await db.$transaction(async (tx) => {
      const primary = await tx.relationship.update({
        where: { id: rel.id },
        data: { forgottenAt: now },
      });
      const reciprocal = reciprocalType != null
        ? await tx.relationship.findFirst({
            where: { fromPersonId: rel.toPersonId, toPersonId: rel.fromPersonId,
                     familyGroupId: rel.familyGroupId, type: reciprocalType }
          })
        : null;
      const updatedReciprocal = reciprocal
        ? await tx.relationship.update({ where: { id: reciprocal.id }, data: { forgottenAt: now } })
        : null;
      return { relationship: primary, reciprocal: updatedReciprocal };
    });
    res.json({
      relationship: serializeRelationship(result.relationship),
      reciprocal: result.reciprocal ? serializeRelationship(result.reciprocal) : null,
    });
    return;
  }

  // Attempt end
  const endParsed = EndRelationshipSchema.safeParse(req.body);
  if (!endParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: endParsed.error.flatten() });
    return;
  }
  const endDate = parseFlexDate(endParsed.data.endDate);
  const { endReason } = endParsed.data;
  const reciprocalTypeForEnd = RECIPROCAL_TYPES[rel.type] ?? null;

  const result = await db.$transaction(async (tx) => {
    const primary = await tx.relationship.update({
      where: { id: rel.id },
      data: { endDate, endReason },
    });
    const reciprocal = reciprocalTypeForEnd != null
      ? await tx.relationship.findFirst({
          where: { fromPersonId: rel.toPersonId, toPersonId: rel.fromPersonId,
                   familyGroupId: rel.familyGroupId, type: reciprocalTypeForEnd }
        })
      : null;
    const updatedReciprocal = reciprocal
      ? await tx.relationship.update({ where: { id: reciprocal.id }, data: { endDate, endReason } })
      : null;
    return { relationship: primary, reciprocal: updatedReciprocal };
  });

  res.json({
    relationship: serializeRelationship(result.relationship),
    reciprocal: result.reciprocal ? serializeRelationship(result.reciprocal) : null,
  });
});
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd apps/api && npm test -- relationships
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/relationships.ts apps/api/src/__tests__/routes/relationships.test.ts
git commit -m "feat: P2-13 PATCH /relationships/:id — end and forget"
```

---

## Task 5: PATCH /persons/:id/deceased

**Files:**
- Modify: `apps/api/src/routes/persons.ts`
- Create: `apps/api/src/__tests__/routes/persons.test.ts` (if not exists)

- [ ] **Step 1: Check whether persons.test.ts already exists**

```bash
ls apps/api/src/__tests__/routes/
```

If `persons.test.ts` does not exist, create it with the boilerplate below. If it exists, add the new describe block to it.

- [ ] **Step 2: Write failing tests**

Create/add to `apps/api/src/__tests__/routes/persons.test.ts`:

```typescript
import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { TEST_CLERK_ID } from "../helpers/auth";
import { seedGuestPerson, seedTestFamily, seedTestPerson } from "../helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

describe("PATCH /api/v1/persons/:personId/deceased", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => { mockGetAuth.mockReset(); });

  it("marks person deceased and closes active relationships", async () => {
    const admin = await seedTestPerson();
    const member = await seedGuestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    await db.familyMember.create({
      data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
    });
    await db.relationship.create({
      data: { fromPersonId: admin.id, toPersonId: member.id, type: "SPOUSE", familyGroupId: familyGroup.id }
    });
    await db.relationship.create({
      data: { fromPersonId: member.id, toPersonId: admin.id, type: "SPOUSE", familyGroupId: familyGroup.id }
    });

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .patch(`/api/v1/persons/${member.id}/deceased`)
      .set("Authorization", "Bearer mock")
      .send({ dateOfDeath: "2019-06-03", deceasedDisplayMode: "MEMORIAL_MARKER", deceasedShowBirthdayRemembrance: true });

    expect(res.status).toBe(200);
    expect(res.body.isDeceased).toBe(true);
    expect(res.body.dateOfDeath).toBe("2019-06-03");

    const rels = await db.relationship.findMany({ where: { familyGroupId: familyGroup.id } });
    expect(rels.every(r => r.endDate !== null && r.endReason === "DEATH")).toBe(true);
  });

  it("returns 403 when requester is not admin", async () => {
    const admin = await seedTestPerson();
    const member = await seedGuestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    await db.familyMember.create({
      data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
    });
    // Log in as member (non-admin)
    const { TEST_USER_2_CLERK_ID } = await import("../helpers/auth");
    await db.person.update({ where: { id: member.id }, data: { userId: TEST_USER_2_CLERK_ID } });
    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });

    const res = await request(app)
      .patch(`/api/v1/persons/${admin.id}/deceased`)
      .set("Authorization", "Bearer mock")
      .send({ dateOfDeath: "2020-01-01", deceasedDisplayMode: "ARCHIVED", deceasedShowBirthdayRemembrance: false });

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/api && npm test -- persons
```

Expected: FAIL — 404 for PATCH /deceased endpoint.

- [ ] **Step 3: Add MarkDeceasedSchema and handler to persons.ts**

In `apps/api/src/routes/persons.ts`, after the `UpdatePersonSchema` definition, add:

```typescript
const MarkDeceasedSchema = z.object({
  dateOfDeath:                    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deceasedDisplayMode:            z.enum(["MEMORIAL_MARKER", "IN_MEMORY_SECTION", "ARCHIVED"]),
  deceasedShowBirthdayRemembrance:z.boolean().default(true),
});
```

Add the route handler before the `personsRouter.get("/:personId"` line:

```typescript
personsRouter.patch("/:personId/deceased", async (req, res) => {
  const paramParsed = personIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    res.status(400).json({ error: "Invalid person id" });
    return;
  }
  const { personId } = paramParsed.data;

  const parsed = MarkDeceasedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(404).json({ error: "Person record not found — complete onboarding" });
    return;
  }

  const isAdmin = await isAdminOfSharedFamilyWithTarget(requester.id, personId);
  if (!isAdmin) {
    res.status(403).json({ error: "Admin role required to mark a person as deceased" });
    return;
  }

  const dateOfDeath = new Date(`${parsed.data.dateOfDeath}T00:00:00.000Z`);

  const updated = await db.$transaction(async (tx) => {
    const person = await tx.person.update({
      where: { id: personId },
      data: {
        isDeceased:                      true,
        dateOfDeath,
        deceasedDisplayMode:             parsed.data.deceasedDisplayMode,
        deceasedShowBirthdayRemembrance: parsed.data.deceasedShowBirthdayRemembrance,
      },
    });
    // Close all active relationships on both sides
    await tx.relationship.updateMany({
      where: {
        OR: [{ fromPersonId: personId }, { toPersonId: personId }],
        endDate: null,
        forgottenAt: null,
      },
      data: { endDate: dateOfDeath, endReason: "DEATH" },
    });
    return person;
  });

  res.json(serializePerson(updated, true));
});
```

- [ ] **Step 4: Update serializePerson to include deceased fields**

In `persons.ts`, replace the `serializePerson` function:

```typescript
function serializePerson(
  person: Person,
  includeGuardianId: boolean
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id:           person.id,
    userId:       person.userId,
    firstName:    person.firstName,
    lastName:     person.lastName,
    preferredName:person.preferredName,
    dateOfBirth:  person.dateOfBirth ? person.dateOfBirth.toISOString().slice(0, 10) : null,
    ageGateLevel: person.ageGateLevel,
    profilePhotoUrl: person.profilePhotoUrl,
    isDeceased:   person.isDeceased,
    dateOfDeath:  person.dateOfDeath ? person.dateOfDeath.toISOString().slice(0, 10) : null,
    deceasedDisplayMode: person.deceasedDisplayMode ?? null,
    deceasedShowBirthdayRemembrance: person.deceasedShowBirthdayRemembrance,
    createdAt:    person.createdAt.toISOString(),
    updatedAt:    person.updatedAt.toISOString(),
  };
  if (includeGuardianId) {
    base.guardianPersonId = person.guardianPersonId;
  }
  return base;
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd apps/api && npm test -- persons
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/persons.ts apps/api/src/__tests__/routes/persons.test.ts
git commit -m "feat: P2-13 PATCH /persons/:id/deceased — auto-closes relationships"
```

---

## Task 6: Update GET Routes — Filter Forgotten, Admin-Gated Qualifier

**Files:**
- Modify: `apps/api/src/routes/relationships.ts`

- [ ] **Step 1: Write failing tests**

In `apps/api/src/__tests__/routes/relationships.test.ts`, add inside the GET families block:

```typescript
it("excludes forgotten relationships from list", async () => {
  const { admin, other, familyGroup } = await seedFamilyWithTwoMembers();
  const rel = await db.relationship.create({
    data: {
      fromPersonId: admin.id, toPersonId: other.id,
      type: "FRIEND", familyGroupId: familyGroup.id,
      forgottenAt: new Date()
    }
  });
  mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
  const res = await request(app)
    .get(`/api/v1/families/${familyGroup.id}/relationships`)
    .set("Authorization", "Bearer mock");
  expect(res.status).toBe(200);
  expect(res.body.find((r: any) => r.id === rel.id)).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd apps/api && npm test -- relationships
```

Expected: FAIL — forgotten relationship is included.

- [ ] **Step 3: Add `forgottenAt: null` filter to both GET handlers**

In `familyRelationshipsRouter.get`, update the `db.relationship.findMany` call:

```typescript
const rows = await db.relationship.findMany({
  where: { familyGroupId: familyId, forgottenAt: null },
  include: { /* unchanged */ },
  orderBy: [{ createdAt: "asc" }]
});
```

In `personRelationshipsRouter.get`, update similarly:

```typescript
const rows = await db.relationship.findMany({
  where: {
    fromPersonId: personId,
    forgottenAt: null,
    familyGroup: { members: { some: { personId: requester.id } } }
  },
  /* unchanged */
});
```

- [ ] **Step 4: Check admin role in family GET to gate qualifier field**

In `familyRelationshipsRouter.get`, after fetching `rows`, add an admin check and pass `includeQualifier`:

```typescript
const isAdmin = await db.familyMember.findFirst({
  where: { personId: requester.id, familyGroupId: familyId, roles: { has: "ADMIN" } }
});
const includeQualifier = isAdmin !== null;

res.json(
  rows.map((r) => ({
    ...serializeRelationship(r, includeQualifier),
    fromPerson: personSummary(r.fromPerson),
    toPerson:   personSummary(r.toPerson)
  }))
);
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd apps/api && npm test -- relationships
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/relationships.ts
git commit -m "feat: P2-13 GET relationships — exclude forgotten, gate qualifier on admin"
```

---

## Task 7: Invitee Suggestion Service + Route

**Files:**
- Create: `apps/api/src/lib/inviteeSuggestions.ts`
- Create: `apps/api/src/lib/__tests__/inviteeSuggestions.test.ts`
- Modify: `apps/api/src/routes/relationships.ts`
- Modify: `apps/api/src/__tests__/routes/relationships.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `apps/api/src/lib/__tests__/inviteeSuggestions.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@famlink/db";
import { getInviteeSuggestions } from "../inviteeSuggestions";
import { seedGuestPerson, seedTestFamily, seedTestPerson } from "../../__tests__/helpers/db";

async function seedFamilyOf(adminId: string, memberIds: string[], familyGroupId?: string) {
  const { familyGroup } = await seedTestFamily(adminId);
  for (const id of memberIds) {
    await db.familyMember.create({
      data: { familyGroupId: familyGroup.id, personId: id, roles: ["MEMBER"], permissions: [] }
    });
  }
  return familyGroup;
}

describe("getInviteeSuggestions", () => {
  it("returns active FRIEND of invited person", async () => {
    const admin = await seedTestPerson();
    const friend = await seedGuestPerson({ firstName: "Mia" });
    const familyGroup = await seedFamilyOf(admin.id, []);
    await db.relationship.create({
      data: { fromPersonId: admin.id, toPersonId: friend.id, type: "FRIEND",
              familyGroupId: familyGroup.id }
    });

    const result = await getInviteeSuggestions({ familyGroupId: familyGroup.id, invitedPersonIds: [admin.id] });
    expect(result.some(s => s.person.id === friend.id)).toBe(true);
  });

  it("does not suggest ended FRIEND", async () => {
    const admin = await seedTestPerson();
    const exFriend = await seedGuestPerson({ firstName: "ExFriend" });
    const familyGroup = await seedFamilyOf(admin.id, []);
    await db.relationship.create({
      data: { fromPersonId: admin.id, toPersonId: exFriend.id, type: "FRIEND",
              familyGroupId: familyGroup.id, endDate: new Date(), endReason: "MUTUAL" }
    });

    const result = await getInviteeSuggestions({ familyGroupId: familyGroup.id, invitedPersonIds: [admin.id] });
    expect(result.some(s => s.person.id === exFriend.id)).toBe(false);
  });

  it("suggests ended SPOUSE only when shared child exists", async () => {
    const admin = await seedTestPerson();
    const exSpouse = await seedGuestPerson({ firstName: "Carol" });
    const child = await seedGuestPerson({ firstName: "Jake" });
    const familyGroup = await seedFamilyOf(admin.id, [child.id]);

    await db.relationship.create({
      data: { fromPersonId: admin.id, toPersonId: exSpouse.id, type: "SPOUSE",
              familyGroupId: familyGroup.id, endDate: new Date(), endReason: "DIVORCE" }
    });
    await db.relationship.create({
      data: { fromPersonId: admin.id, toPersonId: child.id, type: "PARENT",
              familyGroupId: familyGroup.id }
    });
    await db.relationship.create({
      data: { fromPersonId: exSpouse.id, toPersonId: child.id, type: "PARENT",
              familyGroupId: familyGroup.id }
    });

    const result = await getInviteeSuggestions({ familyGroupId: familyGroup.id, invitedPersonIds: [admin.id] });
    const suggestion = result.find(s => s.person.id === exSpouse.id);
    expect(suggestion).toBeDefined();
    expect(suggestion!.sharedChildren.length).toBe(1);
    expect(suggestion!.sharedChildren[0].id).toBe(child.id);
  });

  it("does not suggest ended SPOUSE without shared child", async () => {
    const admin = await seedTestPerson();
    const exSpouse = await seedGuestPerson({ firstName: "Carol" });
    const familyGroup = await seedFamilyOf(admin.id, []);
    await db.relationship.create({
      data: { fromPersonId: admin.id, toPersonId: exSpouse.id, type: "SPOUSE",
              familyGroupId: familyGroup.id, endDate: new Date(), endReason: "DIVORCE" }
    });

    const result = await getInviteeSuggestions({ familyGroupId: familyGroup.id, invitedPersonIds: [admin.id] });
    expect(result.some(s => s.person.id === exSpouse.id)).toBe(false);
  });

  it("does not suggest deceased persons", async () => {
    const admin = await seedTestPerson();
    const deceased = await seedGuestPerson({ firstName: "Deceased" });
    await db.person.update({ where: { id: deceased.id }, data: { isDeceased: true } });
    const familyGroup = await seedFamilyOf(admin.id, []);
    await db.relationship.create({
      data: { fromPersonId: admin.id, toPersonId: deceased.id, type: "FRIEND",
              familyGroupId: familyGroup.id }
    });

    const result = await getInviteeSuggestions({ familyGroupId: familyGroup.id, invitedPersonIds: [admin.id] });
    expect(result.some(s => s.person.id === deceased.id)).toBe(false);
  });

  it("does not suggest family group members", async () => {
    const admin = await seedTestPerson();
    const member = await seedGuestPerson({ firstName: "FamMember" });
    const familyGroup = await seedFamilyOf(admin.id, [member.id]);
    await db.relationship.create({
      data: { fromPersonId: admin.id, toPersonId: member.id, type: "FRIEND",
              familyGroupId: familyGroup.id }
    });

    const result = await getInviteeSuggestions({ familyGroupId: familyGroup.id, invitedPersonIds: [admin.id] });
    expect(result.some(s => s.person.id === member.id)).toBe(false);
  });

  it("does not suggest persons already in invitedPersonIds", async () => {
    const admin = await seedTestPerson();
    const friend = await seedGuestPerson({ firstName: "AlreadyInvited" });
    const familyGroup = await seedFamilyOf(admin.id, []);
    await db.relationship.create({
      data: { fromPersonId: admin.id, toPersonId: friend.id, type: "FRIEND",
              familyGroupId: familyGroup.id }
    });

    const result = await getInviteeSuggestions({
      familyGroupId: familyGroup.id,
      invitedPersonIds: [admin.id, friend.id]
    });
    expect(result.some(s => s.person.id === friend.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/api && npm test -- inviteeSuggestions
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create inviteeSuggestions.ts**

Create `apps/api/src/lib/inviteeSuggestions.ts`:

```typescript
import { db } from "@famlink/db";

export interface Suggestion {
  person: { id: string; displayName: string; avatarUrl: string | null };
  via: { personId: string; personName: string; relationshipType: string; relationshipState: "ACTIVE" | "ENDED" };
  sharedChildren: { id: string; displayName: string }[];
}

function displayName(p: { firstName: string; lastName: string; preferredName: string | null }): string {
  return p.preferredName?.trim() || `${p.firstName} ${p.lastName}`.trim();
}

export async function getInviteeSuggestions({
  familyGroupId,
  invitedPersonIds,
}: {
  familyGroupId: string;
  invitedPersonIds: string[];
}): Promise<Suggestion[]> {
  if (invitedPersonIds.length === 0) return [];

  // All current family members (exclude from suggestions)
  const familyMembers = await db.familyMember.findMany({
    where: { familyGroupId },
    select: { personId: true }
  });
  const familyMemberIds = new Set(familyMembers.map(m => m.personId));

  const seen = new Set<string>(); // prevent duplicate suggestions
  const suggestions: Suggestion[] = [];

  for (const invitedPersonId of invitedPersonIds) {
    const invitedPerson = await db.person.findUnique({
      where: { id: invitedPersonId },
      select: { id: true, firstName: true, lastName: true, preferredName: true }
    });
    if (!invitedPerson) continue;

    // --- ACTIVE FRIEND suggestions ---
    const activeFriends = await db.relationship.findMany({
      where: { fromPersonId: invitedPersonId, type: "FRIEND", endDate: null, forgottenAt: null },
      include: { toPerson: { select: { id: true, firstName: true, lastName: true, preferredName: true, isDeceased: true, profilePhotoUrl: true } } }
    });
    for (const rel of activeFriends) {
      const candidate = rel.toPerson;
      if (candidate.isDeceased) continue;
      if (familyMemberIds.has(candidate.id)) continue;
      if (invitedPersonIds.includes(candidate.id)) continue;
      if (seen.has(`${invitedPersonId}:${candidate.id}`)) continue;
      seen.add(`${invitedPersonId}:${candidate.id}`);
      suggestions.push({
        person: { id: candidate.id, displayName: displayName(candidate), avatarUrl: candidate.profilePhotoUrl },
        via: { personId: invitedPersonId, personName: displayName(invitedPerson), relationshipType: "FRIEND", relationshipState: "ACTIVE" },
        sharedChildren: [],
      });
    }

    // --- ACTIVE SPOUSE/PARTNER suggestions ---
    const activeRomantic = await db.relationship.findMany({
      where: { fromPersonId: invitedPersonId, type: { in: ["SPOUSE", "PARTNER"] }, endDate: null, forgottenAt: null },
      include: { toPerson: { select: { id: true, firstName: true, lastName: true, preferredName: true, isDeceased: true, profilePhotoUrl: true } } }
    });
    for (const rel of activeRomantic) {
      const candidate = rel.toPerson;
      if (candidate.isDeceased) continue;
      if (familyMemberIds.has(candidate.id)) continue;
      if (invitedPersonIds.includes(candidate.id)) continue;
      if (seen.has(`${invitedPersonId}:${candidate.id}`)) continue;
      seen.add(`${invitedPersonId}:${candidate.id}`);
      suggestions.push({
        person: { id: candidate.id, displayName: displayName(candidate), avatarUrl: candidate.profilePhotoUrl },
        via: { personId: invitedPersonId, personName: displayName(invitedPerson), relationshipType: rel.type, relationshipState: "ACTIVE" },
        sharedChildren: [],
      });
    }

    // --- ENDED SPOUSE/PARTNER — only if shared children ---
    const endedRomantic = await db.relationship.findMany({
      where: { fromPersonId: invitedPersonId, type: { in: ["SPOUSE", "PARTNER"] },
               endDate: { not: null }, forgottenAt: null },
      include: { toPerson: { select: { id: true, firstName: true, lastName: true, preferredName: true, isDeceased: true, profilePhotoUrl: true } } }
    });
    for (const rel of endedRomantic) {
      const candidate = rel.toPerson;
      if (candidate.isDeceased) continue;
      if (familyMemberIds.has(candidate.id)) continue;
      if (invitedPersonIds.includes(candidate.id)) continue;

      // Find shared children
      const invitedChildren = await db.relationship.findMany({
        where: { fromPersonId: invitedPersonId, type: "PARENT", forgottenAt: null },
        select: { toPersonId: true }
      });
      const invitedChildIds = new Set(invitedChildren.map(r => r.toPersonId));

      const candidateChildren = await db.relationship.findMany({
        where: { fromPersonId: candidate.id, type: "PARENT", forgottenAt: null,
                 toPersonId: { in: [...invitedChildIds] } },
        include: { toPerson: { select: { id: true, firstName: true, lastName: true, preferredName: true } } }
      });

      if (candidateChildren.length === 0) continue;
      if (seen.has(`${invitedPersonId}:${candidate.id}`)) continue;
      seen.add(`${invitedPersonId}:${candidate.id}`);

      suggestions.push({
        person: { id: candidate.id, displayName: displayName(candidate), avatarUrl: candidate.profilePhotoUrl },
        via: { personId: invitedPersonId, personName: displayName(invitedPerson), relationshipType: rel.type, relationshipState: "ENDED" },
        sharedChildren: candidateChildren.map(c => ({ id: c.toPerson.id, displayName: displayName(c.toPerson) })),
      });
    }
  }

  return suggestions;
}
```

- [ ] **Step 4: Run unit tests — expect pass**

```bash
cd apps/api && npm test -- inviteeSuggestions
```

Expected: PASS

- [ ] **Step 5: Add GET route to familyRelationshipsRouter**

In `apps/api/src/routes/relationships.ts`, add this import at the top of the file with the other imports:

```typescript
import { getInviteeSuggestions } from "../lib/inviteeSuggestions";
```

Then add the route to `familyRelationshipsRouter` (before the POST handler):

```typescript
familyRelationshipsRouter.get("/:familyId/invitee-suggestions", async (req, res) => {
  const p = familyIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid family id" });
    return;
  }
  const { familyId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }

  if (!(await isFamilyMember(requester.id, familyId))) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  const raw = req.query["invitedPersonIds"];
  const invitedPersonIds = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];

  const suggestions = await getInviteeSuggestions({ familyGroupId: familyId, invitedPersonIds });
  res.json({ suggestions });
});
```

- [ ] **Step 6: Add integration test for the route**

In `apps/api/src/__tests__/routes/relationships.test.ts`, add:

```typescript
describe("GET /api/v1/families/:familyId/invitee-suggestions", () => {
  it("returns friend of invited person not in family", async () => {
    const { admin, familyGroup } = await seedFamilyWithTwoMembers();
    const friend = await seedGuestPerson({ firstName: "Mia" });
    await db.relationship.create({
      data: { fromPersonId: admin.id, toPersonId: friend.id, type: "FRIEND",
              familyGroupId: familyGroup.id }
    });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .get(`/api/v1/families/${familyGroup.id}/invitee-suggestions?invitedPersonIds=${admin.id}`)
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(200);
    expect(res.body.suggestions.some((s: any) => s.person.id === friend.id)).toBe(true);
  });
});
```

- [ ] **Step 7: Run all tests — expect pass**

```bash
cd apps/api && npm test
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/inviteeSuggestions.ts \
        apps/api/src/lib/__tests__/inviteeSuggestions.test.ts \
        apps/api/src/routes/relationships.ts \
        apps/api/src/__tests__/routes/relationships.test.ts
git commit -m "feat: P2-13 invitee suggestions — FRIEND, active/ended SPOUSE/PARTNER with co-parent check"
```

---

## Task 8: Final Type-Check + Full Test Run

- [ ] **Step 1: Type-check API**

```bash
cd apps/api && npm run type-check
```

Expected: 0 errors

- [ ] **Step 2: Type-check web (verify no breakage from Person type changes)**

```bash
cd apps/web && npm run type-check
```

Expected: 0 errors (web reads person fields via API responses, no shared type imports from `@famlink/db`)

- [ ] **Step 3: Full test suite**

```bash
cd apps/api && npm test
```

Expected: all tests PASS

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: P2-13 complete — temporal relationships, deceased tracking, invitee suggestions"
```
