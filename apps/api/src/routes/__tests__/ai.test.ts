/**
 * ai.test.ts
 *
 * Integration tests for AI Assistant routes.
 * POST /api/v1/ai/chat — auth, rate limit, family group access
 * GET  /api/v1/ai/status — rate limit status
 */

import request from "supertest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../../server";

// ── Mock Clerk auth ───────────────────────────────────────────────────────────

const mockGetAuth = vi.fn();

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: (req: unknown) => mockGetAuth(req)
}));

// ── Mock @famlink/db ──────────────────────────────────────────────────────────

const mockPersonFindUnique = vi.fn();
const mockFamilyMemberFindUnique = vi.fn();
const mockFamilyMemberFindMany = vi.fn();
const mockFamilyGroupFindUnique = vi.fn();
const mockAssistantMessageCreateMany = vi.fn();
const mockAssistantMessageFindMany = vi.fn();

vi.mock("@famlink/db", () => ({
  db: {
    person: {
      findUnique: (...args: unknown[]) => mockPersonFindUnique(...args),
      findMany: vi.fn().mockResolvedValue([]),
      findUniqueOrThrow: vi.fn()
    },
    familyMember: {
      findUnique: (...args: unknown[]) => mockFamilyMemberFindUnique(...args),
      findMany: (...args: unknown[]) => mockFamilyMemberFindMany(...args),
      findFirst: vi.fn().mockResolvedValue(null)
    },
    familyGroup: {
      findUnique: (...args: unknown[]) => mockFamilyGroupFindUnique(...args),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "fam1", name: "Test Family" })
    },
    relationship: { findMany: vi.fn().mockResolvedValue([]) },
    event: { findMany: vi.fn().mockResolvedValue([]) },
    household: { findFirst: vi.fn().mockResolvedValue(null) },
    householdMember: { findMany: vi.fn().mockResolvedValue([]) },
    assistantMessage: {
      createMany: (...args: unknown[]) => mockAssistantMessageCreateMany(...args),
      findMany: (...args: unknown[]) => mockAssistantMessageFindMany(...args)
    },
    $queryRaw: vi.fn().mockResolvedValue([])
  }
}));

// ── Mock AI SDK ───────────────────────────────────────────────────────────────

const mockPipeStream = vi.fn((res: { end: () => void }) => {
  res.end();
});

const mockStreamText = vi.fn().mockReturnValue({
  text: Promise.resolve("Here is your answer."),
  pipeUIMessageStreamToResponse: mockPipeStream
});

vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  stepCountIs: vi.fn().mockReturnValue({}),
  tool: (t: unknown) => t
}));

// ── Mock aiRateLimit ──────────────────────────────────────────────────────────

const mockCheckAndIncrement = vi.fn();
const mockGetRateLimitStatus = vi.fn();

vi.mock("../../lib/aiRateLimit", () => ({
  checkAndIncrementAiRateLimit: (...args: unknown[]) => mockCheckAndIncrement(...args),
  getRateLimitStatus: (...args: unknown[]) => mockGetRateLimitStatus(...args)
}));

// ── Mock entitlements ─────────────────────────────────────────────────────────

const mockGetAiDailyLimit = vi.fn();
const mockGetAiDailyLimitForUser = vi.fn();

vi.mock("../../lib/entitlements", () => ({
  getAiDailyLimit: (...args: unknown[]) => mockGetAiDailyLimit(...args),
  getAiDailyLimitForUser: (...args: unknown[]) => mockGetAiDailyLimitForUser(...args)
}));

// ── Mock aiContext ────────────────────────────────────────────────────────────

vi.mock("../../lib/aiContext", () => ({
  assembleFamilyContext: vi.fn().mockResolvedValue({
    familyGroupId: "fam1",
    familyName: "Test Family",
    requestingPerson: { id: "p1", displayName: "Alice", relationship: "self", ageGateLevel: "ADULT", contactable: true },
    members: [],
    upcomingEvents: [],
    upcomingBirthdays: [],
    tokenEstimate: 200
  }),
  formatContextForPrompt: vi.fn().mockReturnValue("Family: Test Family\nRequesting member: Alice"),
  getConversationHistory: vi.fn().mockResolvedValue([])
}));

// ── Mock aiTools (tool definitions use db — mock to avoid side effects) ───────

vi.mock("../../lib/aiTools", () => ({
  buildTools: () => ({})
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PERSON = { id: "p1", userId: "clerk_user1", firstName: "Alice", lastName: "Smith" };
const MEMBERSHIP = { id: "fm1", familyGroupId: "fam1", personId: "p1" };
const ALLOWED_RATE = { allowed: true, remaining: 19, resetAt: new Date("2026-04-14T00:00:00Z") };
const BLOCKED_RATE = { allowed: false, remaining: 0, resetAt: new Date("2026-04-14T00:00:00Z") };

const VALID_BODY = {
  messages: [{ role: "user", content: "Who is in my family?" }],
  familyGroupId: "fam1"
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAssistantMessageFindMany.mockResolvedValue([]);
  mockAssistantMessageCreateMany.mockResolvedValue({ count: 2 });
  mockFamilyGroupFindUnique.mockResolvedValue({ aiEnabled: true });
  mockGetAiDailyLimit.mockResolvedValue(20);
  mockGetAiDailyLimitForUser.mockResolvedValue(20);
});

// ── POST /api/v1/ai/chat ──────────────────────────────────────────────────────

describe("POST /api/v1/ai/chat", () => {
  it("returns 401 without auth", async () => {
    mockGetAuth.mockReturnValue({ userId: null });

    const app = createApp();
    const res = await request(app)
      .post("/api/v1/ai/chat")
      .send(VALID_BODY);

    expect(res.status).toBe(401);
  });

  it("returns 400 when person record is missing", async () => {
    mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
    mockPersonFindUnique.mockResolvedValue(null);

    const app = createApp();
    const res = await request(app)
      .post("/api/v1/ai/chat")
      .send(VALID_BODY);

    expect(res.status).toBe(400);
  });

  it("returns 403 if person is not in the family group", async () => {
    mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockFamilyMemberFindUnique.mockResolvedValue(null); // not a member

    const app = createApp();
    const res = await request(app)
      .post("/api/v1/ai/chat")
      .send(VALID_BODY);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("not a member");
  });

  it("returns 403 when the family has AI disabled", async () => {
    mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockFamilyMemberFindUnique.mockResolvedValue(MEMBERSHIP);
    mockFamilyGroupFindUnique.mockResolvedValue({ aiEnabled: false });

    const app = createApp();
    const res = await request(app)
      .post("/api/v1/ai/chat")
      .send(VALID_BODY);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("turned off");
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockFamilyMemberFindUnique.mockResolvedValue(MEMBERSHIP);
    mockCheckAndIncrement.mockResolvedValue(BLOCKED_RATE);

    const app = createApp();
    const res = await request(app)
      .post("/api/v1/ai/chat")
      .send(VALID_BODY);

    expect(res.status).toBe(429);
    expect(res.body.error).toContain("Daily AI limit");
    expect(res.body.resetAt).toBeDefined();
  });

  it("streams a response and persists both messages with owner scoping", async () => {
    mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockFamilyMemberFindUnique.mockResolvedValue(MEMBERSHIP);
    mockCheckAndIncrement.mockResolvedValue(ALLOWED_RATE);

    const app = createApp();
    const res = await request(app)
      .post("/api/v1/ai/chat")
      .send({ ...VALID_BODY, conversationId: "conv_test" });

    expect(res.status).toBe(200);
    expect(mockStreamText).toHaveBeenCalledOnce();
    expect(mockPipeStream).toHaveBeenCalledOnce();

    // persistence is fire-and-forget after the text promise resolves
    await vi.waitFor(() => expect(mockAssistantMessageCreateMany).toHaveBeenCalledOnce());
    const data = mockAssistantMessageCreateMany.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      conversationId: "conv_test",
      personId: "p1",
      familyGroupId: "fam1",
      role: "user"
    });
    expect(data[1]).toMatchObject({ role: "assistant", content: "Here is your answer." });
  });

  it("passes the coverage-derived limit to the rate limiter", async () => {
    mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockFamilyMemberFindUnique.mockResolvedValue(MEMBERSHIP);
    mockGetAiDailyLimit.mockResolvedValue(3); // free-tier user
    mockCheckAndIncrement.mockResolvedValue(ALLOWED_RATE);

    const app = createApp();
    await request(app).post("/api/v1/ai/chat").send(VALID_BODY);

    expect(mockGetAiDailyLimit).toHaveBeenCalledWith("p1");
    expect(mockCheckAndIncrement).toHaveBeenCalledWith("clerk_user1", 3);
  });

  it("returns 400 for invalid body", async () => {
    mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockFamilyMemberFindUnique.mockResolvedValue(MEMBERSHIP);
    mockCheckAndIncrement.mockResolvedValue(ALLOWED_RATE);

    const app = createApp();
    const res = await request(app)
      .post("/api/v1/ai/chat")
      .send({ messages: [], familyGroupId: "fam1" }); // empty messages array

    expect(res.status).toBe(400);
  });
});

// ── GET /api/v1/ai/status ─────────────────────────────────────────────────────

describe("GET /api/v1/ai/status", () => {
  it("returns 401 without auth", async () => {
    mockGetAuth.mockReturnValue({ userId: null });

    const app = createApp();
    const res = await request(app).get("/api/v1/ai/status");

    expect(res.status).toBe(401);
  });

  it("returns correct remaining count", async () => {
    mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
    mockGetRateLimitStatus.mockResolvedValue({ allowed: true, remaining: 15, resetAt: new Date() });

    const app = createApp();
    const res = await request(app).get("/api/v1/ai/status");

    expect(res.status).toBe(200);
    expect(res.body.queriesRemaining).toBe(15);
    expect(res.body.queriesUsedToday).toBe(5);
    expect(res.body.resetAt).toBeDefined();
  });

  it("reflects the free-tier limit in usage math", async () => {
    mockGetAuth.mockReturnValue({ userId: "clerk_user1" });
    mockGetAiDailyLimitForUser.mockResolvedValue(3);
    mockGetRateLimitStatus.mockResolvedValue({ allowed: true, remaining: 1, resetAt: new Date() });

    const app = createApp();
    const res = await request(app).get("/api/v1/ai/status");

    expect(mockGetRateLimitStatus).toHaveBeenCalledWith("clerk_user1", 3);
    expect(res.body.queriesRemaining).toBe(1);
    expect(res.body.queriesUsedToday).toBe(2); // 3 - 1
  });
});
