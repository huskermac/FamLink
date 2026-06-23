import rateLimit from "express-rate-limit";

/**
 * Per-IP rate limiter factory for unauthenticated / token-based endpoints.
 */
export function createRateLimiter(opts: { windowMs: number; limit: number }) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests — please slow down and try again later." }
  });
}

/**
 * Guest endpoints are unauthenticated or token-based (public invitation
 * lookups, guest RSVP). Cap per-IP volume to blunt token enumeration / abuse.
 */
export const guestRateLimiter = createRateLimiter({ windowMs: 60_000, limit: 60 });
