import { loadDotenvTest } from "./loadDotenvTest";

/**
 * Jest globalTeardown runs outside the normal test `moduleNameMapper` graph, so
 * `import { db } from "@famlink/db"` can resolve to `packages/db/dist` and fail if
 * the client is not built. Skipping `db.$disconnect()` is acceptable here — the
 * test worker process exits and Prisma closes the pool.
 */
export default async function globalTeardown(): Promise<void> {
  loadDotenvTest();
}
