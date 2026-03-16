import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prismaClient: PrismaClient =
  global.prisma ??
  new PrismaClient({
    log: ["error", "warn"]
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prismaClient;
}

