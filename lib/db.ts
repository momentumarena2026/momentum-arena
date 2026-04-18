import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

/**
 * Prisma client wired to Neon via their serverless driver adapter.
 *
 * Why this matters in production
 * ------------------------------
 * Neon auto-pauses compute on idle (free tier: ~5 min). The default Prisma
 * binary engine maintains a TCP connection pool inside Node; when Neon has
 * closed those connections after a pause, the first requests after wake-up
 * hit "Server has closed the connection" (P1017) until the pool refreshes.
 *
 * The Neon driver adapter replaces Prisma's TCP pool with Neon's
 * serverless driver, which opens short-lived connections per query /
 * transaction and transparently wakes paused compute on the first call.
 * No more P1017 bursts on cold endpoints like admin pages.
 *
 * The global singleton pattern stays the same for dev hot-reload safety.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
