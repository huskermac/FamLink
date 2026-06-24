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

function todayUtcDate(): string {
  return new Date().toISOString().split("T")[0]; // YYYY-MM-DD UTC
}
function globalKey(userId: string): string {
  return `ai:rate:${userId}:${todayUtcDate()}`;
}
function foreignKey(userId: string): string {
  return `ai:rate:foreign:${userId}:${todayUtcDate()}`;
}

export interface RateLimitContext {
  /** Global per-person daily allowance (20 covered / 3 free) — the hard cap. */
  dailyLimit: number;
  /** True when the request is made in a family that does not cover this person. */
  foreign: boolean;
  /** Aggregate cap on foreign-context usage (bounds the bleed from the paying budget). */
  foreignLimit: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  reason?: "global" | "foreign";
}

function nextUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/**
 * Check + increment. Foreign-context requests check the foreign aggregate counter
 * FIRST, then the global counter. Daily reset is by the date in the key; the TTL
 * is set on EVERY increment (idempotent — closes the crash-between-INCR-and-EXPIRE
 * gap). The only foreign overcount is when the global cap also rejects (user already
 * blocked that day) — benign and self-clearing.
 */
export async function checkAndIncrementAiRateLimit(
  userId: string,
  ctx: RateLimitContext
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const resetAt = nextUtcMidnight();

  let foreignCount = 0;
  if (ctx.foreign) {
    const fKey = foreignKey(userId);
    foreignCount = await redis.incr(fKey);
    await redis.expire(fKey, TTL_SECONDS);
    if (foreignCount > ctx.foreignLimit) {
      return { allowed: false, remaining: 0, resetAt, reason: "foreign" };
    }
  }

  const gKey = globalKey(userId);
  const globalCount = await redis.incr(gKey);
  await redis.expire(gKey, TTL_SECONDS);
  if (globalCount > ctx.dailyLimit) {
    return { allowed: false, remaining: 0, resetAt, reason: "global" };
  }

  const globalRemaining = ctx.dailyLimit - globalCount;
  const remaining = ctx.foreign ? Math.min(globalRemaining, ctx.foreignLimit - foreignCount) : globalRemaining;
  return { allowed: true, remaining: Math.max(0, remaining), resetAt };
}

/** Read-only — does NOT increment. */
export async function getRateLimitStatus(
  userId: string,
  ctx: RateLimitContext
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const resetAt = nextUtcMidnight();

  const globalCount = parseInt((await redis.get(globalKey(userId))) ?? "0", 10);
  const globalRemaining = Math.max(0, ctx.dailyLimit - globalCount);

  let remaining = globalRemaining;
  if (ctx.foreign) {
    const foreignCount = parseInt((await redis.get(foreignKey(userId))) ?? "0", 10);
    remaining = Math.min(globalRemaining, Math.max(0, ctx.foreignLimit - foreignCount));
  }
  return { allowed: remaining > 0, remaining, resetAt };
}
