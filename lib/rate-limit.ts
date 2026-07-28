import { db } from "@/lib/db";

/**
 * Generic fixed-window rate limiter over the shared RateLimit table
 * (the same one lib/otp.ts and the mobile admin login use, keyed by
 * `action` so the windows never collide).
 *
 * Fixed-window is deliberate: it is one indexed upsert per call and the
 * worst case — a burst spanning a window boundary — is 2× the limit,
 * which is fine for the abuse this guards against (credential guessing,
 * scraping), as opposed to precise quota enforcement.
 */
export async function checkRateLimit(args: {
  identifier: string;
  action: string;
  limit: number;
  windowSeconds: number;
  /** Read the counter without spending one. Pair with recordRateLimitHit()
   *  on the failure path when only failures should count toward the cap
   *  (credential guessing) and legitimate traffic must stay unthrottled. */
  peek?: boolean;
}): Promise<{ allowed: boolean; retryAfter: number }> {
  const { identifier, action, limit, windowSeconds, peek } = args;
  const now = new Date();
  const key = { identifier_action: { identifier: identifier.slice(0, 190), action } };

  try {
    const record = await db.rateLimit.findUnique({ where: key });
    const windowExpired =
      !record || record.windowStart.getTime() + windowSeconds * 1000 <= now.getTime();

    if (windowExpired) {
      if (!peek) {
        await db.rateLimit.upsert({
          where: key,
          create: { identifier: identifier.slice(0, 190), action, count: 1, windowStart: now },
          update: { count: 1, windowStart: now },
        });
      }
      return { allowed: true, retryAfter: 0 };
    }

    if (record.count >= limit) {
      const retryAfter = Math.max(
        1,
        Math.ceil((record.windowStart.getTime() + windowSeconds * 1000 - now.getTime()) / 1000)
      );
      return { allowed: false, retryAfter };
    }

    if (!peek) await db.rateLimit.update({ where: key, data: { count: { increment: 1 } } });
    return { allowed: true, retryAfter: 0 };
  } catch {
    // Never let the limiter itself take an endpoint down.
    return { allowed: true, retryAfter: 0 };
  }
}

/** Spend one unit of a peeked budget — call on the failure path only. */
export async function recordRateLimitHit(args: {
  identifier: string;
  action: string;
  windowSeconds: number;
}): Promise<void> {
  const { identifier, action, windowSeconds } = args;
  const now = new Date();
  const key = { identifier_action: { identifier: identifier.slice(0, 190), action } };
  try {
    const record = await db.rateLimit.findUnique({ where: key });
    const expired =
      !record || record.windowStart.getTime() + windowSeconds * 1000 <= now.getTime();
    await db.rateLimit.upsert({
      where: key,
      create: { identifier: identifier.slice(0, 190), action, count: 1, windowStart: now },
      update: expired ? { count: 1, windowStart: now } : { count: { increment: 1 } },
    });
  } catch {
    /* never let bookkeeping break a response */
  }
}

/** Best-effort client IP from the proxy headers Vercel sets. */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") || "unknown";
}
