import * as path from "path";
import * as dotenv from "dotenv";

// Load root monorepo .env for local development.
// In production (Railway) DATABASE_URL is set directly in the environment.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node --transpile-only prisma/seed.ts",
  },
  datasource: {
    // `prisma generate` runs in env-less build containers (Railway build
    // stage, CI) and never connects — fall back to a placeholder there.
    // Commands that DO connect (migrate, studio, seed) run where the real
    // DATABASE_URL exists; against the placeholder they fail loudly.
    url: process.env.DATABASE_URL || "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
