import cors from "cors";
import { env } from "../lib/env";

export const corsMiddleware = cors({
  origin: env.WEB_APP_URL,
  credentials: true
});
