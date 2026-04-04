import { db } from "@famlink/db";
import { TEST_CLERK_ID, TEST_USER_2_CLERK_ID } from "./auth";

export async function seedTestPerson(
  overrides?: Partial<{
    firstName: string;
    lastName: string;
    userId: string | null;
  }>
): Promise<Awaited<ReturnType<typeof db.person.create>>> {
  return db.person.create({
    data: {
      firstName: "Test",
      lastName: "User",
      ageGateLevel: "NONE",
      userId: TEST_CLERK_ID,
      ...overrides
    }
  });
}

export async function seedSecondPerson(): Promise<
  Awaited<ReturnType<typeof db.person.create>>
> {
  return db.person.create({
    data: {
      firstName: "Test",
      lastName: "UserTwo",
      ageGateLevel: "NONE",
      userId: TEST_USER_2_CLERK_ID
    }
  });
}

export async function seedTestFamily(adminPersonId: string): Promise<{
  familyGroup: Awaited<ReturnType<typeof db.familyGroup.create>>;
  membership: Awaited<ReturnType<typeof db.familyMember.create>>;
}> {
  return db.$transaction(async (tx) => {
    const familyGroup = await tx.familyGroup.create({
      data: {
        name: "Test Family",
        createdById: adminPersonId,
        aiEnabled: true,
        defaultVisibility: "FAMILY"
      }
    });
    const membership = await tx.familyMember.create({
      data: {
        familyGroupId: familyGroup.id,
        personId: adminPersonId,
        roles: ["ADMIN", "ORGANIZER"],
        permissions: []
      }
    });
    return { familyGroup, membership };
  });
}

export async function seedTestEvent(
  familyGroupId: string,
  createdByPersonId: string,
  overrides?: Partial<{ title: string; startAt: Date }>
): Promise<Awaited<ReturnType<typeof db.event.create>>> {
  const start = new Date(Date.now() + 86400000);
  return db.event.create({
    data: {
      familyGroupId,
      createdByPersonId,
      title: overrides?.title ?? "Test Event",
      startAt: overrides?.startAt ?? start,
      visibility: "FAMILY"
    }
  });
}

export async function seedGuestPerson(
  overrides?: Partial<{ firstName: string; lastName: string }>
): Promise<Awaited<ReturnType<typeof db.person.create>>> {
  return db.person.create({
    data: {
      firstName: overrides?.firstName ?? "Guest",
      lastName: overrides?.lastName ?? "Member",
      ageGateLevel: "NONE",
      userId: null,
      ...overrides
    }
  });
}
