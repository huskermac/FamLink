import { execSync } from "child_process";
import path from "path";

export default async function globalSetup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL must be set to run API tests (see apps/api/.env.example)."
    );
  }

  const dbDir = path.resolve(__dirname, "../../../../../packages/db");
  execSync("npx prisma migrate deploy", {
    cwd: dbDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit"
  });
}
