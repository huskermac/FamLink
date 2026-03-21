import type { NextFunction, Request, Response } from "express";
import type { GuestTokenPayload } from "../lib/guestToken";
import { verifyGuestToken } from "../lib/guestToken";

export interface GuestRequest extends Request {
  guest: GuestTokenPayload;
  /** Raw JWT string (for persisting on RSVP rows). */
  guestJwt: string;
}

function extractToken(req: Request): string | null {
  const q = req.query.token;
  if (typeof q === "string" && q.length > 0) {
    return q;
  }
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

export function requireGuestToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const raw = extractToken(req);
  if (!raw) {
    res.status(401).json({ error: "Guest token required" });
    return;
  }
  try {
    const guest = verifyGuestToken(raw);
    (req as GuestRequest).guest = guest;
    (req as GuestRequest).guestJwt = raw;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
