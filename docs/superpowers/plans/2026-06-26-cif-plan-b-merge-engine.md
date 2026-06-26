# Contact Identity Foundation — Plan B (Merge Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the merge/claim/reconcile layer so a guest who later signs up becomes one `Person`, without ever fusing two real humans.

**Architecture:** A transactional `mergePersons(canonical, duplicate)` re-points every `Person`-referencing FK (deduping compound-unique collisions) then deletes the duplicate. The Clerk `user.created` webhook, after its existing upsert, selects a single dependent-safe, name-corroborated contact-only match and merges it into the new account `Person`; anything ambiguous is logged for review, never merged. Guest invitation/RSVP history rides along automatically because Plan A already stamps `linkedPersonId`.

**Tech Stack:** TypeScript, Express, Prisma (`@famlink/db`), Vitest + supertest, Clerk webhook (svix). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-26-cif-plan-b-merge-engine-design.md`

## Global Constraints

- **Test runner:** Vitest from `apps/api` (`npx vitest run <path>`). Lib/DB tests hit local Postgres `famlink_test`; route/webhook tests use supertest + `createApp` from `../../server`.
- **Commit format:** `feat: P3-03 <short description>`.
- **`@famlink/db` resolves to compiled `dist/`** — no schema change in this plan, so no rebuild needed; if Prisma client types look stale, run `cd packages/db && npm run build`.
- **Account is always canonical:** merges only ever fuse a contact-only `Person` (`userId: null`) into an account `Person`. `mergePersons` refuses account↔account as defense-in-depth.
- **Dependent-safety gate:** never merge a candidate with `ageGateLevel != "ADULT"` OR `guardianPersonId != null` (a child carrying a guardian's email).
- **Collision rule:** on a compound-unique collision after re-point, keep canonical's row, delete the duplicate's, count it.
- **Observability = structured `console` logs only** (codebase has no logger lib; webhook uses `console`). No new table, no UI.
- **Re-point before delete:** several Person relations are `onDelete: Cascade` (`FamilyMember`, `HouseholdMember`, `NotificationPreference`, `Relationship`, `EventParticipant`), so the duplicate must be fully re-pointed/deduped *before* `person.delete`, or the cascade destroys rows.
- **No phone merge** (phone verification is W3b); **`user.updated` unchanged** (consolidation is signup-only).

---

## File Structure

- **Modify** `apps/api/src/lib/personIdentity.ts` — add `mergePersons`, `nameCorroborates`, `selectMergeableContactPerson` (+ internal `repointCompound`, `repointRelationship`, `COMPOUND_PERSON_TABLES`). Keeps all identity logic in one focused module alongside `findOrCreatePersonByContact`.
- **Create** `apps/api/src/lib/__tests__/personMerge.test.ts` — DB-integration tests for `mergePersons` and `selectMergeableContactPerson`.
- **Modify** `apps/api/src/routes/webhooks.ts` — post-upsert consolidation on `user.created`.
- **Modify** `apps/api/src/__tests__/routes/webhooks.test.ts` — merge / dependent-skip / reconcile cases.

**Authoritative Person-FK set (from `schema.prisma`), handled by `mergePersons`:**
- Self-ref: `Person.guardianPersonId` (wards)
- Non-unique: `FamilyGroup.createdById`; `Event.createdByPersonId`, `Event.birthdayPersonId`; `EventInvitation.personId`, `EventInvitation.linkedPersonId`; `EventItem.createdByPersonId`, `EventItem.assignedToPersonId`; `EventPhoto.personId`
- Compound-unique on `personId`: `FamilyMember[familyGroupId,personId]`, `HouseholdMember[householdId,personId]`, `NotificationPreference[personId,channel,notifType]`, `RSVP[eventId,personId]`, `EventParticipant[eventId,personId]`
- Two-column compound: `Relationship[fromPersonId,toPersonId,familyGroupId,type]`

---

### Task 1: `mergePersons` engine

**Files:**
- Modify: `apps/api/src/lib/personIdentity.ts`
- Test: `apps/api/src/lib/__tests__/personMerge.test.ts` (create)

**Interfaces:**
- Consumes: `db`, `Prisma` (transaction client type) from `@famlink/db`.
- Produces: `mergePersons(canonicalId: string, duplicateId: string, trigger?: string): Promise<void>` — transactional; re-points all Person FKs duplicate→canonical, dedupes compound-unique collisions (keep canonical), deletes the duplicate; no-op when ids equal; throws on missing person or account↔account.

- [ ] **Step 1: Confirm the `Prisma` export**

Run: `cd apps/api && node -e "console.log(typeof require('@famlink/db').Prisma)"`
Expected: `object` (the `Prisma` namespace is re-exported, so `Prisma.TransactionClient` is usable as a type). If it prints `undefined`, instead add `import type { Prisma } from \"@prisma/client\";` in Step 3 rather than importing `Prisma` from `@famlink/db`.

- [ ] **Step 2: Write the failing tests**

Create `apps/api/src/lib/__tests__/personMerge.test.ts`:

```typescript
import { db } from "@famlink/db";
import { describe, it, expect } from "vitest";
import { mergePersons } from "../personIdentity";

async function adult(first: string, last: string, extra: Record<string, unknown> = {}) {
  return db.person.create({
    data: { firstName: first, lastName: last, ageGateLevel: "ADULT", ...extra }
  });
}

describe("mergePersons", () => {
  it("no-ops when canonical and duplicate are the same id", async () => {
    const p = await adult("Same", "Person");
    await expect(mergePersons(p.id, p.id)).resolves.toBeUndefined();
    expect(await db.person.findUnique({ where: { id: p.id } })).not.toBeNull();
  });

  it("re-points a non-unique FK (FamilyGroup.createdById) then deletes the duplicate", async () => {
    const canon = await adult("Canon", "Ical");
    const dup = await adult("Dup", "Licate");
    const fg = await db.familyGroup.create({ data: { name: "Fam", createdById: dup.id } });

    await mergePersons(canon.id, dup.id);

    const after = await db.familyGroup.findUnique({ where: { id: fg.id } });
    expect(after?.createdById).toBe(canon.id);
    expect(await db.person.findUnique({ where: { id: dup.id } })).toBeNull();
  });

  it("re-points a compound-unique row (NotificationPreference) when no collision", async () => {
    const canon = await adult("C", "One");
    const dup = await adult("D", "Two");
    const np = await db.notificationPreference.create({
      data: { personId: dup.id, channel: "email", notifType: "reminder" }
    });
    await mergePersons(canon.id, dup.id);
    const after = await db.notificationPreference.findUnique({ where: { id: np.id } });
    expect(after?.personId).toBe(canon.id);
  });

  it("dedupes a compound-unique collision (keeps canonical, drops duplicate's)", async () => {
    const canon = await adult("C", "Keep");
    const dup = await adult("D", "Drop");
    const canonPref = await db.notificationPreference.create({
      data: { personId: canon.id, channel: "push", notifType: "birthday" }
    });
    const dupPref = await db.notificationPreference.create({
      data: { personId: dup.id, channel: "push", notifType: "birthday" }
    });
    await mergePersons(canon.id, dup.id);
    expect(await db.notificationPreference.findUnique({ where: { id: canonPref.id } })).not.toBeNull();
    expect(await db.notificationPreference.findUnique({ where: { id: dupPref.id } })).toBeNull();
  });

  it("re-points a Relationship and drops one that would become self-referential", async () => {
    const canon = await adult("C", "Rel");
    const dup = await adult("D", "Rel");
    const other = await adult("O", "Ther");
    const fg = await db.familyGroup.create({ data: { name: "RelFam", createdById: canon.id } });
    const keep = await db.relationship.create({
      data: { fromPersonId: dup.id, toPersonId: other.id, type: "PARENT", familyGroupId: fg.id }
    });
    const selfish = await db.relationship.create({
      data: { fromPersonId: dup.id, toPersonId: canon.id, type: "SIBLING", familyGroupId: fg.id }
    });
    await mergePersons(canon.id, dup.id);
    const keptAfter = await db.relationship.findUnique({ where: { id: keep.id } });
    expect(keptAfter?.fromPersonId).toBe(canon.id);
    expect(await db.relationship.findUnique({ where: { id: selfish.id } })).toBeNull();
  });

  it("refuses to merge two account persons and leaves both intact", async () => {
    const a = await adult("Acc", "One", { userId: `u_a_${Date.now()}` });
    const b = await adult("Acc", "Two", { userId: `u_b_${Date.now()}` });
    await expect(mergePersons(a.id, b.id)).rejects.toThrow();
    expect(await db.person.findUnique({ where: { id: a.id } })).not.toBeNull();
    expect(await db.person.findUnique({ where: { id: b.id } })).not.toBeNull();
  });

  it("leaves the duplicate id referenced nowhere after a multi-relation merge", async () => {
    const canon = await adult("C", "Multi");
    const dup = await adult("D", "Multi");
    const fg = await db.familyGroup.create({ data: { name: "MultiFam", createdById: dup.id } });
    await db.notificationPreference.create({ data: { personId: dup.id, channel: "sms", notifType: "rsvp" } });
    await db.familyMember.create({ data: { familyGroupId: fg.id, personId: dup.id, role: "MEMBER" } });

    await mergePersons(canon.id, dup.id);

    expect(await db.familyGroup.count({ where: { createdById: dup.id } })).toBe(0);
    expect(await db.notificationPreference.count({ where: { personId: dup.id } })).toBe(0);
    expect(await db.familyMember.count({ where: { personId: dup.id } })).toBe(0);
    expect(await db.person.findUnique({ where: { id: dup.id } })).toBeNull();
  });
});
```

> **Note on `FamilyMember.role`:** the fixture above passes `role: "MEMBER"`. If `FamilyMember` has no `role` column or it is non-nullable with a different name, open `schema.prisma`'s `FamilyMember` model and match its required fields exactly before running.

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/lib/__tests__/personMerge.test.ts`
Expected: FAIL — `mergePersons` not exported.

- [ ] **Step 4: Implement `mergePersons`**

In `apps/api/src/lib/personIdentity.ts`, change the top import to include `Prisma`:

```typescript
import { db, Prisma, type Person } from "@famlink/db";
```

(If Step 1 printed `undefined`, instead keep the existing `import { db, type Person }` line and add `import type { Prisma } from "@prisma/client";`.)

Append to the end of the file:

```typescript
const COMPOUND_PERSON_TABLES: ReadonlyArray<{ table: string; otherCols: readonly string[] }> = [
  { table: "FamilyMember", otherCols: ["familyGroupId"] },
  { table: "HouseholdMember", otherCols: ["householdId"] },
  { table: "NotificationPreference", otherCols: ["channel", "notifType"] },
  { table: "RSVP", otherCols: ["eventId"] },
  { table: "EventParticipant", otherCols: ["eventId"] }
];

// table/column names below are module-level constants (never user input), so
// $executeRawUnsafe here carries no injection risk; ids are bound as parameters.
async function repointCompound(
  tx: Prisma.TransactionClient,
  table: string,
  otherCols: readonly string[],
  canonicalId: string,
  duplicateId: string
): Promise<{ repointed: number; dropped: number }> {
  const match = otherCols.map((c) => `c."${c}" = d."${c}"`).join(" AND ");
  const dropped = await tx.$executeRawUnsafe(
    `DELETE FROM "${table}" AS d WHERE d."personId" = $1 AND EXISTS (` +
      `SELECT 1 FROM "${table}" AS c WHERE c."personId" = $2` +
      (match ? ` AND ${match}` : "") +
      `)`,
    duplicateId,
    canonicalId
  );
  const repointed = await tx.$executeRawUnsafe(
    `UPDATE "${table}" SET "personId" = $1 WHERE "personId" = $2`,
    canonicalId,
    duplicateId
  );
  return { repointed, dropped };
}

async function repointRelationship(
  tx: Prisma.TransactionClient,
  canonicalId: string,
  duplicateId: string
): Promise<{ repointed: number; dropped: number }> {
  const selfDropped = await tx.$executeRawUnsafe(
    `DELETE FROM "Relationship" WHERE ` +
      `("fromPersonId" = $1 AND "toPersonId" = $2) OR ` +
      `("fromPersonId" = $2 AND "toPersonId" = $1) OR ` +
      `("fromPersonId" = $1 AND "toPersonId" = $1)`,
    duplicateId,
    canonicalId
  );
  const fromDropped = await tx.$executeRawUnsafe(
    `DELETE FROM "Relationship" AS d WHERE d."fromPersonId" = $1 AND EXISTS (` +
      `SELECT 1 FROM "Relationship" AS c WHERE c."fromPersonId" = $2 ` +
      `AND c."toPersonId" = d."toPersonId" AND c."familyGroupId" = d."familyGroupId" AND c."type" = d."type")`,
    duplicateId,
    canonicalId
  );
  const fromRepointed = await tx.$executeRawUnsafe(
    `UPDATE "Relationship" SET "fromPersonId" = $1 WHERE "fromPersonId" = $2`,
    canonicalId,
    duplicateId
  );
  const toDropped = await tx.$executeRawUnsafe(
    `DELETE FROM "Relationship" AS d WHERE d."toPersonId" = $1 AND EXISTS (` +
      `SELECT 1 FROM "Relationship" AS c WHERE c."toPersonId" = $2 ` +
      `AND c."fromPersonId" = d."fromPersonId" AND c."familyGroupId" = d."familyGroupId" AND c."type" = d."type")`,
    duplicateId,
    canonicalId
  );
  const toRepointed = await tx.$executeRawUnsafe(
    `UPDATE "Relationship" SET "toPersonId" = $1 WHERE "toPersonId" = $2`,
    canonicalId,
    duplicateId
  );
  return {
    repointed: fromRepointed + toRepointed,
    dropped: selfDropped + fromDropped + toDropped
  };
}

export async function mergePersons(
  canonicalId: string,
  duplicateId: string,
  trigger = "unspecified"
): Promise<void> {
  if (canonicalId === duplicateId) return;

  await db.$transaction(async (tx) => {
    const [canonical, duplicate] = await Promise.all([
      tx.person.findUnique({ where: { id: canonicalId } }),
      tx.person.findUnique({ where: { id: duplicateId } })
    ]);
    if (!canonical || !duplicate) {
      throw new Error(
        `mergePersons: person not found (canonical=${canonicalId}, duplicate=${duplicateId})`
      );
    }
    if (canonical.userId && duplicate.userId) {
      console.warn(
        JSON.stringify({
          event: "person_merge_refused",
          reason: "account-account",
          canonicalId,
          duplicateId
        })
      );
      throw new Error("mergePersons: refusing to merge two account persons");
    }

    const repointed: Record<string, number> = {};
    let collisionsDropped = 0;

    // self-ref: duplicate's wards -> canonical (never make a person its own guardian)
    repointed["Person.wards"] = (
      await tx.person.updateMany({
        where: { guardianPersonId: duplicateId, NOT: { id: canonicalId } },
        data: { guardianPersonId: canonicalId }
      })
    ).count;
    if (canonical.guardianPersonId === duplicateId) {
      await tx.person.update({ where: { id: canonicalId }, data: { guardianPersonId: null } });
    }

    // non-unique FK re-points
    const nonUnique: ReadonlyArray<[string, Promise<{ count: number }>]> = [
      ["FamilyGroup.createdById", tx.familyGroup.updateMany({ where: { createdById: duplicateId }, data: { createdById: canonicalId } })],
      ["Event.createdByPersonId", tx.event.updateMany({ where: { createdByPersonId: duplicateId }, data: { createdByPersonId: canonicalId } })],
      ["Event.birthdayPersonId", tx.event.updateMany({ where: { birthdayPersonId: duplicateId }, data: { birthdayPersonId: canonicalId } })],
      ["EventInvitation.personId", tx.eventInvitation.updateMany({ where: { personId: duplicateId }, data: { personId: canonicalId } })],
      ["EventInvitation.linkedPersonId", tx.eventInvitation.updateMany({ where: { linkedPersonId: duplicateId }, data: { linkedPersonId: canonicalId } })],
      ["EventItem.createdByPersonId", tx.eventItem.updateMany({ where: { createdByPersonId: duplicateId }, data: { createdByPersonId: canonicalId } })],
      ["EventItem.assignedToPersonId", tx.eventItem.updateMany({ where: { assignedToPersonId: duplicateId }, data: { assignedToPersonId: canonicalId } })],
      ["EventPhoto.personId", tx.eventPhoto.updateMany({ where: { personId: duplicateId }, data: { personId: canonicalId } })]
    ];
    for (const [label, op] of nonUnique) {
      repointed[label] = (await op).count;
    }

    // compound-unique tables (single personId column): drop colliders, re-point the rest
    for (const { table, otherCols } of COMPOUND_PERSON_TABLES) {
      const r = await repointCompound(tx, table, otherCols, canonicalId, duplicateId);
      repointed[`${table}.personId`] = r.repointed;
      collisionsDropped += r.dropped;
    }

    // Relationship (two person columns + self-ref guard)
    const rel = await repointRelationship(tx, canonicalId, duplicateId);
    repointed["Relationship"] = rel.repointed;
    collisionsDropped += rel.dropped;

    // all references re-pointed/deduped — safe to delete (cascades now have nothing left)
    await tx.person.delete({ where: { id: duplicateId } });

    console.info(
      JSON.stringify({ event: "person_merge", canonicalId, duplicateId, trigger, repointed, collisionsDropped })
    );
  });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/lib/__tests__/personMerge.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors. (If `$executeRawUnsafe` triggers an eslint error rather than warning, add a scoped `// eslint-disable-next-line @typescript-eslint/no-unsafe-...` only on the offending lines; warnings are acceptable.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/personIdentity.ts apps/api/src/lib/__tests__/personMerge.test.ts
git commit -m "feat: P3-03 mergePersons transactional Person merge engine"
```

---

### Task 2: Mergeable-candidate selection + name corroboration

**Files:**
- Modify: `apps/api/src/lib/personIdentity.ts`
- Test: `apps/api/src/lib/__tests__/personMerge.test.ts` (extend)

**Interfaces:**
- Consumes: `db`, `Person`.
- Produces:
  - `nameCorroborates(candidate: { firstName: string; lastName: string }, account: { firstName: string; lastName: string }): boolean` — true if last names match (case-insensitive, non-empty, not the `"-"` placeholder) OR both first and last match.
  - `selectMergeableContactPerson(opts: { emailNormalized: string; accountPersonId: string; firstName: string; lastName: string }): Promise<MergeDecision>` where `MergeDecision = { action: "merge"; person: Person } | { action: "skip"; reason: "no-candidate" | "dependent-only" | "ambiguous" | "name-mismatch" }`. Finds contact-only (`userId: null`) persons with the same `emailNormalized` (excluding the account person); applies the dependent gate; returns `merge` only for a single adult, name-corroborated match.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/lib/__tests__/personMerge.test.ts`:

```typescript
import { nameCorroborates, selectMergeableContactPerson } from "../personIdentity";

describe("nameCorroborates", () => {
  it("matches on last name (case-insensitive)", () => {
    expect(nameCorroborates({ firstName: "Bob", lastName: "Smith" }, { firstName: "Robert", lastName: "smith" })).toBe(true);
  });
  it("matches on full name", () => {
    expect(nameCorroborates({ firstName: "Ann", lastName: "Lee" }, { firstName: "ann", lastName: "lee" })).toBe(true);
  });
  it("does not match on a different surname", () => {
    expect(nameCorroborates({ firstName: "Bob", lastName: "Jones" }, { firstName: "Bob", lastName: "Smith" })).toBe(false);
  });
  it("does not treat the placeholder last name as a match", () => {
    expect(nameCorroborates({ firstName: "X", lastName: "-" }, { firstName: "Y", lastName: "-" })).toBe(false);
  });
});

describe("selectMergeableContactPerson", () => {
  const email = () => `sel_${Date.now()}_${Math.random().toString(36).slice(2)}@x.com`;

  it("returns no-candidate when nobody shares the email", async () => {
    const acct = await db.person.create({ data: { firstName: "A", lastName: "B", ageGateLevel: "ADULT", userId: `u_${Date.now()}` } });
    const d = await selectMergeableContactPerson({ emailNormalized: email(), accountPersonId: acct.id, firstName: "A", lastName: "B" });
    expect(d.action).toBe("skip");
    expect(d).toMatchObject({ reason: "no-candidate" });
  });

  it("merges a single adult contact-only match with a corroborating name", async () => {
    const e = email();
    const guest = await db.person.create({ data: { firstName: "Guest", lastName: "Adams", ageGateLevel: "ADULT", emailNormalized: e } });
    const acct = await db.person.create({ data: { firstName: "Guest", lastName: "Adams", ageGateLevel: "ADULT", emailNormalized: e, emailVerifiedAt: new Date(), userId: `u_${Date.now()}` } });
    const d = await selectMergeableContactPerson({ emailNormalized: e, accountPersonId: acct.id, firstName: "Guest", lastName: "Adams" });
    expect(d).toMatchObject({ action: "merge" });
    if (d.action === "merge") expect(d.person.id).toBe(guest.id);
  });

  it("skips a dependent (non-ADULT or guarded) carrying the email", async () => {
    const e = email();
    const guardian = await db.person.create({ data: { firstName: "Par", lastName: "Ent", ageGateLevel: "ADULT" } });
    await db.person.create({ data: { firstName: "Kid", lastName: "Ent", ageGateLevel: "CHILD", emailNormalized: e, guardianPersonId: guardian.id } });
    const acct = await db.person.create({ data: { firstName: "Par", lastName: "Ent", ageGateLevel: "ADULT", emailNormalized: e, emailVerifiedAt: new Date(), userId: `u_${Date.now()}` } });
    const d = await selectMergeableContactPerson({ emailNormalized: e, accountPersonId: acct.id, firstName: "Par", lastName: "Ent" });
    expect(d).toMatchObject({ action: "skip", reason: "dependent-only" });
  });

  it("skips when multiple adult matches are ambiguous", async () => {
    const e = email();
    await db.person.create({ data: { firstName: "One", lastName: "Z", ageGateLevel: "ADULT", emailNormalized: e } });
    await db.person.create({ data: { firstName: "Two", lastName: "Z", ageGateLevel: "ADULT", emailNormalized: e } });
    const acct = await db.person.create({ data: { firstName: "One", lastName: "Z", ageGateLevel: "ADULT", emailNormalized: e, emailVerifiedAt: new Date(), userId: `u_${Date.now()}` } });
    const d = await selectMergeableContactPerson({ emailNormalized: e, accountPersonId: acct.id, firstName: "One", lastName: "Z" });
    expect(d).toMatchObject({ action: "skip", reason: "ambiguous" });
  });

  it("skips a single match whose name does not corroborate", async () => {
    const e = email();
    await db.person.create({ data: { firstName: "Some", lastName: "Stranger", ageGateLevel: "ADULT", emailNormalized: e } });
    const acct = await db.person.create({ data: { firstName: "Real", lastName: "Owner", ageGateLevel: "ADULT", emailNormalized: e, emailVerifiedAt: new Date(), userId: `u_${Date.now()}` } });
    const d = await selectMergeableContactPerson({ emailNormalized: e, accountPersonId: acct.id, firstName: "Real", lastName: "Owner" });
    expect(d).toMatchObject({ action: "skip", reason: "name-mismatch" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/lib/__tests__/personMerge.test.ts`
Expected: FAIL — `nameCorroborates` / `selectMergeableContactPerson` not exported.

- [ ] **Step 3: Implement**

Append to `apps/api/src/lib/personIdentity.ts`:

```typescript
export function nameCorroborates(
  candidate: { firstName: string; lastName: string },
  account: { firstName: string; lastName: string }
): boolean {
  const norm = (s: string): string => s.trim().toLowerCase();
  const candLast = norm(candidate.lastName);
  const lastMatch = candLast.length > 0 && candLast !== "-" && candLast === norm(account.lastName);
  const fullMatch = norm(candidate.firstName) === norm(account.firstName) && candLast === norm(account.lastName);
  return lastMatch || fullMatch;
}

export type MergeDecision =
  | { action: "merge"; person: Person }
  | { action: "skip"; reason: "no-candidate" | "dependent-only" | "ambiguous" | "name-mismatch" };

export async function selectMergeableContactPerson(opts: {
  emailNormalized: string;
  accountPersonId: string;
  firstName: string;
  lastName: string;
}): Promise<MergeDecision> {
  const candidates = await db.person.findMany({
    where: { emailNormalized: opts.emailNormalized, userId: null, NOT: { id: opts.accountPersonId } }
  });
  if (candidates.length === 0) return { action: "skip", reason: "no-candidate" };

  const adults = candidates.filter((p) => p.ageGateLevel === "ADULT" && p.guardianPersonId === null);
  if (adults.length === 0) return { action: "skip", reason: "dependent-only" };
  if (adults.length > 1) return { action: "skip", reason: "ambiguous" };

  const sole = adults[0];
  if (!nameCorroborates(sole, { firstName: opts.firstName, lastName: opts.lastName })) {
    return { action: "skip", reason: "name-mismatch" };
  }
  return { action: "merge", person: sole };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/lib/__tests__/personMerge.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/personIdentity.ts apps/api/src/lib/__tests__/personMerge.test.ts
git commit -m "feat: P3-03 mergeable-contact selection + name corroboration"
```

---

### Task 3: Webhook post-upsert consolidation + reconcile

**Files:**
- Modify: `apps/api/src/routes/webhooks.ts`
- Test: `apps/api/src/__tests__/routes/webhooks.test.ts` (extend)

**Interfaces:**
- Consumes: `selectMergeableContactPerson`, `mergePersons` (Tasks 1–2).
- Behavior: on `user.created` only, after the existing `db.person.upsert`, capture the account `Person` and run consolidation: `selectMergeableContactPerson` → on `merge`, `mergePersons(account.id, candidate.id, "signup-claim")`; on a `skip` with a reason other than `no-candidate`, emit a `person_merge_needs_review` structured log. `user.updated` unchanged.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("POST /api/v1/webhooks/clerk", ...)` block in `apps/api/src/__tests__/routes/webhooks.test.ts`:

```typescript
  it("user.created: merges a single corroborated contact-only guest into the new account", async () => {
    const email = `merge_${Date.now()}@example.com`;
    const guest = await db.person.create({
      data: { firstName: "Sam", lastName: "Rivera", ageGateLevel: "ADULT", emailNormalized: email }
    });
    const clerkId = `user_merge_${Date.now()}`;
    const { body, headers } = signPayload({
      type: "user.created",
      data: { id: clerkId, first_name: "Sam", last_name: "Rivera", email_addresses: [{ email_address: email }] }
    });

    const res = await request(app).post("/api/v1/webhooks/clerk").set(headers).send(body);
    expect(res.status).toBe(200);

    // the guest record is gone; exactly one person owns the account + that email
    expect(await db.person.findUnique({ where: { id: guest.id } })).toBeNull();
    const acct = await db.person.findUnique({ where: { userId: clerkId } });
    expect(acct).not.toBeNull();
    expect(await db.person.count({ where: { emailNormalized: email } })).toBe(1);
  });

  it("user.created: does NOT merge a dependent child carrying the guardian's email", async () => {
    const email = `child_${Date.now()}@example.com`;
    const guardian = await db.person.create({ data: { firstName: "Pat", lastName: "Cole", ageGateLevel: "ADULT" } });
    const child = await db.person.create({
      data: { firstName: "Kid", lastName: "Cole", ageGateLevel: "CHILD", emailNormalized: email, guardianPersonId: guardian.id }
    });
    const clerkId = `user_parent_${Date.now()}`;
    const { body, headers } = signPayload({
      type: "user.created",
      data: { id: clerkId, first_name: "Pat", last_name: "Cole", email_addresses: [{ email_address: email }] }
    });

    const res = await request(app).post("/api/v1/webhooks/clerk").set(headers).send(body);
    expect(res.status).toBe(200);

    // child survives untouched; the account is its own separate person
    expect(await db.person.findUnique({ where: { id: child.id } })).not.toBeNull();
    const acct = await db.person.findUnique({ where: { userId: clerkId } });
    expect(acct?.id).not.toBe(child.id);
  });

  it("user.created: reconciles a guest's invitation + RSVP onto the new account", async () => {
    const email = `recon_${Date.now()}@example.com`;
    const guest = await db.person.create({
      data: { firstName: "Lee", lastName: "Park", ageGateLevel: "ADULT", emailNormalized: email }
    });
    const host = await db.person.create({ data: { firstName: "Host", lastName: "Q", ageGateLevel: "ADULT" } });
    const fg = await db.familyGroup.create({ data: { name: "ReconFam", createdById: host.id } });
    const event = await db.event.create({
      data: { title: "Picnic", familyGroupId: fg.id, createdByPersonId: host.id, startsAt: new Date() }
    });
    const inv = await db.eventInvitation.create({
      data: { eventId: event.id, guestEmail: email, linkedPersonId: guest.id }
    });
    const rsvp = await db.rSVP.create({ data: { eventId: event.id, personId: guest.id, status: "YES" } });

    const clerkId = `user_recon_${Date.now()}`;
    const { body, headers } = signPayload({
      type: "user.created",
      data: { id: clerkId, first_name: "Lee", last_name: "Park", email_addresses: [{ email_address: email }] }
    });
    const res = await request(app).post("/api/v1/webhooks/clerk").set(headers).send(body);
    expect(res.status).toBe(200);

    const acct = await db.person.findUnique({ where: { userId: clerkId } });
    expect((await db.eventInvitation.findUnique({ where: { id: inv.id } }))?.linkedPersonId).toBe(acct!.id);
    expect((await db.rSVP.findUnique({ where: { id: rsvp.id } }))?.personId).toBe(acct!.id);
    expect(await db.person.findUnique({ where: { id: guest.id } })).toBeNull();
  });
```

> **Fixture accuracy note:** `db.event.create` / `db.eventInvitation.create` / `db.rSVP.create` fixtures above use `startsAt`, `guestEmail`, and `status: "YES"`. Before running, open `schema.prisma` and confirm `Event`'s required scalar fields (it may require `endsAt`, `visibility`, `eventType`, etc.), `EventInvitation`'s required fields, and `RSVP`'s `status` field name/value. Add any missing required fields to the fixtures — these are the only values to adjust; the assertions are correct as written. Note the Prisma delegate for model `RSVP` is `db.rSVP`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/__tests__/routes/webhooks.test.ts`
Expected: FAIL — guest is not merged (still present); reconcile assertions fail.

- [ ] **Step 3: Implement**

In `apps/api/src/routes/webhooks.ts`:

Add to the imports:

```typescript
import { mergePersons, selectMergeableContactPerson } from "../lib/personIdentity";
```

Capture the upsert result and add consolidation. Replace the `await db.person.upsert({ ... })` call with `const accountPerson = await db.person.upsert({ ... })` (same object), then immediately after the upsert block (still inside the `if (type === "user.created" || type === "user.updated")` branch) add:

```typescript
      if (type === "user.created" && emailNormalized) {
        const decision = await selectMergeableContactPerson({
          emailNormalized,
          accountPersonId: accountPerson.id,
          firstName,
          lastName
        });
        if (decision.action === "merge") {
          await mergePersons(accountPerson.id, decision.person.id, "signup-claim");
        } else if (decision.reason !== "no-candidate") {
          console.warn(
            JSON.stringify({
              event: "person_merge_needs_review",
              reason: decision.reason,
              emailNormalized,
              accountPersonId: accountPerson.id
            })
          );
        }
      }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && npx vitest run src/__tests__/routes/webhooks.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Full suite + lint**

Run: `cd apps/api && npx vitest run && npm run lint`
Expected: all API tests PASS; lint passes (pre-existing warnings only — no new errors).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/webhooks.ts apps/api/src/__tests__/routes/webhooks.test.ts
git commit -m "feat: P3-03 webhook merges contact-only guest into new account on signup"
```

---

## Out of scope (later)

- In-app merge review/undo UI; a `PersonMergeLog` DB table (logs-only decision).
- A standalone lazy guest-reconcile pass (subsumed by signup-time merge).
- Phone-based merge (phone verification = W3b).
- `user.updated` consolidation (signup-only).
- W3a-UI-web surfaces (consume the resolver + verified flag, next cycle).

## Self-Review

- **Spec coverage:** §3 `mergePersons` → Task 1 (all FK groups: self-ref guardian, 8 non-unique, 5 compound, Relationship; guards; audit log). §4 post-upsert merge + dependent gate + name corroboration + needs-review log → Tasks 2–3. §5 guest reconcile → Task 3 reconcile test (emergent via `linkedPersonId`/RSVP re-point). §2 decisions (dependent gate, logs-only, account-canonical, deterministic collision rule) → encoded across Tasks 1–3. §7 testing → tests in every task incl. the "duplicate referenced nowhere" guard. ✓
- **Placeholder scan:** every code step carries full code; the two fixture-accuracy notes point at exact fields to verify against `schema.prisma` (the schema is the source of truth for non-Person model columns the merge engine doesn't itself define), not "TODO". ✓
- **Type consistency:** `mergePersons(canonicalId, duplicateId, trigger?)` identical in Task 1 def and Task 3 call; `MergeDecision` shape identical in Task 2 def and Task 3 consumer (`decision.action`, `decision.reason`, `decision.person`); `selectMergeableContactPerson` opts identical in Task 2 and Task 3; column names (`emailNormalized`, `guardianPersonId`, `ageGateLevel`, `linkedPersonId`) match schema and Plan A. ✓
- **Cascade ordering:** duplicate deleted only after all re-points/dedupes — guards against `onDelete: Cascade` data loss. ✓
