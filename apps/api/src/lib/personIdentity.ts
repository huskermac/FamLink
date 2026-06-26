import { db, Prisma, type Person } from "@famlink/db";
import { normalizeEmail, normalizePhone } from "./contact";

function splitName(name?: string | null): { firstName: string; lastName: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Guest", lastName: "-" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "-" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function findOrCreatePersonByContact(input: {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}): Promise<Person> {
  const emailNormalized = normalizeEmail(input.email);
  const phoneNormalized = normalizePhone(input.phone);

  if (emailNormalized || phoneNormalized) {
    const matches = await db.person.findMany({
      where: {
        OR: [
          ...(emailNormalized ? [{ emailNormalized }] : []),
          ...(phoneNormalized ? [{ phoneNormalized }] : [])
        ]
      }
    });

    if (matches.length > 0) {
      const verified = matches.find(
        (person) =>
          (emailNormalized &&
            person.emailNormalized === emailNormalized &&
            person.emailVerifiedAt !== null) ||
          (phoneNormalized &&
            person.phoneNormalized === phoneNormalized &&
            person.phoneVerifiedAt !== null)
      );
      return verified ?? matches[0];
    }
  }

  const { firstName, lastName } = splitName(input.name);
  return db.person.create({
    data: {
      userId: null,
      firstName,
      lastName,
      ageGateLevel: "ADULT",
      emailNormalized,
      phoneNormalized
    }
  });
}

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
    if (!canonical) {
      throw new Error(`mergePersons: canonical person not found (${canonicalId})`);
    }
    // Idempotent under concurrent/replayed webhook deliveries: if another delivery
    // already merged+deleted this duplicate, treat as a no-op rather than throwing.
    if (!duplicate) {
      console.info(JSON.stringify({ event: "person_merge_noop", reason: "duplicate-absent", canonicalId, duplicateId }));
      return;
    }
    // Invariant: never delete an account Person. The duplicate is the row that gets
    // deleted, so refuse whenever it has a userId — this covers both account↔account
    // and the reversed direction (account passed as duplicate, contact-only as canonical).
    if (duplicate.userId) {
      console.warn(
        JSON.stringify({
          event: "person_merge_refused",
          reason: canonical.userId ? "account-account" : "would-delete-account",
          canonicalId,
          duplicateId
        })
      );
      throw new Error("mergePersons: refusing to delete an account person (duplicate has a userId)");
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

    // non-unique re-points (declared relations + logical Person-id columns)
    const nonUnique: ReadonlyArray<[string, Promise<{ count: number }>]> = [
      ["FamilyGroup.createdById", tx.familyGroup.updateMany({ where: { createdById: duplicateId }, data: { createdById: canonicalId } })],
      ["Event.createdByPersonId", tx.event.updateMany({ where: { createdByPersonId: duplicateId }, data: { createdByPersonId: canonicalId } })],
      ["Event.birthdayPersonId", tx.event.updateMany({ where: { birthdayPersonId: duplicateId }, data: { birthdayPersonId: canonicalId } })],
      ["EventInvitation.personId", tx.eventInvitation.updateMany({ where: { personId: duplicateId }, data: { personId: canonicalId } })],
      ["EventInvitation.linkedPersonId", tx.eventInvitation.updateMany({ where: { linkedPersonId: duplicateId }, data: { linkedPersonId: canonicalId } })],
      ["EventInvitation.invitedById", tx.eventInvitation.updateMany({ where: { invitedById: duplicateId }, data: { invitedById: canonicalId } })],
      ["EventItem.createdByPersonId", tx.eventItem.updateMany({ where: { createdByPersonId: duplicateId }, data: { createdByPersonId: canonicalId } })],
      ["EventItem.assignedToPersonId", tx.eventItem.updateMany({ where: { assignedToPersonId: duplicateId }, data: { assignedToPersonId: canonicalId } })],
      ["EventPhoto.uploadedById", tx.eventPhoto.updateMany({ where: { uploadedById: duplicateId }, data: { uploadedById: canonicalId } })],
      ["EventParticipant.invitedById", tx.eventParticipant.updateMany({ where: { invitedById: duplicateId }, data: { invitedById: canonicalId } })],
      ["AssistantMessage.personId", tx.assistantMessage.updateMany({ where: { personId: duplicateId }, data: { personId: canonicalId } })]
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

export function nameCorroborates(
  candidate: { firstName: string; lastName: string },
  account: { firstName: string; lastName: string }
): boolean {
  const norm = (s: string): string => s.trim().toLowerCase();
  // Require a full first+last match; reject the webhook placeholders ("User"/"-")
  // so a missing Clerk name can never corroborate. Last-name-only is intentionally
  // NOT accepted — two adults sharing an email + surname (spouses) must not fuse.
  const realName = norm(account.firstName) !== "user" && norm(account.lastName) !== "-";
  const sameFirst = norm(candidate.firstName) === norm(account.firstName);
  const sameLast = norm(candidate.lastName) === norm(account.lastName);
  return realName && sameFirst && sameLast;
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
