import type { NextFunction, Request, Response } from "express";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { db, type Person } from "@famlink/db";
import { ERROR_PERSON_RECORD_REQUIRED } from "../lib/personRequiredMessages";

export const clerkAuth = clerkMiddleware();

export interface AuthedRequest extends Request {
  userId: string;
}

export interface PersonRequest extends AuthedRequest {
  person: Person;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthedRequest).userId = userId;
  next();
}

/**
 * Resolves the authenticated user's Person record once per request and
 * attaches it as `req.person` (mount after requireAuth). Routes that must
 * work without a Person record (person creation, family creation with its
 * onboarding-specific error) do NOT use this middleware.
 */
export async function requirePerson(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if ((req as PersonRequest).person) {
    next();
    return;
  }
  const { userId } = req as AuthedRequest;
  const person = await db.person.findUnique({ where: { userId } });
  if (!person) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }
  (req as PersonRequest).person = person;
  next();
}

/** Accessor for handlers mounted behind requireAuth + requirePerson. */
export function personed(req: Request): PersonRequest {
  return req as PersonRequest;
}
