import * as path from "path";
import * as dotenv from "dotenv";

// Load root monorepo .env for local development.
// In production (Railway) DATABASE_URL is set directly in the environment.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node --transpile-only prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
