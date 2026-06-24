/**
 * aiRateLimit.test.ts
 *
 * Tests for the Redis-based AI rate limiter.
 * Uses a mock Redis client — never hits real Redis.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkAndIncrementAiRateLimit,
  getRateLimitStatus,
  setRedisClient
} from "../aiRateLimit";

// ── Mock Redis client ─────────────────────────────────────────────────────────

const store = new Map<string, string>();

const mockRedis = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string | number) => {
    store.set(key, String(value));
    return "OK";
  }),
  incr: vi.fn(async (key: string) => {
    const current = parseInt(store.get(key) ?? "0", 10);
    const next = current + 1;
    store.set(key, String(next));
    return next;
  }),
  expire: vi.fn(async () => 1)
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  // Inject mock Redis client
  setRedisClient(mockRedis as never);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("checkAndIncrementAiRateLimit", () => {
  it("allows first request and returns remaining: 19", async () => {
    const result = await checkAndIncrementAiRateLimit("user_alice", { dailyLimit: 20, foreign: false, foreignLimit: 3 });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(19);
    expect(result.resetAt).toBeInstanceOf(Date);
  });

  it("decrements remaining on subsequent calls", async () => {
    // Pre-populate with 3 prior calls
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_bob:${today}`, "3");

    const result = await checkAndIncrementAiRateLimit("user_bob", { dailyLimit: 20, foreign: false, foreignLimit: 3 });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(16); // 20 - 3 - 1 = 16
  });

  it("returns allowed: false and remaining: 0 when limit is reached", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_carol:${today}`, "20");

    const result = await checkAndIncrementAiRateLimit("user_carol", { dailyLimit: 20, foreign: false, foreignLimit: 3 });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("never grants more than the daily limit across concurrent calls", async () => {
    // 30 simultaneous requests against a fresh counter — only 20 may be allowed.
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        checkAndIncrementAiRateLimit("user_concurrent", { dailyLimit: 20, foreign: false, foreignLimit: 3 })
      )
    );
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(20);
  });

  it("allows exactly the 20th call and returns remaining: 0", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_dave:${today}`, "19");

    const result = await checkAndIncrementAiRateLimit("user_dave", { dailyLimit: 20, foreign: false, foreignLimit: 3 });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("blocks a free-tier user after their lower limit", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_free:${today}`, "3");

    const result = await checkAndIncrementAiRateLimit("user_free", { dailyLimit: 3, foreign: false, foreignLimit: 3 });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("Redis key includes today's UTC date", async () => {
    await checkAndIncrementAiRateLimit("user_eve", { dailyLimit: 20, foreign: false, foreignLimit: 3 });

    const today = new Date().toISOString().split("T")[0];
    expect(mockRedis.incr).toHaveBeenCalledWith(`ai:rate:user_eve:${today}`);
  });

  it("sets TTL of 86400 on every increment", async () => {
    const today = new Date().toISOString().split("T")[0];
    await checkAndIncrementAiRateLimit("user_frank", { dailyLimit: 20, foreign: false, foreignLimit: 3 });
    expect(mockRedis.expire).toHaveBeenCalledWith(
      `ai:rate:user_frank:${today}`,
      86400
    );

    // Second call same day must also set the TTL (idempotent — closes crash gap).
    mockRedis.expire.mockClear();
    await checkAndIncrementAiRateLimit("user_frank", { dailyLimit: 20, foreign: false, foreignLimit: 3 });
    expect(mockRedis.expire).toHaveBeenCalledWith(
      `ai:rate:user_frank:${today}`,
      86400
    );
  });
});

describe("getRateLimitStatus", () => {
  it("returns full quota when no key exists", async () => {
    const result = await getRateLimitStatus("user_new", { dailyLimit: 20, foreign: false, foreignLimit: 3 });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(20);
  });

  it("returns correct remaining count without incrementing", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_known:${today}`, "5");

    const result = await getRateLimitStatus("user_known", { dailyLimit: 20, foreign: false, foreignLimit: 3 });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(15);
    expect(mockRedis.incr).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("returns allowed: false when limit exhausted", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_maxed:${today}`, "20");

    const result = await getRateLimitStatus("user_maxed", { dailyLimit: 20, foreign: false, foreignLimit: 3 });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

describe("foreign-context throttling", () => {
  const FOREIGN = { dailyLimit: 20, foreign: true, foreignLimit: 3 };

  it("blocks foreign requests after the foreign cap even with global remaining", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:foreign:user_fc:${today}`, "3");
    store.set(`ai:rate:user_fc:${today}`, "5");
    const result = await checkAndIncrementAiRateLimit("user_fc", FOREIGN);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("foreign");
  });

  it("blocks on global in a foreign context when global is exhausted", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_fg:${today}`, "20");
    const result = await checkAndIncrementAiRateLimit("user_fg", FOREIGN);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("global");
  });

  it("allows a foreign request and reports the tighter remaining", async () => {
    const result = await checkAndIncrementAiRateLimit("user_fok", FOREIGN);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2); // min(20-1, 3-1)
  });

  it("caps total foreign usage at foreignLimit across many calls (protect paying budget)", async () => {
    let last;
    for (let i = 0; i < 5; i++) last = await checkAndIncrementAiRateLimit("user_fcap", FOREIGN);
    expect(last?.allowed).toBe(false);
    expect(last?.reason).toBe("foreign");
    // global consumed at most foreignLimit, leaving >= dailyLimit - foreignLimit for paid context
    const today = new Date().toISOString().split("T")[0];
    expect(parseInt(store.get(`ai:rate:user_fcap:${today}`) ?? "0", 10)).toBeLessThanOrEqual(3);
  });

  it("status (read-only) reflects the foreign cap without incrementing", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:foreign:user_fs:${today}`, "2");
    store.set(`ai:rate:user_fs:${today}`, "4");
    const result = await getRateLimitStatus("user_fs", FOREIGN);
    expect(result.remaining).toBe(1); // min(20-4, 3-2)
    expect(store.get(`ai:rate:foreign:user_fs:${today}`)).toBe("2");
  });
});
