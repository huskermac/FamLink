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

const mockPipeDataStream = vi.fn((res: { end: () => void }) => {
  res.end();
});

const mockStreamText = vi.fn().mockReturnValue({
  text: Promise.resolve("Here is your answer."),
  pipeDataStreamToResponse: mockPipeDataStream
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

// ── Mock aiContext ────────────────────────────────────────────────────────────

vi.mock("../../lib/aiContext", () => ({
  assembleFamilyContext: vi.fn().mockResolvedValue({
    familyGroupId: "fam1",
    familyName: "Test Family",
    requestingPerson: { id: "p1", displayName: "Alice", relationship: "self", ageGateLevel: "NONE", contactable: true },
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
  allTools: {}
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
});
