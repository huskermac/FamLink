import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does not forward async rejections to the error handler — a thrown
 * `await` inside an async route handler becomes an unhandled rejection and
 * crashes the process (Railway then answers 502). Wrap handlers so rejections
 * flow to errorHandler as ordinary 500s.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}
