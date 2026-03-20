import { Router } from "express";
import { checkDatabaseHealth } from "@famlink/db";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  const ok = await checkDatabaseHealth();
  const timestamp = new Date().toISOString();
  if (ok) {
    res.status(200).json({
      status: "ok",
      db: "ok",
      timestamp
    });
    return;
  }
  res.status(503).json({
    status: "error",
    db: "error",
    timestamp
  });
});
