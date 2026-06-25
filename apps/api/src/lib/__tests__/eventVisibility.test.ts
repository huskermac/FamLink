import { db } from "@famlink/db";
import { describe, it, expect } from "vitest";
import { seedTestPerson, seedTestFamily } from "../../__tests__/helpers/db";
import { canViewEvent } from "../eventVisibility";

describe("canViewEvent", () => {
  it("an ACTIVE event participant can view a PRIVATE event", async () => {
    const owner = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(owner.id);
    const ev = await db.event.create({
      data: {
        familyGroupId: familyGroup.id,
        createdByPersonId: owner.id,
        title: "P",
        startAt: new Date(),
        eventVisibility: "PRIVATE"
      }
    });
    const p = await seedTestPerson({ userId: null });
    await db.eventParticipant.create({
      data: { eventId: ev.id, personId: p.id, status: "ACTIVE" }
    });
    expect(await canViewEvent(ev, p.id, false)).toBe(true);
  });
});
