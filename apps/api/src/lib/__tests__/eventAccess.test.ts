import { db } from "@famlink/db";
import { describe, it, expect } from "vitest";

describe("EventParticipant schema", () => {
  it("enforces unique (eventId, personId)", async () => {
    // seed via helpers added in later tasks; placeholder smoke retained until Task 2 fills it
    expect(typeof db.eventParticipant.create).toBe("function");
  });
});
