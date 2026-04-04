import { afterEach } from "@jest/globals";
import { db } from "@famlink/db";

/** Dependency order: children before parents (matches FK graph). */
const tables = [
  "RSVP",
  "EventInvitation",
  "PotluckAssignment",
  "Event",
  "Relationship",
  "HouseholdMember",
  "FamilyMember",
  "Household",
  "NotificationPreference",
  "FamilyGroup",
  "Person"
] as const;

afterEach(
  async () => {
    for (const table of tables) {
      await db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
    }
  },
  60_000
);
