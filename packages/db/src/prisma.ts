import { PrismaClient } from "./generated/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  // eslint-disable-next-line no-var
  var __famlinkPrisma: PrismaClient | undefined;
}

const createPrismaClient = (): PrismaClient => {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  return new PrismaClient({ adapter, log: ["error", "warn"] });
};

export const db: PrismaClient =
  process.env.NODE_ENV === "production"
    ? createPrismaClient()
    : (global.__famlinkPrisma ??= createPrismaClient());
