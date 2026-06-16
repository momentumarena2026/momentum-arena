import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getMobilePlatform } from "@/lib/mobile-auth";
import { AnalyticsCategory, Sport, type Prisma } from "@prisma/client";

export { AnalyticsCategory };

export type ServerActionOutcome = "success" | "error";

/** Human-readable labels for admin server logs (keyed by `action`). */
export const SERVER_ACTION_LABELS: Record<string, string> = {
  // Booking funnel — browse & slot selection
  "booking.view_availability": "Viewed slot availability",
  "booking.view_bowling_availability": "Viewed bowling slot availability",
  "booking.view_court_configs": "Viewed court options",
  "booking.select_court_config": "Selected court size",
  "booking.view_equipment": "Viewed equipment options",
  "booking.view_sport_promo": "Viewed sport promo",
  "booking.lock": "Reserved slots",
  "booking.release_hold": "Released slot reservation",
  "booking.view_hold": "Viewed checkout hold",
  "booking.apply_coupon": "Applied coupon",
  "booking.clear_coupon": "Removed coupon",
  "booking.apply_equipment": "Selected equipment",
  "booking.clear_equipment": "Cleared equipment selection",
  "booking.apply_points": "Applied Momentum Points",
  "booking.clear_points": "Removed Momentum Points",
  // Payments
  "payment.razorpay.create_order": "Started Razorpay payment",
  "payment.razorpay.verify": "Confirmed Razorpay payment",
  "payment.phonepe.initiate": "Started PhonePe payment",
  "payment.phonepe.redirect": "PhonePe payment redirect",
  "payment.phonepe.callback": "PhonePe payment callback",
  "payment.upi_qr.commit": "Confirmed UPI QR payment",
  "payment.cash.commit": "Confirmed cash payment",
  "payment.cash.advance_commit": "Confirmed advance UPI payment",
  "payment.select_payment": "Selected payment method",
};

/** Friendly labels for payment methods stored in log metadata. */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  online: "Pay online",
  upi_qr: "UPI QR",
  cash: "50% advance / pay at venue",
  UPI_QR: "UPI QR",
  CASH: "Cash at venue",
  RAZORPAY: "Razorpay",
  PHONEPE: "PhonePe",
};

/** Resolve a friendly label for an action string. */
export function getServerActionLabel(action: string): string {
  return SERVER_ACTION_LABELS[action] ?? action;
}

/** Pull `holdId` from log metadata, if present. */
export function metadataHoldId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const holdId = (metadata as Record<string, unknown>).holdId;
  return typeof holdId === "string" && holdId.trim() ? holdId : null;
}

/** Pull `sport` from log metadata when it matches the Prisma {@link Sport} enum. */
export function extractSportFromMetadata(metadata: unknown): Sport | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const sport = (metadata as Record<string, unknown>).sport;
  if (typeof sport !== "string" || !sport.trim()) return null;
  const key = sport.toUpperCase();
  return (Object.values(Sport) as string[]).includes(key)
    ? (key as Sport)
    : null;
}

/** Pull a payment method from log metadata (`paymentMethod` or `method`). */
export function extractPaymentMethodFromMetadata(
  metadata: unknown,
): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const m = metadata as Record<string, unknown>;
  for (const key of ["paymentMethod", "method"] as const) {
    const value = m[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/** Human-friendly payment method label for admin badges. */
export function formatPaymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

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
 * Fire-and-forget server-side audit log. Never throws — failures are
 * written to stderr so a logging outage can't break bookings/payments.
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

  void db.serverActionLog
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
}
