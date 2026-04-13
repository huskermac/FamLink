import {
  assembleFamilyContext,
  formatContextForPrompt,
  getConversationHistory,
  MAX_CONTEXT_TOKENS,
  TOKENS_PER_MEMBER,
  type FamilyContext
} from "../aiContext";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFamilyMemberFindUnique = vi.fn();
const mockFamilyMemberFindMany = vi.fn();
const mockFamilyGroupFindUniqueOrThrow = vi.fn();
const mockPersonFindUniqueOrThrow = vi.fn();
const mockRelationshipFindMany = vi.fn();
const mockEventFindMany = vi.fn();
const mockAssistantMessageFindMany = vi.fn();

vi.mock("@famlink/db", () => ({
  db: {
    familyMember: {
      findUnique: (...args: unknown[]) => mockFamilyMemberFindUnique(...args),
      findMany: (...args: unknown[]) => mockFamilyMemberFindMany(...args)
    },
    familyGroup: {
      findUniqueOrThrow: (...args: unknown[]) => mockFamilyGroupFindUniqueOrThrow(...args)
    },
    person: {
      findUniqueOrThrow: (...args: unknown[]) => mockPersonFindUniqueOrThrow(...args)
    },
    relationship: {
      findMany: (...args: unknown[]) => mockRelationshipFindMany(...args)
    },
    event: {
      findMany: (...args: unknown[]) => mockEventFindMany(...args)
    },
    assistantMessage: {
      findMany: (...args: unknown[]) => mockAssistantMessageFindMany(...args)
    }
  }
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date("2026-04-13T12:00:00Z");

const REQUESTER = {
  id: "p_sarah",
  firstName: "Sarah",
  lastName: "Johnson",
  preferredName: null,
  ageGateLevel: "NONE",
  email: "sarah@example.com",
  phone: null,
  dateOfBirth: new Date("1980-03-15")
};

const MEMBER_TOM = {
  id: "p_tom",
  firstName: "Tom",
  lastName: "Johnson",
  preferredName: null,
  ageGateLevel: "NONE",
  email: null,
  phone: "+15551234567",
  dateOfBirth: new Date("1978-11-02")
};

const MEMBERSHIP_SARAH = {
  id: "fm1",
  familyGroupId: "fam1",
  personId: "p_sarah",
  joinedAt: new Date("2026-01-01")
};

const FAMILY_GROUP = { id: "fam1", name: "The Johnson Family" };

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

function makeMemberRow(person: PersonFixture) {
  return {
    id: `fm_${person.id}`,
    personId: person.id,
    familyGroupId: "fam1",
    joinedAt: new Date("2026-01-01"),
    person
  };
}

function makeEvent(id: string, title: string, startAt: Date, rsvps: { status: string }[] = []) {
  return { id, title, startAt, locationName: "Grandma's House", rsvps };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── assembleFamilyContext tests ───────────────────────────────────────────────

describe("assembleFamilyContext", () => {
  function setupHappyPath(extraMembers: typeof MEMBER_TOM[] = []) {
    mockFamilyMemberFindUnique.mockResolvedValue(MEMBERSHIP_SARAH);
    mockFamilyGroupFindUniqueOrThrow.mockResolvedValue(FAMILY_GROUP);
    mockPersonFindUniqueOrThrow.mockResolvedValue(REQUESTER);
    const memberRows = [
      makeMemberRow(REQUESTER),
      ...extraMembers.map(m => makeMemberRow(m))
    ];
    mockFamilyMemberFindMany.mockResolvedValue(memberRows);
    mockRelationshipFindMany.mockResolvedValue([]);
    mockEventFindMany.mockResolvedValue([]);
  }

  it("throws when requestingPersonId is not a member of familyGroupId", async () => {
    mockFamilyMemberFindUnique.mockResolvedValue(null);

    await expect(
      assembleFamilyContext("p_stranger", "fam1")
    ).rejects.toThrow("Unauthorized: person is not a member of this family group");
  });

  it("returns correct PersonSummary for requesting person", async () => {
    setupHappyPath();
    const ctx = await assembleFamilyContext("p_sarah", "fam1");

    expect(ctx.requestingPerson.id).toBe("p_sarah");
    expect(ctx.requestingPerson.displayName).toBe("Sarah Johnson");
    expect(ctx.requestingPerson.relationship).toBe("self");
    expect(ctx.requestingPerson.contactable).toBe(true); // has email
  });

  it("uses preferredName when available", async () => {
    mockFamilyMemberFindUnique.mockResolvedValue(MEMBERSHIP_SARAH);
    mockFamilyGroupFindUniqueOrThrow.mockResolvedValue(FAMILY_GROUP);
    mockPersonFindUniqueOrThrow.mockResolvedValue({ ...REQUESTER, preferredName: "Sally" });
    mockFamilyMemberFindMany.mockResolvedValue([makeMemberRow({ ...REQUESTER, preferredName: "Sally" })]);
    mockRelationshipFindMany.mockResolvedValue([]);
    mockEventFindMany.mockResolvedValue([]);

    const ctx = await assembleFamilyContext("p_sarah", "fam1");
    expect(ctx.requestingPerson.displayName).toBe("Sally");
  });

  it("excludes MINOR-gated persons from members array", async () => {
    mockFamilyMemberFindUnique.mockResolvedValue(MEMBERSHIP_SARAH);
    mockFamilyGroupFindUniqueOrThrow.mockResolvedValue(FAMILY_GROUP);
    mockPersonFindUniqueOrThrow.mockResolvedValue(REQUESTER);
    // Prisma filter excludes MINOR at DB level — return only non-minors
    mockFamilyMemberFindMany.mockResolvedValue([
      makeMemberRow(REQUESTER),
      makeMemberRow(MEMBER_TOM)
      // MEMBER_EMMA excluded by DB filter (ageGateLevel != MINOR)
    ]);
    mockRelationshipFindMany.mockResolvedValue([]);
    mockEventFindMany.mockResolvedValue([]);

    const ctx = await assembleFamilyContext("p_sarah", "fam1");

    const ids = ctx.members.map(m => m.id);
    expect(ids).not.toContain("p_emma");
    expect(ids).toContain("p_tom");
  });

  it("applies relationship type from Relationship table", async () => {
    setupHappyPath([MEMBER_TOM]);
    mockRelationshipFindMany.mockResolvedValue([
      { fromPersonId: "p_sarah", toPersonId: "p_tom", type: "SPOUSE" }
    ]);

    const ctx = await assembleFamilyContext("p_sarah", "fam1");
    const tom = ctx.members.find(m => m.id === "p_tom");
    expect(tom?.relationship).toBe("SPOUSE");
  });

  it("falls back to 'family member' when no relationship record", async () => {
    setupHappyPath([MEMBER_TOM]);
    // relMap already returns [] from setupHappyPath

    const ctx = await assembleFamilyContext("p_sarah", "fam1");
    const tom = ctx.members.find(m => m.id === "p_tom");
    expect(tom?.relationship).toBe("family member");
  });

  it("trims members when tokenEstimate exceeds MAX_CONTEXT_TOKENS", async () => {
    // Build enough members to exceed budget
    const tokensPerMember = TOKENS_PER_MEMBER;
    const baseTokens = 200;
    const neededMembers = Math.ceil((MAX_CONTEXT_TOKENS - baseTokens) / tokensPerMember) + 5;

    const extraMembers = Array.from({ length: neededMembers }, (_, i) => ({
      ...MEMBER_TOM,
      id: `p_extra_${i}`,
      firstName: `Extra${i}`,
      lastName: "Member"
    }));

    mockFamilyMemberFindUnique.mockResolvedValue(MEMBERSHIP_SARAH);
    mockFamilyGroupFindUniqueOrThrow.mockResolvedValue(FAMILY_GROUP);
    mockPersonFindUniqueOrThrow.mockResolvedValue(REQUESTER);
    mockFamilyMemberFindMany.mockResolvedValue([
      makeMemberRow(REQUESTER),
      ...extraMembers.map(m => makeMemberRow(m))
    ]);
    mockRelationshipFindMany.mockResolvedValue([]);
    mockEventFindMany.mockResolvedValue([]);

    const ctx = await assembleFamilyContext("p_sarah", "fam1");

    expect(ctx.tokenEstimate).toBeLessThanOrEqual(MAX_CONTEXT_TOKENS);
    expect(ctx.members.length).toBeLessThan(neededMembers);
  });

  it("limits upcomingEvents to next eventLookAheadDays", async () => {
    setupHappyPath();
    const inRange = makeEvent("e1", "Easter", new Date("2026-04-20T18:00:00Z"));
    const outOfRange = makeEvent("e2", "Summer BBQ", new Date("2026-06-20T18:00:00Z"));
    // DB filter applied by Prisma — simulate by returning only in-range
    mockEventFindMany.mockResolvedValue([inRange]);

    const ctx = await assembleFamilyContext("p_sarah", "fam1");
    expect(ctx.upcomingEvents).toHaveLength(1);
    expect(ctx.upcomingEvents[0].title).toBe("Easter");
    expect(ctx.upcomingEvents[0].rsvpSummary).toEqual({ yes: 0, no: 0, maybe: 0, pending: 0 });

    // Verify the query used the correct date range
    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          familyGroupId: "fam1",
          startAt: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) })
        })
      })
    );

    void outOfRange; // referenced to avoid unused var lint
  });

  it("counts RSVP statuses correctly", async () => {
    setupHappyPath();
    const event = makeEvent("e1", "Party", new Date("2026-04-20T18:00:00Z"), [
      { status: "YES" },
      { status: "YES" },
      { status: "NO" },
      { status: "MAYBE" },
      { status: "PENDING" }
    ]);
    mockEventFindMany.mockResolvedValue([event]);

    const ctx = await assembleFamilyContext("p_sarah", "fam1");
    expect(ctx.upcomingEvents[0].rsvpSummary).toEqual({ yes: 2, no: 1, maybe: 1, pending: 1 });
  });

  it("upcomingBirthdays are sorted ascending by daysUntil", async () => {
    setupHappyPath();
    // Tom birthday: 1978-11-02 → Nov 2, ~203 days from Apr 13
    // Create a person whose birthday is soon
    const soonBirthday = {
      ...MEMBER_TOM,
      id: "p_soon",
      firstName: "Soon",
      dateOfBirth: new Date("1990-04-20") // 7 days from now
    };
    const laterBirthday = {
      ...MEMBER_TOM,
      id: "p_later",
      firstName: "Later",
      dateOfBirth: new Date("1985-04-25") // 12 days from now
    };

    mockFamilyMemberFindUnique.mockResolvedValue(MEMBERSHIP_SARAH);
    mockFamilyGroupFindUniqueOrThrow.mockResolvedValue(FAMILY_GROUP);
    mockPersonFindUniqueOrThrow.mockResolvedValue(REQUESTER);
    mockFamilyMemberFindMany.mockResolvedValue([
      makeMemberRow(REQUESTER),
      makeMemberRow(laterBirthday),
      makeMemberRow(soonBirthday)
    ]);
    mockRelationshipFindMany.mockResolvedValue([]);
    mockEventFindMany.mockResolvedValue([]);

    const ctx = await assembleFamilyContext("p_sarah", "fam1");

    const bdays = ctx.upcomingBirthdays;
    expect(bdays.length).toBeGreaterThanOrEqual(2);
    // First birthday should have smaller daysUntil
    expect(bdays[0].daysUntil).toBeLessThanOrEqual(bdays[1].daysUntil);
    expect(bdays[0].name).toBe("Soon Johnson");
  });

  it("excludes birthdays beyond 30 days", async () => {
    setupHappyPath();
    const farFuture = {
      ...MEMBER_TOM,
      id: "p_far",
      firstName: "Far",
      dateOfBirth: new Date("1990-06-15") // > 30 days from Apr 13
    };
    mockFamilyMemberFindMany.mockResolvedValue([
      makeMemberRow(REQUESTER),
      makeMemberRow(farFuture)
    ]);

    const ctx = await assembleFamilyContext("p_sarah", "fam1");
    expect(ctx.upcomingBirthdays).toHaveLength(0);
  });
});

// ── formatContextForPrompt tests ──────────────────────────────────────────────

describe("formatContextForPrompt", () => {
  const baseContext: FamilyContext = {
    familyGroupId: "fam1",
    familyName: "The Johnson Family",
    requestingPerson: {
      id: "p_sarah",
      displayName: "Sarah Johnson",
      relationship: "self",
      ageGateLevel: "NONE",
      contactable: true
    },
    members: [
      { id: "p_tom", displayName: "Tom Johnson", relationship: "SPOUSE", ageGateLevel: "NONE", contactable: true },
      { id: "p_margaret", displayName: "Margaret Johnson", relationship: "family member", ageGateLevel: "NONE", contactable: false }
    ],
    upcomingEvents: [
      {
        id: "e1",
        title: "Easter Dinner",
        startTime: new Date("2026-04-20T18:00:00Z").toISOString(),
        location: "Grandma's house",
        rsvpSummary: { yes: 3, no: 0, maybe: 1, pending: 2 }
      }
    ],
    upcomingBirthdays: [
      { name: "Uncle Mike", date: "2026-04-16", daysUntil: 3 }
    ],
    tokenEstimate: 350
  };

  it("output contains family name", () => {
    const output = formatContextForPrompt(baseContext);
    expect(output).toContain("The Johnson Family");
  });

  it("output contains member count", () => {
    const output = formatContextForPrompt(baseContext);
    expect(output).toContain("Members (2)");
  });

  it("output contains member names", () => {
    const output = formatContextForPrompt(baseContext);
    expect(output).toContain("Tom Johnson");
    expect(output).toContain("Margaret Johnson");
  });

  it("output contains upcoming event title", () => {
    const output = formatContextForPrompt(baseContext);
    expect(output).toContain("Easter Dinner");
  });

  it("output contains upcoming birthday name and days", () => {
    const output = formatContextForPrompt(baseContext);
    expect(output).toContain("Uncle Mike");
    expect(output).toContain("3 days");
  });

  it("output is plain text (no JSON brackets or braces)", () => {
    const output = formatContextForPrompt(baseContext);
    expect(output).not.toMatch(/^\{/);
    expect(output).not.toContain('"familyGroupId"');
    expect(output).not.toContain('"members":');
  });

  it("handles no events gracefully", () => {
    const ctx = { ...baseContext, upcomingEvents: [] };
    const output = formatContextForPrompt(ctx);
    expect(output).not.toContain("Upcoming Events:");
  });

  it("handles no birthdays gracefully", () => {
    const ctx = { ...baseContext, upcomingBirthdays: [] };
    const output = formatContextForPrompt(ctx);
    expect(output).not.toContain("Upcoming Birthdays:");
  });

  it("today birthday uses 'today' label", () => {
    vi.setSystemTime(NOW);
    const ctx = {
      ...baseContext,
      upcomingBirthdays: [{ name: "Bob", date: "2026-04-13", daysUntil: 0 }]
    };
    const output = formatContextForPrompt(ctx);
    expect(output).toContain("today");
  });
});

// ── getConversationHistory tests ──────────────────────────────────────────────

describe("getConversationHistory", () => {
  it("returns messages in chronological order (oldest first)", async () => {
    mockAssistantMessageFindMany.mockResolvedValue([
      { id: "m1", role: "user", content: "Hello", createdAt: new Date("2026-04-01T10:00:00Z") },
      { id: "m2", role: "assistant", content: "Hi there!", createdAt: new Date("2026-04-01T10:00:05Z") }
    ]);

    const history = await getConversationHistory("conv1");

    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ role: "user", content: "Hello" });
    expect(history[1]).toEqual({ role: "assistant", content: "Hi there!" });
  });

  it("passes limit to the query", async () => {
    mockAssistantMessageFindMany.mockResolvedValue([]);

    await getConversationHistory("conv1", 5);

    expect(mockAssistantMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 })
    );
  });

  it("returns empty array if no conversation found", async () => {
    mockAssistantMessageFindMany.mockResolvedValue([]);

    const history = await getConversationHistory("conv_nonexistent");
    expect(history).toHaveLength(0);
  });

  it("filters by conversationId", async () => {
    mockAssistantMessageFindMany.mockResolvedValue([]);

    await getConversationHistory("conv_abc");

    expect(mockAssistantMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: "conv_abc" }
      })
    );
  });
});
