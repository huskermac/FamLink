import cors from "cors";
import { env } from "../lib/env";

export const corsMiddleware = cors({
  // Browser origins never have a trailing slash; tolerate one in the env var.
  origin: env.WEB_APP_URL.replace(/\/$/, ""),
  credentials: true
});
