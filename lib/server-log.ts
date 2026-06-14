import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getMobilePlatform } from "@/lib/mobile-auth";
import { AnalyticsCategory, type Prisma } from "@prisma/client";

export { AnalyticsCategory };

export type ServerActionOutcome = "success" | "error";

/** Parse a URL/filter param into {@link AnalyticsCategory}, or undefined. */
export function parseAnalyticsCategory(
  value: string | undefined,
): AnalyticsCategory | undefined {
  if (!value) return undefined;
  return (Object.values(AnalyticsCategory) as string[]).includes(value)
    ? (value as AnalyticsCategory)
    : undefined;
}

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

/**
 * Fire-and-forget server-side audit log. Never throws — failures are
 * written to stderr so a logging outage can't break bookings/payments.
 */
export function logServerAction(input: LogServerActionInput): void {
  void db.serverActionLog
    .create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        category: input.category,
        outcome: input.outcome,
        path: input.path ?? null,
        method: input.method ?? null,
        platform: input.platform ?? "web",
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        error: input.error ?? null,
      },
    })
    .catch((err) => {
      console.error("[server-log] write failed", input.action, err);
    });
}
