import { db } from "@famlink/db";

/** Dependency order: children before parents (matches FK graph). */
const tables = [
  "AssistantMessage",
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

async function truncateAll(): Promise<void> {
  for (const table of tables) {
    await db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
  }
}

/** Ensure each test file starts with a clean slate (guards against prior failed runs). */
beforeAll(truncateAll, 60_000);

afterEach(truncateAll, 60_000);
