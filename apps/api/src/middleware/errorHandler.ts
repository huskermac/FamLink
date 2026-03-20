import type { NextFunction, Request, Response } from "express";
import { env } from "../lib/env";

function getStatus(err: unknown): number {
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    return (err as { status: number }).status;
  }
  return 500;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error(err);
  const status = getStatus(err);
  const message =
    err instanceof Error ? err.message : "Internal server error";
  if (env.NODE_ENV === "development") {
    const stack = err instanceof Error ? err.stack : undefined;
    res.status(status).json({
      error: message,
      stack
    });
    return;
  }
  res.status(status).json({ error: "Internal server error" });
}
