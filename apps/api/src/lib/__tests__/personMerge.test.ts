import { db } from "@famlink/db";
import { describe, it, expect } from "vitest";
import { mergePersons, nameCorroborates, selectMergeableContactPerson } from "../personIdentity";

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

  it("dedupes a Relationship collision on the toPersonId side", async () => {
    const canon = await adult("C", "ToSide");
    const dup = await adult("D", "ToSide");
    const other = await adult("O", "ToSide");
    const fg = await db.familyGroup.create({ data: { name: "ToFam", createdById: canon.id } });
    // canonical already has other->canon; duplicate has the same other->dup that would collide after re-point
    const canonRel = await db.relationship.create({
      data: { fromPersonId: other.id, toPersonId: canon.id, type: "PARENT", familyGroupId: fg.id }
    });
    const dupRel = await db.relationship.create({
      data: { fromPersonId: other.id, toPersonId: dup.id, type: "PARENT", familyGroupId: fg.id }
    });
    await mergePersons(canon.id, dup.id);
    expect(await db.relationship.findUnique({ where: { id: canonRel.id } })).not.toBeNull();
    expect(await db.relationship.findUnique({ where: { id: dupRel.id } })).toBeNull();
  });

  it("refuses to merge two account persons and leaves both intact", async () => {
    const a = await adult("Acc", "One", { userId: `u_a_${Date.now()}` });
    const b = await adult("Acc", "Two", { userId: `u_b_${Date.now()}` });
    await expect(mergePersons(a.id, b.id)).rejects.toThrow();
    expect(await db.person.findUnique({ where: { id: a.id } })).not.toBeNull();
    expect(await db.person.findUnique({ where: { id: b.id } })).not.toBeNull();
  });

  it("refuses to delete an account passed as the duplicate (reversed direction)", async () => {
    const contactOnly = await adult("Contact", "Only");
    const account = await adult("Real", "Account", { userId: `u_rev_${Date.now()}` });
    await expect(mergePersons(contactOnly.id, account.id)).rejects.toThrow();
    expect(await db.person.findUnique({ where: { id: account.id } })).not.toBeNull();
  });

  it("leaves the duplicate id referenced nowhere after a multi-relation merge", async () => {
    const canon = await adult("C", "Multi");
    const dup = await adult("D", "Multi");
    const fg = await db.familyGroup.create({ data: { name: "MultiFam", createdById: dup.id } });
    await db.notificationPreference.create({ data: { personId: dup.id, channel: "sms", notifType: "rsvp" } });
    await db.familyMember.create({ data: { familyGroupId: fg.id, personId: dup.id, roles: ["MEMBER"] } });
    // AssistantMessage.personId is a LOGICAL ref (no FK) — without re-point it would silently orphan
    await db.assistantMessage.create({
      data: { conversationId: `c_${Date.now()}`, personId: dup.id, familyGroupId: fg.id, role: "user", content: "hi" }
    });
    // logical refs flagged by review — uploadedById / invitedById have no FK constraint
    const event = await db.event.create({
      data: { title: "Guard", familyGroupId: fg.id, createdByPersonId: canon.id, startAt: new Date() }
    });
    await db.eventPhoto.create({ data: { eventId: event.id, uploadedById: dup.id, key: `k_${Date.now()}`, url: "https://x/p.png" } });
    await db.eventInvitation.create({ data: { eventId: event.id, invitedById: dup.id, guestEmail: "g@x.com" } });
    await db.eventParticipant.create({ data: { eventId: event.id, personId: canon.id, invitedById: dup.id } });

    await mergePersons(canon.id, dup.id);

    // every Person-reference column from the enumeration now resolves away from the duplicate
    expect(await db.familyGroup.count({ where: { createdById: dup.id } })).toBe(0);
    expect(await db.notificationPreference.count({ where: { personId: dup.id } })).toBe(0);
    expect(await db.familyMember.count({ where: { personId: dup.id } })).toBe(0);
    expect(await db.assistantMessage.count({ where: { personId: dup.id } })).toBe(0);
    expect(await db.eventPhoto.count({ where: { uploadedById: dup.id } })).toBe(0);
    expect(await db.eventInvitation.count({ where: { invitedById: dup.id } })).toBe(0);
    expect(await db.eventParticipant.count({ where: { invitedById: dup.id } })).toBe(0);
    expect(await db.person.findUnique({ where: { id: dup.id } })).toBeNull();
  });
});

describe("nameCorroborates", () => {
  it("matches on full name (case-insensitive)", () => {
    expect(nameCorroborates({ firstName: "Ann", lastName: "Lee" }, { firstName: "ann", lastName: "lee" })).toBe(true);
  });
  it("does NOT match on last name alone when first names differ (spouse guard)", () => {
    expect(nameCorroborates({ firstName: "Bob", lastName: "Smith" }, { firstName: "Robert", lastName: "smith" })).toBe(false);
  });
  it("does not match on a different surname", () => {
    expect(nameCorroborates({ firstName: "Bob", lastName: "Jones" }, { firstName: "Bob", lastName: "Smith" })).toBe(false);
  });
  it("does not treat the placeholder name as a match", () => {
    expect(nameCorroborates({ firstName: "User", lastName: "-" }, { firstName: "User", lastName: "-" })).toBe(false);
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

  it("skips a guarded adult (ADULT with non-null guardianPersonId) carrying the email", async () => {
    const e = email();
    const guardian = await db.person.create({ data: { firstName: "Care", lastName: "Taker", ageGateLevel: "ADULT" } });
    await db.person.create({ data: { firstName: "Ward", lastName: "Ed", ageGateLevel: "ADULT", emailNormalized: e, guardianPersonId: guardian.id } });
    const acct = await db.person.create({ data: { firstName: "Ward", lastName: "Ed", ageGateLevel: "ADULT", emailNormalized: e, emailVerifiedAt: new Date(), userId: `u_${Date.now()}` } });
    const d = await selectMergeableContactPerson({ emailNormalized: e, accountPersonId: acct.id, firstName: "Ward", lastName: "Ed" });
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
