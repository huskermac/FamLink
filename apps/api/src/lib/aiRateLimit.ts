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

const DAILY_LIMIT = 20;
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
 */
export async function checkAndIncrementAiRateLimit(
  userId: string
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const key = todayUtcKey(userId);
  const resetAt = nextUtcMidnight();

  const current = await redis.get(key);

  if (current === null) {
    // First request today — create key with TTL
    await redis.set(key, 1, "EX", TTL_SECONDS);
    return { allowed: true, remaining: DAILY_LIMIT - 1, resetAt };
  }

  const count = parseInt(current, 10);

  if (count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0, resetAt };
  }

  await redis.incr(key);
  return { allowed: true, remaining: DAILY_LIMIT - count - 1, resetAt };
}

/**
 * Read-only status check — does NOT increment the counter.
 * Used by GET /api/v1/ai/status.
 */
export async function getRateLimitStatus(
  userId: string
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const key = todayUtcKey(userId);
  const resetAt = nextUtcMidnight();

  const current = await redis.get(key);

  if (current === null) {
    return { allowed: true, remaining: DAILY_LIMIT, resetAt };
  }

  const count = parseInt(current, 10);
  const remaining = Math.max(0, DAILY_LIMIT - count);
  return { allowed: count < DAILY_LIMIT, remaining, resetAt };
}
