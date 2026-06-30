import { request } from "./admin-api";

/**
 * API client + pure helpers for the mobile Events & logs screen, a
 * mirror of the web /admin/analytics/events page (events-client.tsx +
 * server-logs-client.tsx). Kept separate from admin-insights.ts (the
 * shared analytics client) so this screen can carry its own richer
 * filter params, the distinct-name lists, and the server-log label /
 * badge helpers without bloating the shared module.
 *
 * The label maps + metadata parsers below are ported verbatim from the
 * web's lib/server-log-shared.ts — the mobile bundle can't import that
 * file (it re-exports Prisma enums), so the pure logic is duplicated.
 * JSON blobs the web types as Prisma.JsonValue surface as `unknown`.
 */

// ---------- Row + result shapes (mirror actions/admin-insights.ts) ----------

export interface EventRow {
  id: string;
  name: string;
  category: string;
  userId: string | null;
  userName: string | null;
  userPhone: string | null;
  sessionId: string;
  platform: string;
  properties: unknown;
  pageUrl: string | null;
  occurredAt: string;
}

export interface EventsListResult {
  rows: EventRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ServerLogRow {
  id: string;
  action: string;
  category: string;
  outcome: string;
  userId: string | null;
  userName: string | null;
  userPhone: string | null;
  path: string | null;
  method: string | null;
  platform: string;
  metadata: unknown;
  sport: string | null;
  error: string | null;
  occurredAt: string;
}

export interface ServerLogsListResult {
  rows: ServerLogRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

// ---------- Filter option lists (mirror the web dropdowns) ----------

/** AnalyticsCategory enum values — kept in sync with the web CATEGORIES
 *  list in events-client.tsx / the Prisma AnalyticsCategory enum. */
export const ANALYTICS_CATEGORIES = [
  "BOOKING",
  "PAYMENT",
  "AUTH",
  "CAFE",
  "WAITLIST",
  "NAVIGATION",
  "ADMIN",
  "ERROR",
  "SYSTEM",
] as const;

export type AnalyticsCategory = (typeof ANALYTICS_CATEGORIES)[number];

export const OUTCOME_OPTIONS = ["success", "error"] as const;

// ---------- Server-log label maps (ported from server-log-shared.ts) ----------

const SPORTS = ["CRICKET", "FOOTBALL", "PICKLEBALL", "BOWLING"];

/** Human-readable labels for admin server logs (keyed by `action`). */
const SERVER_ACTION_LABELS: Record<string, string> = {
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
  "payment.dqr.initiate": "Generated UPI QR (DQR)",
  "payment.dqr.callback": "Confirmed UPI QR payment (DQR)",
  "payment.cash.commit": "Confirmed cash payment",
  "payment.cash.advance_commit": "Confirmed advance UPI payment",
  "payment.select_payment": "Selected payment method",
  "payment.orphan": "⚠ Orphaned payment — needs recovery/refund",
};

/** Friendly labels for payment methods stored in log metadata. */
const PAYMENT_METHOD_LABELS: Record<string, string> = {
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

/** Human-friendly payment-method label for admin badges. */
export function formatPaymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

function metadataHoldId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const holdId = (metadata as Record<string, unknown>).holdId;
  return typeof holdId === "string" && holdId.trim() ? holdId : null;
}

/** Pull `sport` from log metadata when it matches a known sport. */
export function extractSportFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const sport = (metadata as Record<string, unknown>).sport;
  if (typeof sport !== "string" || !sport.trim()) return null;
  const key = sport.toUpperCase();
  return SPORTS.includes(key) ? key : null;
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

// ---------- Filters ----------

export interface ClientEventFilters {
  name?: string;
  category?: string;
  userId?: string;
  sessionId?: string;
  before?: string;
  limit?: number;
}

export interface ServerLogFilters {
  action?: string;
  category?: string;
  outcome?: string;
  userId?: string;
  before?: string;
  limit?: number;
}

// ---------- API client ----------

const BASE = "/api/mobile/admin/analytics/events";

export const adminEventsApi = {
  /** Page of client AnalyticsEvent rows (newest first). */
  clientEvents(filters: ClientEventFilters = {}): Promise<EventsListResult> {
    const sp = new URLSearchParams();
    sp.set("tab", "client");
    if (filters.name) sp.set("name", filters.name);
    if (filters.category) sp.set("category", filters.category);
    if (filters.userId) sp.set("userId", filters.userId);
    if (filters.sessionId) sp.set("sessionId", filters.sessionId);
    if (filters.before) sp.set("before", filters.before);
    if (filters.limit) sp.set("limit", String(filters.limit));
    return request(`${BASE}?${sp.toString()}`, { method: "GET" });
  },

  /** Page of ServerActionLog rows (newest first). */
  serverLogs(filters: ServerLogFilters = {}): Promise<ServerLogsListResult> {
    const sp = new URLSearchParams();
    sp.set("tab", "server");
    // The route reads the action filter off the shared `name` param.
    if (filters.action) sp.set("name", filters.action);
    if (filters.category) sp.set("category", filters.category);
    if (filters.outcome) sp.set("outcome", filters.outcome);
    if (filters.userId) sp.set("userId", filters.userId);
    if (filters.before) sp.set("before", filters.before);
    if (filters.limit) sp.set("limit", String(filters.limit));
    return request(`${BASE}?${sp.toString()}`, { method: "GET" });
  },

  /** Distinct event names (last 30 days) for the client-tab name filter. */
  async eventNames(): Promise<string[]> {
    const res = await request<{ names: string[] }>(
      `${BASE}?tab=client&names=1`,
      { method: "GET" },
    );
    return res.names;
  },

  /** Distinct action names (all time) for the server-tab action filter. */
  async actionNames(): Promise<string[]> {
    const res = await request<{ names: string[] }>(
      `${BASE}?tab=server&names=1`,
      { method: "GET" },
    );
    return res.names;
  },
};
