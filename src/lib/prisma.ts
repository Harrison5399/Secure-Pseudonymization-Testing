import { PrismaClient } from "@prisma/client";

// Keep a single Prisma instance in dev to avoid connection churn on HMR.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  // Cache on globalThis only in development.
  globalForPrisma.prisma = prisma;
}
