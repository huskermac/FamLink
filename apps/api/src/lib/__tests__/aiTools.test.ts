/**
 * aiTools.test.ts
 *
 * Unit tests for all 10 Layer 1 AI tools.
 * Uses mocked @famlink/db — never hits a real database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @famlink/db ──────────────────────────────────────────────────────────

const mockFamilyMemberFindMany = vi.fn();
const mockFamilyMemberFindFirst = vi.fn();
const mockPersonFindMany = vi.fn();
const mockEventFindMany = vi.fn();
const mockEventFindFirst = vi.fn();
const mockHouseholdFindFirst = vi.fn();
const mockHouseholdMemberFindMany = vi.fn();
const mockQueryRaw = vi.fn();
const mockEventCreate = vi.fn();

vi.mock("@famlink/db", () => ({
  db: {
    familyMember: {
      findMany: (...args: unknown[]) => mockFamilyMemberFindMany(...args),
      findFirst: (...args: unknown[]) => mockFamilyMemberFindFirst(...args)
    },
    person: {
      findMany: (...args: unknown[]) => mockPersonFindMany(...args)
    },
    event: {
      findMany: (...args: unknown[]) => mockEventFindMany(...args),
      findFirst: (...args: unknown[]) => mockEventFindFirst(...args),
      create: (...args: unknown[]) => mockEventCreate(...args)
    },
    household: {
      findFirst: (...args: unknown[]) => mockHouseholdFindFirst(...args)
    },
    householdMember: {
      findMany: (...args: unknown[]) => mockHouseholdMemberFindMany(...args)
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args)
  }
}));

// Import tools AFTER mocks are set up
import {
  get_person,
  get_family_members,
  get_relationship_path,
  get_upcoming_birthdays,
  get_upcoming_events,
  get_event_details,
  get_rsvp_status,
  get_household_members,
  get_contact_info,
  create_event
} from "../aiTools";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAM_ID = "fam_test";

interface PersonFixture {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  ageGateLevel: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
}

const PERSON_ALICE: PersonFixture = {
  id: "p_alice",
  firstName: "Alice",
  lastName: "Smith",
  preferredName: null,
  ageGateLevel: "NONE",
  email: "alice@example.com",
  phone: null,
  dateOfBirth: new Date("1980-06-15")
};

const PERSON_BOB: PersonFixture = {
  id: "p_bob",
  firstName: "Bob",
  lastName: "Smith",
  preferredName: "Bobby",
  ageGateLevel: "NONE",
  email: null,
  phone: "+15551234567",
  dateOfBirth: null
};

const PERSON_MINOR: PersonFixture = {
  id: "p_minor",
  firstName: "Tim",
  lastName: "Smith",
  preferredName: null,
  ageGateLevel: "MINOR",
  email: "kid@example.com",
  phone: null,
  dateOfBirth: new Date("2015-01-01")
};

const makeMember = (person: PersonFixture, joinedAt = new Date("2026-01-01")) => ({
  id: `fm_${person.id}`,
  familyGroupId: FAM_ID,
  personId: person.id,
  joinedAt,
  person
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: person lookups return empty (override per-test where needed)
  mockPersonFindMany.mockResolvedValue([]);
});

// ── get_person ────────────────────────────────────────────────────────────────

describe("get_person", () => {
  it("returns matching persons by partial name", async () => {
    mockFamilyMemberFindMany.mockResolvedValue([makeMember(PERSON_ALICE), makeMember(PERSON_BOB)]);

    const result = await get_person.execute!({ name: "alice", familyGroupId: FAM_ID }, {} as never);

    expect(result).toHaveLength(1);
    expect((result as { displayName: string }[])[0].displayName).toBe("Alice Smith");
  });

  it("returns empty array when no match", async () => {
    mockFamilyMemberFindMany.mockResolvedValue([makeMember(PERSON_ALICE)]);

    const result = await get_person.execute!({ name: "nobody", familyGroupId: FAM_ID }, {} as never);

    expect(result).toHaveLength(0);
  });

  it("matches by preferredName", async () => {
    mockFamilyMemberFindMany.mockResolvedValue([makeMember(PERSON_BOB)]);

    const result = await get_person.execute!({ name: "Bobby", familyGroupId: FAM_ID }, {} as never);

    expect(result).toHaveLength(1);
    expect((result as { displayName: string }[])[0].displayName).toBe("Bobby");
  });
});

// ── get_family_members ────────────────────────────────────────────────────────

describe("get_family_members", () => {
  it("returns all non-minor members", async () => {
    mockFamilyMemberFindMany.mockResolvedValue([makeMember(PERSON_ALICE), makeMember(PERSON_BOB)]);

    const result = await get_family_members.execute!({ familyGroupId: FAM_ID }, {} as never) as { id: string }[];

    expect(result).toHaveLength(2);
    expect(result.map(r => r.id)).toContain("p_alice");
  });

  it("returns empty array when no members", async () => {
    mockFamilyMemberFindMany.mockResolvedValue([]);

    const result = await get_family_members.execute!({ familyGroupId: FAM_ID }, {} as never);

    expect(result).toHaveLength(0);
  });
});

// ── get_relationship_path ─────────────────────────────────────────────────────

describe("get_relationship_path", () => {
  it("returns relationship description when path exists", async () => {
    mockQueryRaw.mockResolvedValue([{ depth: 1, type_path: ["PARENT"] }]);

    const result = await get_relationship_path.execute!(
      { fromPersonId: "p_alice", toPersonId: "p_bob", familyGroupId: FAM_ID },
      {} as never
    ) as { description: string; path: string[] };

    expect(result.path).toEqual(["PARENT"]);
    expect(result.description).toBe("parent");
  });

  it("returns no-path message when CTE returns no rows", async () => {
    mockQueryRaw.mockResolvedValue([]);

    const result = await get_relationship_path.execute!(
      { fromPersonId: "p_alice", toPersonId: "p_nobody", familyGroupId: FAM_ID },
      {} as never
    ) as { description: string; path: null };

    expect(result.path).toBeNull();
    expect(result.description).toContain("No relationship path");
  });

  it("describes multi-hop paths", async () => {
    mockQueryRaw.mockResolvedValue([{ depth: 2, type_path: ["PARENT", "SIBLING"] }]);

    const result = await get_relationship_path.execute!(
      { fromPersonId: "p_alice", toPersonId: "p_bob", familyGroupId: FAM_ID },
      {} as never
    ) as { description: string };

    expect(result.description).toContain("parent");
    expect(result.description).toContain("sibling");
  });
});

// ── get_upcoming_birthdays ────────────────────────────────────────────────────

describe("get_upcoming_birthdays", () => {
  it("returns birthdays within the window", async () => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    // Alice's birthday: June 15 — 14 days away
    mockFamilyMemberFindMany.mockResolvedValue([makeMember(PERSON_ALICE)]);

    const result = await get_upcoming_birthdays.execute!(
      { familyGroupId: FAM_ID, withinDays: 30 },
      {} as never
    ) as { name: string; daysUntil: number }[];

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alice Smith");
    // Allow 13–14 to accommodate UTC vs local-time date arithmetic across environments
    expect(result[0].daysUntil).toBeGreaterThanOrEqual(13);
    expect(result[0].daysUntil).toBeLessThanOrEqual(14);

    vi.useRealTimers();
  });

  it("excludes birthdays outside the window", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    // Alice's birthday: June 15 — 165 days away
    mockFamilyMemberFindMany.mockResolvedValue([makeMember(PERSON_ALICE)]);

    const result = await get_upcoming_birthdays.execute!(
      { familyGroupId: FAM_ID, withinDays: 30 },
      {} as never
    ) as unknown[];

    expect(result).toHaveLength(0);

    vi.useRealTimers();
  });
});

// ── get_upcoming_events ───────────────────────────────────────────────────────

describe("get_upcoming_events", () => {
  it("returns upcoming events with RSVP summary", async () => {
    const now = new Date("2026-04-13T12:00:00Z");
    vi.setSystemTime(now);

    mockEventFindMany.mockResolvedValue([
      {
        id: "ev1",
        familyGroupId: FAM_ID,
        title: "Picnic",
        startAt: new Date("2026-04-20T14:00:00Z"),
        locationName: "Central Park",
        rsvps: [{ status: "YES" }, { status: "YES" }, { status: "PENDING" }]
      }
    ]);

    const result = await get_upcoming_events.execute!(
      { familyGroupId: FAM_ID },
      {} as never
    ) as { id: string; rsvpSummary: { yes: number; pending: number } }[];

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ev1");
    expect(result[0].rsvpSummary.yes).toBe(2);
    expect(result[0].rsvpSummary.pending).toBe(1);

    vi.useRealTimers();
  });

  it("returns empty array when no events", async () => {
    mockEventFindMany.mockResolvedValue([]);

    const result = await get_upcoming_events.execute!(
      { familyGroupId: FAM_ID },
      {} as never
    );

    expect(result).toHaveLength(0);
  });
});

// ── get_event_details ─────────────────────────────────────────────────────────

describe("get_event_details", () => {
  it("returns full event details", async () => {
    mockEventFindFirst.mockResolvedValue({
      id: "ev1",
      familyGroupId: FAM_ID,
      title: "Reunion",
      description: "Annual family reunion",
      startAt: new Date("2026-05-01T10:00:00Z"),
      endAt: null,
      locationName: "Home",
      rsvps: [{ status: "YES", personId: PERSON_ALICE.id }]
    });
    mockPersonFindMany.mockResolvedValue([PERSON_ALICE]);

    const result = await get_event_details.execute!(
      { eventId: "ev1", familyGroupId: FAM_ID },
      {} as never
    ) as { title: string; rsvps: { personName: string }[] };

    expect(result.title).toBe("Reunion");
    expect(result.rsvps[0].personName).toBe("Alice Smith");
  });

  it("returns null when event is in a different family group", async () => {
    mockEventFindFirst.mockResolvedValue(null);

    const result = await get_event_details.execute!(
      { eventId: "ev_other", familyGroupId: FAM_ID },
      {} as never
    );

    expect(result).toBeNull();
  });
});

// ── get_rsvp_status ───────────────────────────────────────────────────────────

describe("get_rsvp_status", () => {
  it("returns grouped RSVP status by person name", async () => {
    mockEventFindFirst.mockResolvedValue({
      id: "ev1",
      familyGroupId: FAM_ID,
      rsvps: [
        { status: "YES", personId: PERSON_ALICE.id },
        { status: "NO", personId: PERSON_BOB.id }
      ]
    });
    mockPersonFindMany.mockResolvedValue([PERSON_ALICE, PERSON_BOB]);

    const result = await get_rsvp_status.execute!(
      { eventId: "ev1", familyGroupId: FAM_ID },
      {} as never
    ) as { yes: string[]; no: string[] };

    expect(result.yes).toContain("Alice Smith");
    expect(result.no).toContain("Bobby");
  });

  it("returns null for wrong familyGroupId", async () => {
    mockEventFindFirst.mockResolvedValue(null);

    const result = await get_rsvp_status.execute!(
      { eventId: "ev_other", familyGroupId: FAM_ID },
      {} as never
    );

    expect(result).toBeNull();
  });
});

// ── get_household_members ─────────────────────────────────────────────────────

describe("get_household_members", () => {
  it("returns household members when household belongs to family", async () => {
    mockHouseholdFindFirst.mockResolvedValue({ id: "hh1", familyGroupId: FAM_ID });
    mockHouseholdMemberFindMany.mockResolvedValue([{ person: PERSON_ALICE }]);

    const result = await get_household_members.execute!(
      { householdId: "hh1", familyGroupId: FAM_ID },
      {} as never
    ) as { id: string }[];

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("p_alice");
  });

  it("returns empty array when household is in a different family group", async () => {
    mockHouseholdFindFirst.mockResolvedValue(null);

    const result = await get_household_members.execute!(
      { householdId: "hh_other", familyGroupId: FAM_ID },
      {} as never
    );

    expect(result).toHaveLength(0);
  });
});

// ── get_contact_info ──────────────────────────────────────────────────────────

describe("get_contact_info", () => {
  it("returns contact info for a non-minor person", async () => {
    mockFamilyMemberFindFirst.mockResolvedValue({ person: PERSON_ALICE });

    const result = await get_contact_info.execute!(
      { personId: "p_alice", familyGroupId: FAM_ID },
      {} as never
    ) as { displayName: string; email: string | null };

    expect(result.displayName).toBe("Alice Smith");
    expect(result.email).toBe("alice@example.com");
  });

  it("returns null for MINOR-gated person", async () => {
    mockFamilyMemberFindFirst.mockResolvedValue({ person: PERSON_MINOR });

    const result = await get_contact_info.execute!(
      { personId: "p_minor", familyGroupId: FAM_ID },
      {} as never
    );

    expect(result).toBeNull();
  });

  it("returns null when person is not in the family group", async () => {
    mockFamilyMemberFindFirst.mockResolvedValue(null);

    const result = await get_contact_info.execute!(
      { personId: "p_alice", familyGroupId: "other_fam" },
      {} as never
    );

    expect(result).toBeNull();
  });
});

// ── create_event ──────────────────────────────────────────────────────────────

describe("create_event", () => {
  it("returns proposal object with confirmationRequired: true", async () => {
    const result = await create_event.execute!(
      {
        title: "Birthday Party",
        startTime: "2026-05-01T15:00:00Z",
        familyGroupId: FAM_ID
      },
      {} as never
    ) as { proposed: boolean; confirmationRequired: boolean; event: { title: string } };

    expect(result.proposed).toBe(true);
    expect(result.confirmationRequired).toBe(true);
    expect(result.event.title).toBe("Birthday Party");
  });

  it("does NOT write to the database", async () => {
    await create_event.execute!(
      {
        title: "Test Event",
        startTime: "2026-05-01T15:00:00Z",
        familyGroupId: FAM_ID
      },
      {} as never
    );

    expect(mockEventCreate).not.toHaveBeenCalled();
  });

  it("includes the confirmation message", async () => {
    const result = await create_event.execute!(
      {
        title: "Cookout",
        startTime: "2026-07-04T17:00:00Z",
        familyGroupId: FAM_ID
      },
      {} as never
    ) as { message: string };

    expect(result.message).toContain("confirm");
  });
});
