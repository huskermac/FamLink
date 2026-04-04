import { config } from "dotenv";
import path from "path";

/**
 * Load env files before `lib/env` parses. Monorepo root `.env` is not read automatically
 * when `npm run dev` runs from `apps/api`; `../../.env` fixes that.
 */
const cwd = process.cwd();
config({ path: path.join(cwd, ".env") });
config({ path: path.join(cwd, "..", "..", ".env") });
config({ path: path.join(cwd, "..", "..", ".env.local") });
