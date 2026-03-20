import type { NextFunction, Request, Response } from "express";
import { clerkMiddleware, getAuth } from "@clerk/express";

export const clerkAuth = clerkMiddleware();

export interface AuthedRequest extends Request {
  userId: string;
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
