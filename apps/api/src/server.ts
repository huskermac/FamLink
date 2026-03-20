import express from "express";
import helmet from "helmet";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { router } from "./routes";

export function createApp(): express.Application {
  const app = express();

  app.use(corsMiddleware);
  app.use(helmet());
  app.use(express.json({ limit: "10mb" }));
  app.use(requestLogger);
  app.use("/", router);
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(errorHandler);

  return app;
}
