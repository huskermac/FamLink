import { db } from "@famlink/db";
import { describe, it, expect } from "vitest";
import { mergePersons } from "../personIdentity";

async function adult(first: string, last: string, extra: Record<string, unknown> = {}) {
  return db.person.create({
    data: { firstName: first, lastName: last, ageGateLevel: "ADULT", ...extra }
  });
}

describe("mergePersons — LinkRequest person columns", () => {
  it("repoints LinkRequest.targetPersonId to the survivor and keeps the request resolvable", async () => {
    const canon = await adult("Canon", "Survivor");
    const dup = await adult("Dup", "Passive");
    const requester = await adult("Req", "Ester1");
    const fg = await db.familyGroup.create({ data: { name: "LRFam1", createdById: requester.id } });
    const req = await db.linkRequest.create({
      data: {
        kind: "FAMILY_MEMBERSHIP",
        direction: "PULL",
        familyGroupId: fg.id,
        targetPersonId: dup.id,
        requestedByPersonId: requester.id,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 86_400_000)
      }
    });

    await mergePersons(canon.id, dup.id);

    const after = await db.linkRequest.findUnique({ where: { id: req.id } });
    expect(after).not.toBeNull();
    expect(after!.targetPersonId).toBe(canon.id);
  });

  it("repoints LinkRequest.requestedByPersonId and consentedByPersonId to the survivor", async () => {
    const canon = await adult("Canon", "Two");
    const dup = await adult("Dup", "Two");
    const target = await adult("Target", "Person");
    const fg = await db.familyGroup.create({ data: { name: "LRFam2", createdById: canon.id } });
    const req = await db.linkRequest.create({
      data: {
        kind: "FAMILY_MEMBERSHIP",
        direction: "PULL",
        familyGroupId: fg.id,
        targetPersonId: target.id,
        requestedByPersonId: dup.id,
        consentedByPersonId: dup.id,
        status: "ACCEPTED",
        expiresAt: new Date(Date.now() + 86_400_000),
        resolvedAt: new Date()
      }
    });

    await mergePersons(canon.id, dup.id);

    const after = await db.linkRequest.findUnique({ where: { id: req.id } });
    expect(after!.requestedByPersonId).toBe(canon.id);
    expect(after!.consentedByPersonId).toBe(canon.id);
  });

  it("resolves a same-family PENDING FAMILY_MEMBERSHIP collision (keeps the older, cancels the newer) before repointing, and does not throw", async () => {
    const canon = await adult("Canon", "Collide");
    const dup = await adult("Dup", "Collide");
    const requester = await adult("Req", "Collide");
    const fg = await db.familyGroup.create({ data: { name: "LRFamCollide", createdById: requester.id } });

    const older = await db.linkRequest.create({
      data: {
        kind: "FAMILY_MEMBERSHIP",
        direction: "PULL",
        familyGroupId: fg.id,
        targetPersonId: canon.id,
        requestedByPersonId: requester.id,
        status: "PENDING",
        createdAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 86_400_000)
      }
    });
    const newer = await db.linkRequest.create({
      data: {
        kind: "FAMILY_MEMBERSHIP",
        direction: "PULL",
        familyGroupId: fg.id,
        targetPersonId: dup.id,
        requestedByPersonId: requester.id,
        status: "PENDING",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000)
      }
    });

    await expect(mergePersons(canon.id, dup.id)).resolves.toBeUndefined();

    const olderAfter = await db.linkRequest.findUnique({ where: { id: older.id } });
    const newerAfter = await db.linkRequest.findUnique({ where: { id: newer.id } });
    expect(olderAfter!.status).toBe("PENDING");
    expect(olderAfter!.targetPersonId).toBe(canon.id);
    expect(newerAfter!.status).toBe("CANCELLED");
    expect(newerAfter!.resolvedAt).not.toBeNull();

    const pendingCount = await db.linkRequest.count({
      where: { familyGroupId: fg.id, targetPersonId: canon.id, status: "PENDING", kind: "FAMILY_MEMBERSHIP" }
    });
    expect(pendingCount).toBe(1);
  });

  it("resolves the reverse-ordering collision — the CANONICAL person's PENDING request is the NEWER one (keeps the older/duplicate's, cancels the canonical's)", async () => {
    const canon = await adult("Canon", "CollideRev");
    const dup = await adult("Dup", "CollideRev");
    const requester = await adult("Req", "CollideRev");
    const fg = await db.familyGroup.create({ data: { name: "LRFamCollideRev", createdById: requester.id } });

    const older = await db.linkRequest.create({
      data: {
        kind: "FAMILY_MEMBERSHIP",
        direction: "PULL",
        familyGroupId: fg.id,
        targetPersonId: dup.id,
        requestedByPersonId: requester.id,
        status: "PENDING",
        createdAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 86_400_000)
      }
    });
    const newer = await db.linkRequest.create({
      data: {
        kind: "FAMILY_MEMBERSHIP",
        direction: "PULL",
        familyGroupId: fg.id,
        targetPersonId: canon.id,
        requestedByPersonId: requester.id,
        status: "PENDING",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000)
      }
    });

    await expect(mergePersons(canon.id, dup.id)).resolves.toBeUndefined();

    const olderAfter = await db.linkRequest.findUnique({ where: { id: older.id } });
    const newerAfter = await db.linkRequest.findUnique({ where: { id: newer.id } });
    expect(olderAfter!.status).toBe("PENDING");
    expect(olderAfter!.targetPersonId).toBe(canon.id); // repointed dup -> canon
    expect(newerAfter!.status).toBe("CANCELLED");
    expect(newerAfter!.resolvedAt).not.toBeNull();

    const pendingCount = await db.linkRequest.count({
      where: { familyGroupId: fg.id, targetPersonId: canon.id, status: "PENDING", kind: "FAMILY_MEMBERSHIP" }
    });
    expect(pendingCount).toBe(1);
  });
});
