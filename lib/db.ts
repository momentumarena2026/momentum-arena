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
 *
 * Why the lazy Proxy
 * ------------------
 * This module is imported transitively by modules that are also reached
 * from client bundles (e.g. lib/pricing.ts exports formatPrice used by
 * slot-grid.tsx *and* exports a server-only getSlotPricesForDate that
 * uses db). Evaluating `new PrismaClient()` at module-load time would
 * throw in the browser because DATABASE_URL is not set there. The Proxy
 * defers client construction to the first property access, which only
 * ever happens on the server.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let cachedClient: PrismaClient | null = null;

function getClient(): PrismaClient {
  if (cachedClient) return cachedClient;
  if (globalForPrisma.prisma) {
    cachedClient = globalForPrisma.prisma;
    return cachedClient;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaNeon({ connectionString });
  cachedClient = new PrismaClient({ adapter });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = cachedClient;
  }

  return cachedClient;
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});
