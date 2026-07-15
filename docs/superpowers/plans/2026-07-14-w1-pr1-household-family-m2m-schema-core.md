# W1 PR 1 — Household↔Family M2M Schema Core: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `Household.familyGroupId` with a `HouseholdFamily` M2M join table (min-1 enforced), rework household authorization to any-linked-family + audit trail, and tighten household-scoped event visibility — behavior identical for today's single-linked households.

**Architecture:** Expand→contract inside one PR so the workspace type-checks at every task boundary: Task 1 adds the join table + audit table and backfills (keeping the old FK column); Tasks 2–4 move every reader/writer onto the join table (`householdAccess` helpers, household routes, family routes, eventVisibility, aiTools); Task 5 drops the column with a second migration and updates web types. Consent flows (`LinkRequest`) are **PR 2** — in this PR the only link-creation path is household creation itself, and unlink of the last link requires `destroy: true`.

**Tech Stack:** Express 4, Prisma/PostgreSQL, Vitest + Supertest (real test DB — established repo pattern), Zod.

**Spec:** `docs/superpowers/specs/2026-07-14-w1-household-family-m2m-design.md` (Steve-approved 2026-07-14). This PR implements spec §3.1, §3.3, §4, §5, §6.1, §7 invariants 1–3 (read-side), and the PR-1 slice of §10. `LinkRequest` (§3.2, §6.2) is PR 2; its migration ships there, not here (refines spec §4 wording).

## Global Constraints

- Commit format: `feat: P3-04 <short description>` (or `fix:`/`chore:`/`docs:`).
- Per-task verification MUST include `npm run lint` from the repo root (0 errors; 34 pre-existing warnings in unrelated files are known) AND `npm run type-check` — the workspace must type-check at the END of every task.
- Isolation invariants (spec §7, binding): (1) a household link exposes only household data (name, address, residents' display names + household roles) and linked family **names** — never another family's roster, members, events, or ids; (2) a shared person/household never creates cross-family event visibility by itself; (3) household-scoped invitations grant visibility only to viewers who are active members of the event's family.
- Household write authority: **any linked family's admin edits; every mutation writes a `HouseholdAuditEntry` in the same transaction** (spec §2.2).
- Min-1 rule: unlink refuses the last link with `409 { error: "LAST_LINK" }` unless `destroy: true`.
- Admin = the existing `hasAdminRole(membership)` predicate from `apps/api/src/lib/familyAccess.ts`; active membership = the existing `activeFamilyMembership` semantics (excludes `suspendedAt`).
- Never log household PII field values; audit entries live in the DB, structured logs carry ids only.
- Before editing any existing symbol, run `mcp__gitnexus__impact({target, direction: "upstream"})` and note the blast radius. Run `mcp__gitnexus__detect_changes()` before every commit; if working in a worktree, its results are known-unreliable for new/uncommitted files — cross-check with `git diff --stat` and say so in your report.

---

### Task 1: Expand — `HouseholdFamily` + `HouseholdAuditEntry` schema, backfill migration, merge-map entries

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Household, FamilyGroup, two new models)
- Create: `packages/db/prisma/migrations/<timestamp>_household_family_m2m_expand/migration.sql` (generated, then hand-edited to add the backfill INSERT)
- Modify: `apps/api/src/lib/personIdentity.ts` (merge-engine logical-column map)
- Modify: `apps/api/src/routes/families.ts` (`POST /:familyId/households` ~line 315 — dual-write: keep the FK write AND create the link + `LINKED` audit entry in one transaction, so every household created after this task has a link; council round-1 finding — without this, Task 3's join-based authz would lock out newly created households until Task 4)
- Create: `apps/api/src/scripts/verifyHouseholdBackfill.ts` (post-deploy verification: counts households vs. `HouseholdFamily` links, prints orphans; read-only, exits non-zero on mismatch — the backfill SQL itself can't run under vitest, this script is its prod verification)
- Modify: `packages/db/prisma/seed.ts` — IF it creates households (check with `grep -n "household" packages/db/prisma/seed.ts`), add a matching `householdFamily` link per created household
- Test: `apps/api/src/__tests__/lib/householdFamily.test.ts` (new) + extend `apps/api/src/__tests__/routes/families.test.ts` (creation writes FK + link + LINKED audit)

**Interfaces:**
- Produces (later tasks rely on): Prisma models `HouseholdFamily` (`householdId`, `familyGroupId`, `linkedAt`, `linkedByPersonId`, unique `[householdId, familyGroupId]`, relations `household`/`familyGroup`) and `HouseholdAuditEntry` (`householdId`, `actorPersonId`, `actorFamilyGroupId`, `action`, `changes Json?`, `createdAt`). `Household.familyGroupId` STILL EXISTS after this task (dropped in Task 5). New relation fields: `Household.families: HouseholdFamily[]`, `FamilyGroup.householdLinks: HouseholdFamily[]`.

- [ ] **Step 1: Schema changes**

In `packages/db/prisma/schema.prisma`, add to `model Household` (keep `familyGroupId`/`familyGroup` for now):

```prisma
  families HouseholdFamily[]
```

Add to `model FamilyGroup` (keep the existing `households Household[]` relation for now — it dies with the FK in Task 5):

```prisma
  householdLinks HouseholdFamily[]
```

Add the two new models:

```prisma
model HouseholdFamily {
  id               String      @id @default(cuid())
  householdId      String
  household        Household   @relation(fields: [householdId], references: [id], onDelete: Cascade)
  familyGroupId    String
  familyGroup      FamilyGroup @relation(fields: [familyGroupId], references: [id], onDelete: Cascade)
  linkedAt         DateTime    @default(now())
  linkedByPersonId String?

  @@unique([householdId, familyGroupId])
  @@index([familyGroupId])
}

model HouseholdAuditEntry {
  id                 String   @id @default(cuid())
  householdId        String
  actorPersonId      String
  actorFamilyGroupId String
  action             String
  changes            Json?
  createdAt          DateTime @default(now())

  @@index([householdId, createdAt])
}
```

(`linkedByPersonId`/`actorPersonId`/`actorFamilyGroupId` are deliberately logical columns — no Prisma relation — so audit rows survive person/family deletion; the merge engine handles re-pointing, Step 3.)

- [ ] **Step 2: Generate migration + hand-add backfill**

Run from `packages/db`: `npx prisma migrate dev --name household_family_m2m_expand --create-only`

Open the generated `migration.sql` and append the backfill AFTER the `CREATE TABLE`/index statements:

```sql
-- Backfill: exactly one link per existing household, from its current FK.
INSERT INTO "HouseholdFamily" ("id", "householdId", "familyGroupId", "linkedAt")
SELECT 'hf_' || "id", "id", "familyGroupId", "createdAt"
FROM "Household";
```

Then apply: `npx prisma migrate dev` and regenerate the client (`npx prisma generate` runs automatically).

- [ ] **Step 3: Merge-engine logical columns**

In `apps/api/src/lib/personIdentity.ts`, find the logical/no-FK person-column map used by `mergePersons` (the list containing `{ table: "HouseholdMember", otherCols: ["householdId"] }` near line 58) and add entries following the exact existing entry shape for:
- `HouseholdFamily.linkedByPersonId`
- `HouseholdAuditEntry.actorPersonId`

Read the surrounding code first — mirror how other nullable logical person-columns are registered (e.g. how `AssistantMessage.personId` or `EventPhoto.uploadedById` entries look), including whether they use a dedupe key.

- [ ] **Step 3b: Creation dual-write + LINKED audit (council round-1 finding)**

In `apps/api/src/routes/families.ts` `POST /:familyId/households` (~line 347), wrap creation in
a transaction that keeps the FK write and adds the link + audit entry:

```ts
const household = await db.$transaction(async (tx) => {
  const h = await tx.household.create({
    data: { familyGroupId, name: d.name, street: d.street, city: d.city, state: d.state, zip: d.zip, country: d.country }
  });
  await tx.householdFamily.create({
    data: { householdId: h.id, familyGroupId, linkedByPersonId: requester.id }
  });
  await tx.householdAuditEntry.create({
    data: { householdId: h.id, actorPersonId: requester.id, actorFamilyGroupId: familyGroupId, action: "LINKED" }
  });
  return h;
});
```

(Adapt variable names to the handler's actual locals; response shape unchanged in this task.)
Extend `families.test.ts`: creating a household also creates exactly one `HouseholdFamily` row
(`linkedByPersonId` = requester) and one `LINKED` audit entry.

- [ ] **Step 3c: Backfill verification script**

Create `apps/api/src/scripts/verifyHouseholdBackfill.ts` (read-only; the backfill SQL can't run
under vitest — this is its prod verification, run after deploy):

```ts
import { db } from "@famlink/db";

/**
 * Run IMMEDIATELY after the expand migration, before any new links are created:
 * at that moment the backfill invariant is exactly-one-link-per-household, so
 * BOTH checks must hold (later, multi-links legitimately make totalLinks > households).
 */
async function main() {
  const households = await db.household.count();
  const linked = await db.household.count({ where: { families: { some: {} } } });
  const links = await db.householdFamily.count();
  console.log(JSON.stringify({ households, householdsWithAtLeastOneLink: linked, totalLinks: links }));
  let failed = false;
  if (linked !== households) {
    const orphans = await db.household.findMany({ where: { families: { none: {} } }, select: { id: true } });
    console.error(`ORPHANS (no link): ${orphans.map((o) => o.id).join(", ")}`);
    failed = true;
  }
  if (links !== households) {
    console.error(`COUNT MISMATCH: expected exactly one link per household post-backfill (households=${households}, links=${links})`);
    failed = true;
  }
  if (failed) process.exit(1);
}

main().finally(() => db.$disconnect());
```

- [ ] **Step 4: Write the failing test**

`apps/api/src/__tests__/lib/householdFamily.test.ts` (real test DB; mirror the fixture style of `apps/api/src/__tests__/lib/smsConsent.test.ts`, and register any new-table truncation the same way that suite's tables are registered in the test setup — check `apps/api/src/__tests__/setup/afterEach.ts`):

```ts
import { db } from "@famlink/db";

describe("HouseholdFamily schema", () => {
  it("creating a household with a link and reading it back through both relations", async () => {
    const creator = await db.person.create({ data: { firstName: "Ann", lastName: "Admin" } });
    const family = await db.familyGroup.create({ data: { name: "Fam", createdById: creator.id } });
    const household = await db.household.create({
      data: { familyGroupId: family.id, name: "Home" }
    });
    await db.householdFamily.create({
      data: { householdId: household.id, familyGroupId: family.id, linkedByPersonId: creator.id }
    });

    const viaHousehold = await db.household.findUnique({
      where: { id: household.id },
      include: { families: { include: { familyGroup: { select: { id: true, name: true } } } } }
    });
    expect(viaHousehold?.families).toHaveLength(1);
    expect(viaHousehold?.families[0]?.familyGroup.name).toBe("Fam");

    const viaFamily = await db.familyGroup.findUnique({
      where: { id: family.id },
      include: { householdLinks: true }
    });
    expect(viaFamily?.householdLinks.map((l) => l.householdId)).toEqual([household.id]);
  });

  it("duplicate link is rejected by the unique constraint", async () => {
    const creator = await db.person.create({ data: { firstName: "Ann", lastName: "Admin" } });
    const family = await db.familyGroup.create({ data: { name: "Fam", createdById: creator.id } });
    const household = await db.household.create({ data: { familyGroupId: family.id, name: "Home" } });
    await db.householdFamily.create({ data: { householdId: household.id, familyGroupId: family.id } });
    await expect(
      db.householdFamily.create({ data: { householdId: household.id, familyGroupId: family.id } })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("audit entries append and read back newest-first", async () => {
    const creator = await db.person.create({ data: { firstName: "Ann", lastName: "Admin" } });
    const family = await db.familyGroup.create({ data: { name: "Fam", createdById: creator.id } });
    const household = await db.household.create({ data: { familyGroupId: family.id, name: "Home" } });
    await db.householdAuditEntry.create({
      data: {
        householdId: household.id, actorPersonId: creator.id, actorFamilyGroupId: family.id,
        action: "LINKED", createdAt: new Date(Date.now() - 60_000)
      }
    });
    await db.householdAuditEntry.create({
      data: {
        householdId: household.id, actorPersonId: creator.id, actorFamilyGroupId: family.id,
        action: "UPDATED", changes: { name: { from: "Home", to: "New Home" } }
      }
    });
    const rows = await db.householdAuditEntry.findMany({
      where: { householdId: household.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }] // stable secondary key — same ordering the audit route uses
    });
    expect(rows.map((r) => r.action)).toEqual(["UPDATED", "LINKED"]);
  });
});
```

- [ ] **Step 5: Run to verify RED then GREEN**

Before applying the migration the test fails (`householdFamily` not on the client). After Step 2 it passes:
Run from `apps/api`: `npx vitest run src/__tests__/lib/householdFamily.test.ts`
Expected: PASS 3/3. (If the test DB predates the migration, the vitest setup applies pending migrations — check how the suite provisions `TEST_DATABASE_URL` and follow it.)

- [ ] **Step 6: Verify + commit**

`npm run lint && npm run type-check` from repo root — both clean (nothing existing reads the new tables yet; `familyGroupId` still exists so nothing breaks). `mcp__gitnexus__detect_changes()` — expected scope: schema, `personIdentity`, `families.ts` household creation, the new verification script, and tests.

```bash
git add packages/db/prisma apps/api/src/lib/personIdentity.ts apps/api/src/routes/families.ts apps/api/src/scripts/verifyHouseholdBackfill.ts apps/api/src/__tests__
git commit -m "feat: P3-04 HouseholdFamily M2M join + audit tables, backfill, creation dual-write, merge-map entries"
```

---

### Task 2: `householdAccess` authorization helpers

**Files:**
- Create: `apps/api/src/lib/householdAccess.ts`
- Test: `apps/api/src/__tests__/lib/householdAccess.test.ts`

**Interfaces:**
- Consumes: `HouseholdFamily` (Task 1), `hasAdminRole` from `lib/familyAccess.ts`.
- Produces (Tasks 3–4 rely on):
  - `householdViewer(householdId: string, personId: string): Promise<boolean>`
  - `householdAdmin(householdId: string, personId: string): Promise<boolean>`
  - `linkedFamilies(householdId: string, viewerPersonId: string): Promise<{ id?: string; name: string }[]>` — `id` only for the viewer's own families (confirm the FamilyGroup→FamilyMember relation field name in `schema.prisma` — likely `members` — and adjust the include)
  - `writeHouseholdAudit(tx, entry: { householdId: string; actorPersonId: string; actorFamilyGroupId: string; action: "UPDATED" | "LINKED" | "UNLINKED" | "RESIDENT_ADDED" | "RESIDENT_REMOVED" | "DESTROYED"; changes?: Record<string, { from: unknown; to: unknown }> }): Promise<void>` where `tx` is a Prisma transaction client (`Prisma.TransactionClient`).

- [ ] **Step 1: Write the failing tests**

```ts
import { db } from "@famlink/db";
import { householdViewer, householdAdmin, linkedFamilies } from "../../lib/householdAccess";

async function fixture() {
  const adminA = await db.person.create({ data: { firstName: "Ada", lastName: "A" } });
  const memberA = await db.person.create({ data: { firstName: "Mia", lastName: "A" } });
  const adminB = await db.person.create({ data: { firstName: "Bob", lastName: "B" } });
  const outsider = await db.person.create({ data: { firstName: "Out", lastName: "Sider" } });
  const famA = await db.familyGroup.create({ data: { name: "Alpha", createdById: adminA.id } });
  const famB = await db.familyGroup.create({ data: { name: "Beta", createdById: adminB.id } });
  await db.familyMember.create({ data: { familyGroupId: famA.id, personId: adminA.id, roles: ["ADMIN"] } });
  await db.familyMember.create({ data: { familyGroupId: famA.id, personId: memberA.id, roles: [] } });
  await db.familyMember.create({ data: { familyGroupId: famB.id, personId: adminB.id, roles: ["ADMIN"] } });
  const household = await db.household.create({ data: { familyGroupId: famA.id, name: "Shared Home" } });
  await db.householdFamily.create({ data: { householdId: household.id, familyGroupId: famA.id } });
  await db.householdFamily.create({ data: { householdId: household.id, familyGroupId: famB.id } });
  return { adminA, memberA, adminB, outsider, famA, famB, household };
}

describe("householdAccess", () => {
  it("viewer: member of ANY linked family; not outsiders", async () => {
    const f = await fixture();
    expect(await householdViewer(f.household.id, f.memberA.id)).toBe(true);
    expect(await householdViewer(f.household.id, f.adminB.id)).toBe(true);
    expect(await householdViewer(f.household.id, f.outsider.id)).toBe(false);
  });

  it("admin: admin of ANY linked family; plain members are not admins", async () => {
    const f = await fixture();
    expect(await householdAdmin(f.household.id, f.adminA.id)).toBe(true);
    expect(await householdAdmin(f.household.id, f.adminB.id)).toBe(true);
    expect(await householdAdmin(f.household.id, f.memberA.id)).toBe(false);
    expect(await householdAdmin(f.household.id, f.outsider.id)).toBe(false);
  });

  it("suspended membership grants nothing", async () => {
    const f = await fixture();
    await db.familyMember.update({
      where: { familyGroupId_personId: { familyGroupId: f.famB.id, personId: f.adminB.id } },
      data: { suspendedAt: new Date() }
    });
    expect(await householdViewer(f.household.id, f.adminB.id)).toBe(false);
    expect(await householdAdmin(f.household.id, f.adminB.id)).toBe(false);
  });

  it("linkedFamilies: every linked family's NAME; ids only for the viewer's own families", async () => {
    const f = await fixture();
    const forMemberA = await linkedFamilies(f.household.id, f.memberA.id);
    expect(forMemberA.map((x) => x.name).sort()).toEqual(["Alpha", "Beta"]);
    const alpha = forMemberA.find((x) => x.name === "Alpha");
    const beta = forMemberA.find((x) => x.name === "Beta");
    expect(alpha?.id).toBe(f.famA.id);          // memberA belongs to Alpha → id present
    expect(beta?.id).toBeUndefined();           // memberA is NOT in Beta → no foreign family id (invariant 1)
    expect(Object.keys(beta ?? {})).toEqual(["name"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/__tests__/lib/householdAccess.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/api/src/lib/householdAccess.ts`:

```ts
import { db, type Prisma } from "@famlink/db";
import { hasAdminRole } from "./familyAccess";

/** Membership row (active, non-suspended) in any family linked to the household, or null. */
async function anyLinkedMembership(householdId: string, personId: string) {
  return db.familyMember.findFirst({
    where: {
      personId,
      suspendedAt: null,
      familyGroup: { householdLinks: { some: { householdId } } }
    }
  });
}

export async function householdViewer(householdId: string, personId: string): Promise<boolean> {
  return (await anyLinkedMembership(householdId, personId)) !== null;
}

export async function householdAdmin(householdId: string, personId: string): Promise<boolean> {
  const memberships = await db.familyMember.findMany({
    where: {
      personId,
      suspendedAt: null,
      familyGroup: { householdLinks: { some: { householdId } } }
    }
  });
  return memberships.some((m) => hasAdminRole(m));
}

/**
 * Names of linked families are consented-visible across a link; the id is included ONLY
 * for families the viewer is an active member of (spec §7 invariant 1 — no foreign family
 * ids; unlink, the only id-consuming call, always targets the caller's own family).
 * Amended 2026-07-14 (council round 1).
 */
export async function linkedFamilies(
  householdId: string,
  viewerPersonId: string
): Promise<{ id?: string; name: string }[]> {
  const links = await db.householdFamily.findMany({
    where: { householdId },
    include: {
      familyGroup: {
        select: {
          id: true,
          name: true,
          members: { where: { personId: viewerPersonId, suspendedAt: null }, select: { id: true } }
        }
      }
    },
    orderBy: [{ linkedAt: "asc" }, { id: "asc" }] // stable secondary order
  });
  return links.map((l) =>
    l.familyGroup.members.length > 0
      ? { id: l.familyGroup.id, name: l.familyGroup.name }
      : { name: l.familyGroup.name }
  );
}

export type HouseholdAuditAction =
  | "UPDATED" | "LINKED" | "UNLINKED" | "RESIDENT_ADDED" | "RESIDENT_REMOVED" | "DESTROYED";

export async function writeHouseholdAudit(
  tx: Prisma.TransactionClient,
  entry: {
    householdId: string;
    actorPersonId: string;
    actorFamilyGroupId: string;
    action: HouseholdAuditAction;
    changes?: Record<string, { from: unknown; to: unknown }>;
  }
): Promise<void> {
  await tx.householdAuditEntry.create({
    data: {
      householdId: entry.householdId,
      actorPersonId: entry.actorPersonId,
      actorFamilyGroupId: entry.actorFamilyGroupId,
      action: entry.action,
      changes: entry.changes as Prisma.InputJsonValue | undefined
    }
  });
}
```

Note: before implementing, read `lib/familyAccess.ts` to confirm `hasAdminRole`'s exact membership-row parameter shape and adjust the `findMany` selection if it needs specific fields.

- [ ] **Step 4: Run to verify it passes** — same command → PASS 4/4.

- [ ] **Step 5: Verify + commit**

`npm run lint && npm run type-check`. `mcp__gitnexus__detect_changes()`.

```bash
git add apps/api/src/lib/householdAccess.ts apps/api/src/__tests__/lib/householdAccess.test.ts
git commit -m "feat: P3-04 householdAccess helpers (any-linked-family viewer/admin + audit writer)"
```

---

### Task 3: Rework household routes — new authz, audit, GET, unlink, audit log

**Files:**
- Modify: `apps/api/src/routes/households.ts` (all handlers)
- Test: `apps/api/src/__tests__/routes/households.test.ts` (extend the existing file; read it first and keep its fixture/auth conventions)

**Interfaces:**
- Consumes: Task 2's `householdViewer`/`householdAdmin`/`linkedFamilies`/`writeHouseholdAudit`; existing `personed` middleware.
- Produces (web/PR-3 rely on):
  - `GET /households/:householdId` → `{ id, name, street, city, state, zip, country, createdAt, updatedAt, linkedFamilies: [{id?, name}], members: [{ id, personId, role, joinedAt, displayName }] }` — `linkedFamilies[].id` present only for the viewer's own families (Task 2 shape)
  - `PUT /households/:householdId` → same shape as GET (no `familyGroupId` field anymore)
  - `POST /households/:householdId/unlink` `{ familyGroupId, destroy?: boolean }` → 204; last link without destroy → `409 { error: "LAST_LINK" }`
  - `GET /households/:householdId/audit` → `{ entries: [{ id, actorPersonId, actorFamilyGroupId, action, changes, createdAt }] }`

(Verb note: spec §6.1 was amended 2026-07-14 to `PUT` — the existing route verb, whose handler already implements partial-update semantics via `UpdateHouseholdSchema.partial()`.)

Behavior changes, exhaustively:
1. **PUT**: authz `householdAdmin`; wrap update + `writeHouseholdAudit` in `db.$transaction`; `changes` = field-level diff of the fields actually modified (compare loaded row to parsed body, only keys present in the body and different); `action: "UPDATED"`; `actorFamilyGroupId` = the requester's admin membership family among the linked ones (first match). Response drops `familyGroupId`, adds `linkedFamilies`.
2. **POST /:id/members**: requester rule becomes `householdAdmin`; the "person must be a member of the family" check becomes *person must be an active member of ANY linked family* (`anyLinkedMembership` semantics — implement via `db.familyMember.findFirst({ where: { personId: body.personId, suspendedAt: null, familyGroup: { householdLinks: { some: { householdId } } } } })`). Audit `RESIDENT_ADDED` in the same transaction.
3. **DELETE /:id/members/:personId**: requester rule: self-removal stays; otherwise `householdAdmin`. Audit `RESIDENT_REMOVED` for ALL removals, actor = requester. **`actorFamilyGroupId` for self-removal by a plain member:** use the requester's first active membership among the linked families (the `anyLinkedMembership` query — NOT `actorAdminFamily`, which returns null for non-admins and would break self-removal; council round-2 BLOCKER). For admin-performed removals, `actorAdminFamily` as elsewhere.
4. **NEW GET /:id**: authz `householdViewer`; include `linkedFamilies` + members with `displayName` (use the existing display-name builder the repo uses — grep `buildDisplayName`); members' display names only, no family memberships of residents (invariant 1).
5. **NEW POST /:id/unlink**: authz = admin **of the family being unlinked** (requester must hold an admin membership in `body.familyGroupId` itself, not just any linked family — check with `activeFamilyMembership(body.familyGroupId, requester.id)` + `hasAdminRole`); count links; if 1 and `!destroy` → `409 LAST_LINK`; if `destroy` → transaction: audit `DESTROYED` then delete household (cascades take `HouseholdMember` + `HouseholdFamily`; `HouseholdAuditEntry` rows persist by design). Otherwise transaction: delete the link + audit `UNLINKED`.
6. **NEW GET /:id/audit**: authz `householdAdmin`; entries newest-first.

- [ ] **Step 1: Write the failing tests** — extend `households.test.ts` with (fixture: two families linked to one household, as in Task 2's fixture, built with the file's existing auth-token helpers):

One fully-worked example (adapt the request/auth helper names to the file's existing conventions after reading it — the assertions are the contract):

```ts
it("unlink the last link without destroy: 409 LAST_LINK, nothing deleted", async () => {
  const f = await fixture(); // single-linked household variant: one family, one link
  const res = await authedRequest(app, f.adminA) // whatever the file's auth pattern is
    .post(`/api/v1/households/${f.household.id}/unlink`)
    .send({ familyGroupId: f.famA.id });
  expect(res.status).toBe(409);
  expect(res.body.error).toBe("LAST_LINK");
  expect(await db.household.findUnique({ where: { id: f.household.id } })).not.toBeNull();
  expect(await db.householdFamily.count({ where: { householdId: f.household.id } })).toBe(1);
});
```

```ts
// Remaining cases to add — each with a complete body asserting status code AND resulting DB state
// (link rows, audit rows, household existence), in the style of the example above:
it("GET household returns linkedFamilies names and members to a member of the second family");
it("GET household is 403 for a non-member of every linked family");
it("PUT by second family's admin succeeds and writes an UPDATED audit entry with a field diff");
it("PUT by a plain member is 403");
it("POST members accepts a person who is member of the OTHER linked family");
it("unlink one of two links: 204, link gone, UNLINKED audit entry, household survives");
it("unlink the last link without destroy: 409 LAST_LINK, nothing deleted");
it("unlink last link with destroy:true: 204, household + members gone, DESTROYED audit entry persists");
it("unlink requires admin of the named family itself (admin of the OTHER family is 403)");
it("GET audit returns entries newest-first to any linked family's admin, 403 to plain members");
it("invariant-1 leak regression: GET household response for a cross-family viewer contains EXACTLY the whitelisted keys — deep-check: top-level [id,name,street,city,state,zip,country,createdAt,updatedAt,linkedFamilies,members]; linkedFamilies rows only [name] (foreign) or [id,name] (own); member rows only [id,personId,role,joinedAt,displayName] — no family memberships, rosters, or foreign ids anywhere");
it("audit history persists after destroy (append-only): DESTROYED entry readable-by-DB after the household row is gone");
```

Write each as a full test with real assertions on DB state (audit rows, link rows, household existence) — the pattern above is the case list, not the implementation; every `it` must contain a complete body asserting status code AND the resulting DB state.

- [ ] **Step 2: Run to verify the new cases fail** — `npx vitest run src/__tests__/routes/households.test.ts` (new cases FAIL: 404s on missing routes, wrong authz on existing ones; pre-existing cases that encode the OLD single-family rule must be UPDATED in this step to the new rule, not deleted — keep their scenarios, fix their expectations).

- [ ] **Step 3: Implement** — rework `routes/households.ts` per the behavior list. Shape for the transaction in PUT:

```ts
const before = await db.household.findUnique({ where: { id: householdId } });
// ... authz via householdAdmin ...
const changes: Record<string, { from: unknown; to: unknown }> = {};
for (const key of ["name", "street", "city", "state", "zip", "country"] as const) {
  if (d[key] !== undefined && d[key] !== before[key]) changes[key] = { from: before[key], to: d[key] };
}
// No-op guard (council round-2 BLOCKER): if nothing actually changes, skip the update
// entirely — otherwise Prisma advances updatedAt, an unaudited mutation.
if (Object.keys(changes).length === 0) {
  return res.json(/* current row, same response shape */);
}
const updated = await db.$transaction(async (tx) => {
  const u = await tx.household.update({ where: { id: householdId }, data: { /* same spread as today */ } });
  await writeHouseholdAudit(tx, { householdId, actorPersonId: requester.id, actorFamilyGroupId, action: "UPDATED", changes });
  return u;
});
```

`actorFamilyGroupId` resolution (used by PUT/members/destroy): fetch **all** the requester's
active linked memberships and pick the first that passes `hasAdminRole` — a `findFirst` by
join date can land on a non-admin membership and wrongly reject a legitimate admin (council
round-1 BLOCKER):

```ts
async function actorAdminFamily(householdId: string, personId: string): Promise<string | null> {
  const memberships = await db.familyMember.findMany({
    where: { personId, suspendedAt: null, familyGroup: { householdLinks: { some: { householdId } } } },
    orderBy: { joinedAt: "asc" }
  });
  const admin = memberships.find((m) => hasAdminRole(m));
  return admin ? admin.familyGroupId : null;
}
```

(For unlink, `actorFamilyGroupId` is simply `body.familyGroupId`.)

**Unlink handler — two hard requirements (council round-1 BLOCKERs):**

1. **Verify the named link exists before anything else.** After the admin check on
   `body.familyGroupId`, load the exact `HouseholdFamily` row
   (`householdId_familyGroupId` unique); missing → `404 { error: "Link not found" }`.
   Without this, an admin of an unrelated family could pass `destroy: true` with their own
   family id against a single-linked household and delete another tenant's household.
2. **Serialize the min-1 check.** Count-then-delete races: two concurrent unlinks on a
   two-link household can both observe count 2 and leave the household tenantless. Lock the
   household row first, inside the transaction:

```ts
await db.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT "id" FROM "Household" WHERE "id" = ${householdId} FOR UPDATE`;
  const link = await tx.householdFamily.findUnique({
    where: { householdId_familyGroupId: { householdId, familyGroupId: body.familyGroupId } }
  });
  if (!link) throw new LinkNotFound(); // handler maps to 404
  const count = await tx.householdFamily.count({ where: { householdId } });
  if (count === 1 && !body.destroy) throw new LastLink(); // handler maps to 409 LAST_LINK
  if (count === 1 && body.destroy) {
    await writeHouseholdAudit(tx, { householdId, actorPersonId: requester.id, actorFamilyGroupId: body.familyGroupId, action: "DESTROYED" });
    await tx.household.delete({ where: { id: householdId } }); // cascades HouseholdMember + HouseholdFamily; audit rows persist
    return;
  }
  await tx.householdFamily.delete({ where: { id: link.id } });
  await writeHouseholdAudit(tx, { householdId, actorPersonId: requester.id, actorFamilyGroupId: body.familyGroupId, action: "UNLINKED" });
});
```

(`LinkNotFound`/`LastLink` are two local `class X extends Error {}` markers caught around the
transaction — follow however the file already maps thrown errors to responses; if it doesn't,
a simple try/catch with `instanceof` is fine.)

- [ ] **Step 4: Run to verify all pass** — full file: `npx vitest run src/__tests__/routes/households.test.ts` → PASS.

- [ ] **Step 5: Verify + commit**

`npm run lint && npm run type-check`. Impact + detect_changes per Global Constraints.

```bash
git add apps/api/src/routes/households.ts apps/api/src/__tests__/routes/households.test.ts
git commit -m "feat: P3-04 household routes on any-linked-family authz + audit + unlink/destroy"
```

---

### Task 4: Family-side creation/read via join table + eventVisibility tightening + aiTools

**Files:**
- Modify: `apps/api/src/routes/families.ts` (`POST /:familyId/households` ~line 315; family GET's `households` include/mapping ~lines 398–431)
- Modify: `apps/api/src/lib/eventVisibility.ts` (`householdIdsForPerson`, callers of it inside the file)
- Modify: `apps/api/src/lib/aiTools.ts` (`get_household_members` ~line 369)
- Test: `apps/api/src/__tests__/routes/families.test.ts` (extend), `apps/api/src/__tests__/lib/eventVisibility.test.ts` (extend or create — check if it exists), `apps/api/src/__tests__/lib/aiTools.test.ts` (extend)

**Interfaces:**
- Consumes: `HouseholdFamily` model; Task 2 helpers not required here (family-scoped paths keep family-scoped authz).
- Produces: `householdIdsForPerson(personId: string, familyGroupId: string): Promise<string[]>` — new second parameter; only households BOTH containing the person AND linked to that family.

Behavior changes, exhaustively:
1. *(moved to Task 1 — creation dual-write + link + `LINKED` audit already landed there; this task only changes the creation RESPONSE shape: replace `familyGroupId` with `linkedFamilies` per Task 3's viewer-scoped shape.)*
2. **Family GET `households`**: switch the include to `householdLinks: { include: { household: { include: { members: ... } } } }` (mirror whatever the current nested include selects) and map `family.householdLinks.map((link) => ({ household: { ...same fields as today minus familyGroupId } }))` — the outer response shape (`households: [{ household: {...} }]`) stays identical minus the dropped field.
3. **`eventVisibility.householdIdsForPerson`** gains `familyGroupId` and enforces invariant 3
by requiring the **viewer's own active membership in the event's family** — NOT merely that
the household is linked to it (a shared household is linked to both families, so a
link-based filter would pass in exactly the leak scenario; council round-1 BLOCKER):

```ts
/**
 * Household-invite visibility requires the viewer to be an active member of the
 * event's family (spec §7 invariant 3). A household shared with another family
 * must not surface this family's events to residents who aren't members here.
 */
async function householdIdsForPerson(personId: string, familyGroupId: string): Promise<string[]> {
  const membership = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId, personId } }
  });
  if (!membership || membership.suspendedAt !== null) return [];
  const rows = await db.householdMember.findMany({
    where: { personId, household: { families: { some: { familyGroupId } } } },
    select: { householdId: true }
  });
  return rows.map((r) => r.householdId);
}
```

`visibleEventsWhere(personId, isAdmin)` gains a `familyGroupId` parameter (`visibleEventsWhere(personId, isAdmin, familyGroupId)`) and passes it through; `canViewEvent` reads it from a new required `familyGroupId` field on its `event` parameter object. **Update every call site**: grep `visibleEventsWhere|canViewEvent` across `apps/api/src` (known: `routes/calendar.ts`, `routes/events.ts`, `lib/aiContext.ts`, `lib/aiTools.ts`) — each already holds the family scope; pass it. Run `mcp__gitnexus__impact({target: "visibleEventsWhere", direction: "upstream"})` first and confirm the call-site list matches (LOW risk, 3 direct callers as of planning).
4. **`aiTools.get_household_members`**: `db.household.findFirst({ where: { id: householdId, familyGroupId } })` → `db.household.findFirst({ where: { id: householdId, families: { some: { familyGroupId } } } })`. (Tool stays scoped to the assistant's family context — a household linked to the family is in scope; residents from other families are visible by name per invariant 1, and the existing `ageGateLevel` CHILD filter stays.)

- [ ] **Step 1: Write the failing isolation tests** — the spec §7 invariant-3 regression pack, in `eventVisibility.test.ts`:

```ts
import { db } from "@famlink/db";
import { canViewEvent, visibleEventsWhere } from "../../lib/eventVisibility";

async function crossFamilyFixture() {
  const adminA = await db.person.create({ data: { firstName: "Ada", lastName: "A" } });
  const bMember = await db.person.create({ data: { firstName: "Ben", lastName: "B" } });
  const famA = await db.familyGroup.create({ data: { name: "Alpha", createdById: adminA.id } });
  const famB = await db.familyGroup.create({ data: { name: "Beta", createdById: bMember.id } });
  await db.familyMember.create({ data: { familyGroupId: famA.id, personId: adminA.id, roles: ["ADMIN"] } });
  await db.familyMember.create({ data: { familyGroupId: famB.id, personId: bMember.id, roles: [] } });
  // household linked to BOTH families; Ben lives in it but is NOT a member of family A
  const household = await db.household.create({ data: { familyGroupId: famA.id, name: "Shared" } });
  await db.householdFamily.create({ data: { householdId: household.id, familyGroupId: famA.id } });
  await db.householdFamily.create({ data: { householdId: household.id, familyGroupId: famB.id } });
  await db.householdMember.create({ data: { householdId: household.id, personId: bMember.id } });
  // PRIVATE event in family A with a HOUSEHOLD-scope invitation to the shared household
  const event = await db.event.create({
    data: {
      familyGroupId: famA.id, createdByPersonId: adminA.id, title: "A-only planning",
      startAt: new Date(Date.now() + 86_400_000), eventVisibility: "PRIVATE"
    }
  });
  await db.eventInvitation.create({
    data: { eventId: event.id, householdId: household.id, scope: "HOUSEHOLD" }
  });
  return { adminA, bMember, famA, famB, household, event };
}

describe("household-scope visibility under M2M (spec §7 invariant 3)", () => {
  it("a resident who is NOT a member of the event's family cannot see the PRIVATE event", async () => {
    const f = await crossFamilyFixture();
    const visible = await canViewEvent(
      { id: f.event.id, eventVisibility: "PRIVATE", createdByPersonId: f.adminA.id, familyGroupId: f.famA.id },
      f.bMember.id,
      false
    );
    expect(visible).toBe(false);
  });

  it("a resident who IS a member of the event's family still sees it via the household invite", async () => {
    const f = await crossFamilyFixture();
    await db.familyMember.create({ data: { familyGroupId: f.famA.id, personId: f.bMember.id, roles: [] } });
    const visible = await canViewEvent(
      { id: f.event.id, eventVisibility: "PRIVATE", createdByPersonId: f.adminA.id, familyGroupId: f.famA.id },
      f.bMember.id,
      false
    );
    expect(visible).toBe(true);
  });

  it("visibleEventsWhere scoped to family A excludes the event for the cross-family resident", async () => {
    const f = await crossFamilyFixture();
    const where = await visibleEventsWhere(f.bMember.id, false, f.famA.id);
    const hits = await db.event.findMany({ where: { familyGroupId: f.famA.id, ...where } });
    expect(hits.map((e) => e.id)).not.toContain(f.event.id);
  });

  it("spec §7 invariant 2: a shared household with NO invitation grants no visibility at all", async () => {
    const f = await crossFamilyFixture();
    await db.eventInvitation.deleteMany({ where: { eventId: f.event.id } });
    const visible = await canViewEvent(
      { id: f.event.id, eventVisibility: "PRIVATE", createdByPersonId: f.adminA.id, familyGroupId: f.famA.id },
      f.bMember.id,
      false
    );
    expect(visible).toBe(false);
  });
});
```

Also add to `families.test.ts`: creation writes both the FK (transitional) and the link row; family GET returns the household through the join with the same outer shape. Also extend `aiTools.test.ts`: `get_household_members` finds a household via the join and returns residents' summaries; a household NOT linked to the family returns `[]`.

- [ ] **Step 2: Run to verify RED** — the invariant-3 test 1 FAILS against the current code (resident sees the event via the untightened filter); others fail on the missing parameter/shape.

- [ ] **Step 3: Implement** items 1–4 above.

- [ ] **Step 4: Run to verify GREEN** — `npx vitest run src/__tests__/lib/eventVisibility.test.ts src/__tests__/routes/families.test.ts src/__tests__/lib/aiTools.test.ts src/__tests__/routes/events.test.ts src/__tests__/routes/calendar.test.ts` (the last two are regression for the call-site changes; check the exact calendar test filename with `ls src/__tests__/routes/`). Expected: PASS.

- [ ] **Step 5: Verify + commit**

`npm run lint && npm run type-check`. Impact + detect_changes per Global Constraints.

```bash
git add apps/api/src/routes/families.ts apps/api/src/lib/eventVisibility.ts apps/api/src/lib/aiTools.ts apps/api/src/__tests__
git commit -m "feat: P3-04 family-scoped household reads/creation via join table + household-invite visibility tightening"
```

---

### Task 5: Contract — drop `Household.familyGroupId`, update web types, full verification

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (drop `Household.familyGroupId`/`familyGroup`, drop `FamilyGroup.households`)
- Create: `packages/db/prisma/migrations/<timestamp>_household_family_m2m_contract/migration.sql` (generated)
- Modify: whatever `grep -rn "familyGroupId" apps/api/src --include="*.ts" | grep -i household` still finds (expected: only the transitional double-write in `families.ts` from Task 4 item 1, and any lingering `loadHouseholdWithFamily` remnants)
- Modify: `apps/web/lib/api/family.ts` (household response types: drop `familyGroupId`, add `linkedFamilies`), `apps/web/app/(protected)/family/[familyId]/page.tsx` (if it renders the dropped field — check), `apps/web/app/onboarding/steps/HouseholdStep.tsx` (uses the URL only — expected no change; verify)
- Test: existing suites (regression)

- [ ] **Step 1: Remove transitional writes/reads** — delete the Task-1 double-write of `familyGroupId` in `families.ts` household creation (keep the link + audit writes); remove `familyGroup`/`familyGroupId` from any remaining household include/select in `apps/api/src`.

- [ ] **Step 2: Schema contract + migration** — remove `familyGroupId`, `familyGroup` from `model Household`; remove `households Household[]` from `model FamilyGroup`. From `packages/db`: `npx prisma migrate dev --name household_family_m2m_contract`. Generated SQL should be exactly a `DROP COLUMN` (plus its FK/index) — inspect it; anything else means a schema edit went wrong.

- [ ] **Step 3: Fix compile fallout** — `npm run type-check`; fix every error (test fixtures across the suite that pass `familyGroupId` when creating households must switch to `families: { create: { familyGroupId } }` nested writes or a create-then-link pair — update the Task 1/2/4 fixtures in this plan's own test files the same way).

- [ ] **Step 4: Web types** — in `apps/web/lib/api/family.ts` update the household shapes (drop `familyGroupId`, add `linkedFamilies?: { id?: string; name: string }[]` — `id` optional: foreign linked families intentionally omit it); adjust the family page render if it referenced the field. Run web suite WITH the coverage gate: from `apps/web`: `npx vitest run --coverage` (NOT `npm test --workspace=famlink-web` alone — it skips the gate; workspace name is `famlink-web`).

- [ ] **Step 5: Full verification**

From repo root:
```bash
npm test --workspace=@famlink/api     # expected: all green (~478 + this PR's new tests)
npm run type-check                    # 6/6 packages
npm run lint                          # 0 errors
git diff --check
```
From `apps/web`: `npx vitest run --coverage` — coverage ≥ 80% lines (baseline 87.29%; if the small `family.ts` type change moves it, cover with a real test, never lower the gate).
Run `mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })` — expected scope: schema, `households`/`families` routes, `eventVisibility`, `aiTools`, `householdAccess`, `personIdentity`, web `family.ts`. Investigate anything outside that list.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma apps/api/src apps/web
git commit -m "feat: P3-04 drop Household.familyGroupId — join table is the only link (contract)"
```

---

## Deploy note (Steve, after merge)

`npx prisma migrate deploy` on Railway prod applies BOTH migrations (expand+backfill, then contract) in order — the backfill runs while the column still exists, so ordering is safe by construction. Then run `npx tsx src/scripts/verifyHouseholdBackfill.ts` (from `apps/api`, against prod `DATABASE_URL`) — it exits non-zero and prints orphan household ids if any household lacks a link. No env changes. Prod data: 3 families / 12 persons; every household ends with exactly one link (today's behavior, unchanged UX).
