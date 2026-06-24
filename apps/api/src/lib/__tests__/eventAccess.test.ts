import { db } from "@famlink/db";
import { describe, it, expect } from "vitest";
import { seedTestPerson, seedTestFamily } from "../../__tests__/helpers/db";
import { activeEventParticipant, resolveEventAccess } from "../eventAccess";

async function seedEvent(familyGroupId: string, createdByPersonId: string) {
  return db.event.create({
    data: { familyGroupId, createdByPersonId, title: "E", startAt: new Date(), eventVisibility: "PRIVATE" }
  });
}

describe("activeEventParticipant", () => {
  it("returns null when there is no grant", async () => {
    const a = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(a.id);
    const ev = await seedEvent(familyGroup.id, a.id);
    const outsider = await seedTestPerson({ userId: null });
    expect(await activeEventParticipant(outsider.id, ev.id)).toBeNull();
  });

  it("returns the role for an ACTIVE grant and null for REVOKED", async () => {
    const a = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(a.id);
    const ev = await seedEvent(familyGroup.id, a.id);
    const p = await seedTestPerson({ userId: null });
    const grant = await db.eventParticipant.create({ data: { eventId: ev.id, personId: p.id, role: "EVENT_ADMIN", status: "ACTIVE" } });
    expect(await activeEventParticipant(p.id, ev.id)).toEqual({ role: "EVENT_ADMIN" });
    await db.eventParticipant.update({ where: { id: grant.id }, data: { status: "REVOKED" } });
    expect(await activeEventParticipant(p.id, ev.id)).toBeNull();
  });
});

describe("resolveEventAccess", () => {
  it("owning-family creator: canView/contribute/admin true", async () => {
    const a = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(a.id);
    const ev = await seedEvent(familyGroup.id, a.id);
    const acc = await resolveEventAccess(ev.id, a.id);
    expect(acc).toMatchObject({ isOwningMember: true, canView: true, canContribute: true, canAdmin: true });
  });

  it("cross-family PARTICIPANT: view+contribute, not admin", async () => {
    const a = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(a.id);
    const ev = await seedEvent(familyGroup.id, a.id);
    const p = await seedTestPerson({ userId: null });
    await db.eventParticipant.create({ data: { eventId: ev.id, personId: p.id, role: "PARTICIPANT", status: "ACTIVE" } });
    const acc = await resolveEventAccess(ev.id, p.id);
    expect(acc).toMatchObject({ isOwningMember: false, eventRole: "PARTICIPANT", canView: true, canContribute: true, canAdmin: false });
  });

  it("cross-family EVENT_ADMIN: canAdmin true", async () => {
    const a = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(a.id);
    const ev = await seedEvent(familyGroup.id, a.id);
    const p = await seedTestPerson({ userId: null });
    await db.eventParticipant.create({ data: { eventId: ev.id, personId: p.id, role: "EVENT_ADMIN", status: "ACTIVE" } });
    const acc = await resolveEventAccess(ev.id, p.id);
    expect(acc).toMatchObject({ eventRole: "EVENT_ADMIN", canAdmin: true });
  });

  it("no access at all -> not_found (full hiding)", async () => {
    const a = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(a.id);
    const ev = await seedEvent(familyGroup.id, a.id);
    const outsider = await seedTestPerson({ userId: null });
    expect(await resolveEventAccess(ev.id, outsider.id)).toEqual({ error: "not_found" });
  });

  it("missing event -> not_found", async () => {
    const outsider = await seedTestPerson({ userId: null });
    expect(await resolveEventAccess("nope", outsider.id)).toEqual({ error: "not_found" });
  });
});
