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
  })
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
    const result = await checkAndIncrementAiRateLimit("user_alice");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(19);
    expect(result.resetAt).toBeInstanceOf(Date);
  });

  it("decrements remaining on subsequent calls", async () => {
    // Pre-populate with 3 prior calls
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_bob:${today}`, "3");

    const result = await checkAndIncrementAiRateLimit("user_bob");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(16); // 20 - 3 - 1 = 16
  });

  it("returns allowed: false and remaining: 0 when limit is reached", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_carol:${today}`, "20");

    const result = await checkAndIncrementAiRateLimit("user_carol");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(mockRedis.incr).not.toHaveBeenCalled();
  });

  it("allows exactly the 20th call and returns remaining: 0", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_dave:${today}`, "19");

    const result = await checkAndIncrementAiRateLimit("user_dave");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("Redis key includes today's UTC date", async () => {
    await checkAndIncrementAiRateLimit("user_eve");

    const today = new Date().toISOString().split("T")[0];
    expect(mockRedis.get).toHaveBeenCalledWith(`ai:rate:user_eve:${today}`);
  });

  it("sets TTL of 86400 on key creation", async () => {
    await checkAndIncrementAiRateLimit("user_frank");

    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining("user_frank"),
      1,
      "EX",
      86400
    );
  });
});

describe("getRateLimitStatus", () => {
  it("returns full quota when no key exists", async () => {
    const result = await getRateLimitStatus("user_new");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(20);
  });

  it("returns correct remaining count without incrementing", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_known:${today}`, "5");

    const result = await getRateLimitStatus("user_known");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(15);
    expect(mockRedis.incr).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("returns allowed: false when limit exhausted", async () => {
    const today = new Date().toISOString().split("T")[0];
    store.set(`ai:rate:user_maxed:${today}`, "20");

    const result = await getRateLimitStatus("user_maxed");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});
