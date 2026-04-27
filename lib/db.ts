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
/**
 * Patch `globalThis.WebSocket` to a `ws`-based, IPv4-forced wrapper.
 *
 * Why: `@neondatabase/serverless` falls back to `globalThis.WebSocket`
 * when `neonConfig.webSocketConstructor` is unset on its local module
 * instance. Setting `neonConfig` directly is unreliable under Turbopack
 * because the dev server can bundle `@neondatabase/serverless` more
 * than once (we see `lib/db.ts` itself loaded 3-4 times) — each bundle
 * has its own `neonConfig` singleton. Patching the global is the one
 * channel every bundle's fallback path agrees on.
 *
 * Why this is needed at all: Node 22's native WebSocket (undici) fails
 * the WS upgrade against Neon when the local network has no IPv6 route
 * to AWS — Happy Eyeballs surfaces the IPv6 ETIMEDOUT instead of
 * falling back to IPv4, which the dev server logs as the unhelpful
 * `Error: [object ErrorEvent]` 500. The `ws` package respects
 * `{ family: 4 }` and works.
 *
 * Idempotent — re-runs on hot reload but skipped after first patch.
 * Skipped on Edge runtime / browser (no `process` / `ws` package).
 */
function patchGlobalWebSocket(): void {
  if ((globalThis as { __neonWsPatched?: boolean }).__neonWsPatched) return;
  if (typeof process === "undefined") return;
  if (process.env.NEXT_RUNTIME === "edge") return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const NodeWebSocket = require("ws");
  class IPv4WebSocket extends NodeWebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { family: 4 });
    }
  }
  (globalThis as { WebSocket?: unknown }).WebSocket = IPv4WebSocket;
  (globalThis as { __neonWsPatched?: boolean }).__neonWsPatched = true;
}

function getClient(): PrismaClient {
  patchGlobalWebSocket();

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
