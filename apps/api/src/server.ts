import express from "express";
import helmet from "helmet";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/errorHandler";
import { clerkAuth } from "./middleware/requireAuth";
import { requestLogger } from "./middleware/requestLogger";
import { router } from "./routes";
import { webhooksRouter } from "./routes/webhooks";

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
  app.use(clerkAuth);
  app.use("/", router);
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(errorHandler);

  return app;
}
