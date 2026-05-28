import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@famlink/db";
import { getInviteeSuggestions } from "../inviteeSuggestions";
import { seedGuestPerson, seedTestFamily, seedTestPerson } from "../../__tests__/helpers/db";

async function seedFamilyOf(adminId: string, memberIds: string[]) {
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
