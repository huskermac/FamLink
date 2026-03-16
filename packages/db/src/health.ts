import { db } from "./index";

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

