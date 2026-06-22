import { after, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getMobilePlatform } from "@/lib/mobile-auth";
import { AnalyticsCategory, type Prisma } from "@prisma/client";
import { getServerActionLabel, type ServerActionOutcome } from "./server-log-shared";

// Re-export the client-safe helpers so existing `@/lib/server-log`
// imports across server routes and actions keep resolving unchanged.
// Client components must import these from `@/lib/server-log-shared`
// directly — importing them through this module would pull `after`
// and the Prisma `db` client into the browser bundle.
export * from "./server-log-shared";

export interface LogServerActionInput {
  userId?: string | null;
  action: string;
  category: AnalyticsCategory;
  outcome: ServerActionOutcome;
  path?: string;
  method?: string;
  platform?: "web" | "android" | "ios";
  metadata?: Record<string, unknown>;
  error?: string;
  /** Next.js server action id, e.g. `actions/booking.selectCashPayment`. */
  source?: string;
}

/** Infer web vs mobile platform from an incoming API request. */
export function resolveRequestPlatform(
  request?: NextRequest,
): "web" | "android" | "ios" {
  if (!request) return "web";
  if (request.headers.get("authorization")?.startsWith("Bearer ")) {
    const platform = getMobilePlatform(request);
    return platform === "android" ? "android" : "ios";
  }
  return "web";
}

/** Convenience wrapper for booking API route audit logs. */
export function logBookingRequest(
  request: NextRequest,
  action: string,
  outcome: ServerActionOutcome,
  opts: {
    userId?: string | null;
    metadata?: Record<string, unknown>;
    error?: string;
  } = {},
): void {
  logServerAction({
    userId: opts.userId ?? null,
    action,
    category: AnalyticsCategory.BOOKING,
    outcome,
    path: request.nextUrl.pathname,
    method: request.method,
    platform: resolveRequestPlatform(request),
    metadata: opts.metadata,
    error: opts.error,
  });
}

/** Convenience wrapper for Next.js server-action audit logs (web). */
export function logWebServerAction(
  source: string,
  input: Omit<LogServerActionInput, "path" | "method" | "platform" | "source">,
): void {
  logServerAction({
    ...input,
    platform: "web",
    source,
  });
}

/**
 * Server-side audit log. Never throws — failures are written to stderr
 * so a logging outage can't break bookings/payments.
 *
 * The insert is scheduled on the request's `after()` window so Vercel
 * keeps the serverless function alive until the row is flushed. A bare
 * fire-and-forget promise is killed the moment the route returns its
 * response — the same trap that orphaned MSG91 dispatches (see
 * app/api/razorpay/verify/route.ts) — which would silently drop audit
 * rows. `after()` throws when called outside a request scope (build
 * step, standalone scripts, tests); there we fall back to best-effort
 * fire-and-forget.
 */
export function logServerAction(input: LogServerActionInput): void {
  const label = getServerActionLabel(input.action);
  const path = input.path ?? input.source ?? null;
  const method = input.method ?? (input.source ? "ACTION" : null);
  const metadata: Record<string, unknown> = {
    ...input.metadata,
    label,
  };
  if (method && path) {
    metadata.endpoint = `${method} ${path}`;
  }
  if (metadata.sport != null) {
    metadata.sport = String(metadata.sport);
  }

  const persist = () =>
    db.serverActionLog
      .create({
        data: {
          userId: input.userId ?? null,
          action: input.action,
          category: input.category,
          outcome: input.outcome,
          path: path ?? null,
          method: method ?? null,
          platform: input.platform ?? "web",
          metadata: metadata as Prisma.InputJsonValue,
          error: input.error ?? null,
        },
      })
      .catch((err) => {
        console.error("[server-log] write failed", input.action, err);
      });

  try {
    after(persist);
  } catch {
    void persist();
  }
}
