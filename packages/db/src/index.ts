import { PrismaClient } from "./generated/client";

declare global {
  // eslint-disable-next-line no-var
  var __famlinkPrisma: PrismaClient | undefined;
}

const createPrismaClient = (): PrismaClient =>
  new PrismaClient({
    log: ["error", "warn"]
  });

export const db: PrismaClient =
  process.env.NODE_ENV === "production"
    ? createPrismaClient()
    : (global.__famlinkPrisma ??= createPrismaClient());

export * from "./generated/client";

