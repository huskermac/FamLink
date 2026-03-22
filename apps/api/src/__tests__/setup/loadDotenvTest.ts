import { config } from "dotenv";
import path from "path";

/** Loads `apps/api/.env.test` so `TEST_DATABASE_URL` is set before Jest runs. */
export function loadDotenvTest(): void {
  const envPath = path.resolve(__dirname, "../../../.env.test");
  config({ path: envPath });
}
