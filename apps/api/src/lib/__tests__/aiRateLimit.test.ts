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
    const result = await checkAndIncrementAiRateLimit("user_alice", 20);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(19);
    expect(result.resetAt).toBeInstanceOf(Date);
  });

  it("decrements remaining on subsequent calls", async () => {
    // Pre-populate with 3 prior calls
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_bob:${today}`, "3");

    const result = await checkAndIncrementAiRateLimit("user_bob", 20);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(16); // 20 - 3 - 1 = 16
  });

  it("returns allowed: false and remaining: 0 when limit is reached", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_carol:${today}`, "20");

    const result = await checkAndIncrementAiRateLimit("user_carol", 20);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("never grants more than the daily limit across concurrent calls", async () => {
    // 30 simultaneous requests against a fresh counter — only 20 may be allowed.
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        checkAndIncrementAiRateLimit("user_concurrent", 20)
      )
    );
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(20);
  });

  it("allows exactly the 20th call and returns remaining: 0", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_dave:${today}`, "19");

    const result = await checkAndIncrementAiRateLimit("user_dave", 20);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("blocks a free-tier user after their lower limit", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_free:${today}`, "3");

    const result = await checkAndIncrementAiRateLimit("user_free", 3);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("Redis key includes today's UTC date", async () => {
    await checkAndIncrementAiRateLimit("user_eve", 20);

    const today = new Date().toISOString().split("T")[0];
    expect(mockRedis.incr).toHaveBeenCalledWith(`ai:rate:user_eve:${today}`);
  });

  it("sets TTL of 86400 only on the first request of the day", async () => {
    await checkAndIncrementAiRateLimit("user_frank", 20);
    expect(mockRedis.expire).toHaveBeenCalledWith(
      expect.stringContaining("user_frank"),
      86400
    );

    // Second call same day must not re-arm the TTL (would extend the window).
    mockRedis.expire.mockClear();
    await checkAndIncrementAiRateLimit("user_frank", 20);
    expect(mockRedis.expire).not.toHaveBeenCalled();
  });
});

describe("getRateLimitStatus", () => {
  it("returns full quota when no key exists", async () => {
    const result = await getRateLimitStatus("user_new", 20);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(20);
  });

  it("returns correct remaining count without incrementing", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_known:${today}`, "5");

    const result = await getRateLimitStatus("user_known", 20);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(15);
    expect(mockRedis.incr).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("returns allowed: false when limit exhausted", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_maxed:${today}`, "20");

    const result = await getRateLimitStatus("user_maxed", 20);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});
