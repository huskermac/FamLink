import http from "http";
import express from "express";
import helmet from "helmet";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/errorHandler";
import { clerkAuth } from "./middleware/requireAuth";
import { requestLogger } from "./middleware/requestLogger";
import { router } from "./routes";
import { healthRouter } from "./routes/health";
import { webhooksRouter } from "./routes/webhooks";
import { initializeSocketServer } from "./lib/socketServer";

/**
 * createApp — returns the Express application only.
 * Used directly by Supertest in tests; does NOT start listening.
 */
export function createApp(): express.Application {
  const app = express();

  app.use(corsMiddleware);
  app.use(helmet());
  app.use(
    "/api/v1/webhooks/clerk",
    express.raw({ type: "application/json", limit: "10mb" }),
    webhooksRouter
  );
  app.use(express.json({ limit: "10mb" }));
  app.use(requestLogger);
  // Public health check — must run before Clerk or browsers get 307 handshake redirects
  app.use(healthRouter);
  app.get("/", (_req, res) => {
    res.status(200).json({
      service: "famlink-api",
      health: "/health",
      note: "FamLink web UI runs on WEB_APP_URL (e.g. http://localhost:3000), not this port."
    });
  });
  app.use(clerkAuth);
  app.use("/", router);
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(errorHandler);

  return app;
}

/**
 * createHttpServer — wraps the Express app in an http.Server and attaches
 * Socket.io. Used by index.ts for production; NOT called by tests.
 */
export function createHttpServer(): http.Server {
  const app = createApp();
  const httpServer = http.createServer(app);
  initializeSocketServer(httpServer);
  return httpServer;
}
