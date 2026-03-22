import { loadDotenvTest } from "./loadDotenvTest";

export default async function globalTeardown(): Promise<void> {
  loadDotenvTest();
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  }
  const { db } = await import("@famlink/db");
  await db.$disconnect();
}
