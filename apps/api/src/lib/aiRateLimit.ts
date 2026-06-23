/**
 * AI Rate Limiter (ADR-06)
 *
 * Enforces 20 AI queries per user per day using Redis.
 * Key format: ai:rate:{userId}:{YYYY-MM-DD} (UTC date)
 * TTL: 86400 seconds — resets at UTC midnight.
 */

import IORedis from "ioredis";
import { env } from "./env";

// Lazily initialized — not created at module import time so tests can mock it.
let _redis: IORedis | null = null;

export function getRedisClient(): IORedis {
  if (!_redis) {
    _redis = new IORedis(env.REDIS_URL);
  }
  return _redis;
}

/** Exposed for testing — allows injecting a mock client. */
export function setRedisClient(client: IORedis): void {
  _redis = client;
}

const TTL_SECONDS = 86400;

function todayUtcKey(userId: string): string {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD UTC
  return `ai:rate:${userId}:${today}`;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

function nextUtcMidnight(): Date {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  return midnight;
}

/**
 * Check and increment the AI rate limit counter for a user.
 * Returns whether the request is allowed and how many queries remain.
 *
 * Uses an atomic INCR so concurrent requests cannot race past the limit:
 * the single INCR result is authoritative. TTL is set on the first request
 * of the day (when INCR returns 1). A blocked request still increments — the
 * counter overcounts harmlessly and self-clears at the UTC-midnight TTL.
 */
export async function checkAndIncrementAiRateLimit(
  userId: string,
  limit: number
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const key = todayUtcKey(userId);
  const resetAt = nextUtcMidnight();

  const count = await redis.incr(key);

  if (count === 1) {
    // First request today — attach the TTL so the key resets at UTC midnight.
    await redis.expire(key, TTL_SECONDS);
  }

  if (count > limit) {
    return { allowed: false, remaining: 0, resetAt };
  }

  return { allowed: true, remaining: limit - count, resetAt };
}

/**
 * Read-only status check — does NOT increment the counter.
 * Used by GET /api/v1/ai/status.
 */
export async function getRateLimitStatus(
  userId: string,
  limit: number
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const key = todayUtcKey(userId);
  const resetAt = nextUtcMidnight();

  const current = await redis.get(key);

  if (current === null) {
    return { allowed: true, remaining: limit, resetAt };
  }

  const count = parseInt(current, 10);
  const remaining = Math.max(0, limit - count);
  return { allowed: count < limit, remaining, resetAt };
}
