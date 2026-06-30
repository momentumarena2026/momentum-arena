"use server";

import { requireAdmin } from "@/lib/admin-auth";
import {
  qrTransactionList,
  isQrReportingConfigured,
  getDqrStores,
  getDqrStoreId,
  type QrListTransaction,
} from "@/lib/phonepe-dqr";

/**
 * PhonePe transactions dashboard — sourced LIVE from PhonePe.
 *
 * PhonePe's PG product has no merchant-wide list/settlement/dispute API, but
 * its offline "Integrated Static QR" product DOES expose a transaction-list
 * endpoint (`POST /v3/qr/transaction/list`, keyed merchantId + storeId). Our
 * static QR codes AND our Dynamic QR (DQR) run under the same merchant + store,
 * so a single call returns BOTH — PhonePe's own record of every QR payment.
 *
 * This dashboard therefore reads straight from PhonePe (via
 * `lib/phonepe-dqr.ts` `qrTransactionList`), NOT from our DB — so it reflects
 * PhonePe's truth including payments whose S2S callback we may have missed.
 *
 * Scope note: this covers QR payments (static + DQR). It does NOT include
 * PhonePe Standard-Checkout (`/checkout/v2`, method PHONEPE) payments — those
 * are a different product with no list API; they only exist if PhonePe is set
 * as the card gateway (Razorpay is the default), and are out of scope here.
 *
 * Gated on VIEW_RAZORPAY (the existing "view payment-gateway data" permission).
 * Mobile admin routes pre-authenticate the bearer token and pass skipAuth=true.
 */

const PAGE_SIZE = 20;
// The API's only volume control is `size` (no end-timestamp, no offset/cursor),
// so we fetch a generous window from the start time and window client-side.
const MAX_LIST_SIZE = 250;

async function requireGatewayAccess() {
  return requireAdmin("VIEW_RAZORPAY");
}

export type PhonePeChannel = "STATIC" | "DQR";
export type PhonePeStatus = "COMPLETED" | "PENDING" | "FAILED";

export interface PhonePeTxn {
  id: string;
  channel: PhonePeChannel;
  /** Our merchant transaction id. */
  merchantTxnId: string | null;
  /** PhonePe-side reference id. */
  providerReferenceId: string | null;
  amount: number; // rupees
  status: PhonePeStatus;
  customerName: string | null;
  customerPhone: string | null; // masked by PhonePe
  utr: string | null;
  terminalId: string | null;
  createdAt: string | null; // ISO, or raw PhonePe value if unparseable
}

function defaultRange(from?: string, to?: string) {
  const now = Date.now();
  const startMs = from
    ? new Date(from + "T00:00:00.000Z").getTime()
    : now - 90 * 24 * 60 * 60 * 1000; // default 90d
  const endMs = to ? new Date(to + "T23:59:59.999Z").getTime() : now;
  return { startMs, endMs };
}

function isoDate(ms: number) {
  return new Date(ms).toISOString().split("T")[0];
}

function channelOf(transactionId: string): PhonePeChannel {
  return transactionId.toUpperCase().startsWith("DQR") ? "DQR" : "STATIC";
}

function statusOf(paymentState: string | null): PhonePeStatus {
  const s = (paymentState ?? "").toUpperCase();
  if (s === "COMPLETED" || s === "SUCCESS") return "COMPLETED";
  if (s === "FAILED" || s === "EXPIRED" || s === "DECLINED" || s === "CANCELLED")
    return "FAILED";
  return "PENDING";
}

/** Parse PhonePe's transactionDate (epoch ms or a date string) → {iso, ms}. */
function parseTxnDate(value: string | null): { iso: string | null; ms: number } {
  if (!value) return { iso: null, ms: 0 };
  const trimmed = value.trim();
  const d = /^\d+$/.test(trimmed) ? new Date(Number(trimmed)) : new Date(trimmed);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return { iso: value, ms: 0 };
  return { iso: d.toISOString(), ms };
}

function mapTxn(t: QrListTransaction): PhonePeTxn & { _ms: number } {
  const { iso, ms } = parseTxnDate(t.transactionDate);
  const utr = t.paymentModes.find((m) => m.utr)?.utr ?? null;
  return {
    id: t.transactionId,
    channel: channelOf(t.transactionId),
    merchantTxnId: t.transactionId || null,
    providerReferenceId: t.providerReferenceId,
    amount: (t.amount ?? 0) / 100, // paise → rupees
    status: statusOf(t.paymentState),
    customerName: t.name,
    customerPhone: t.mobileNumber,
    utr,
    terminalId: t.transactionContext?.terminalId ?? null,
    createdAt: iso,
    _ms: ms,
  };
}

export interface PhonePeStore {
  key: string;
  label: string;
}

/** The configured stores, in tab order (Online, Offline, Gym, Yoga, Cafe). */
export async function getPhonePeStores(
  skipAuth = false,
): Promise<{ configured: boolean; stores: PhonePeStore[]; defaultStore: string | null }> {
  if (!skipAuth) await requireGatewayAccess();
  const stores = getDqrStores().map((s) => ({ key: s.key, label: s.label }));
  return {
    configured: isQrReportingConfigured(),
    stores,
    defaultStore: stores[0]?.key ?? null,
  };
}

/**
 * Fetch + map PhonePe's QR transactions for one store + date window. Returns
 * rows sorted newest-first plus a `truncated` flag (the API hit the size cap,
 * so older rows in the window may be missing).
 */
async function fetchWindow(
  store: string,
  from?: string,
  to?: string,
): Promise<{
  rows: Array<PhonePeTxn & { _ms: number }>;
  truncated: boolean;
  configured: boolean;
  error: string | null;
  range: { from: string; to: string };
}> {
  const { startMs, endMs } = defaultRange(from, to);
  const range = { from: isoDate(startMs), to: isoDate(endMs) };

  const storeId = getDqrStoreId(store);
  if (!isQrReportingConfigured() || !storeId) {
    return { rows: [], truncated: false, configured: false, error: null, range };
  }

  // The PhonePe call can fail (bad creds, store not enabled for the list API,
  // response-shape mismatch). NEVER let that throw out of here — it would crash
  // the admin page's server render. Surface it as an inline error instead.
  try {
    const res = await qrTransactionList({
      storeId,
      size: MAX_LIST_SIZE,
      startTimestamp: startMs,
    });

    const rows = res.transactions
      .map(mapTxn)
      // API filters by start only; enforce the end of the window ourselves.
      .filter((r) => r._ms === 0 || r._ms <= endMs)
      .sort((a, b) => b._ms - a._ms);

    return {
      rows,
      truncated: res.resultCount >= MAX_LIST_SIZE,
      configured: true,
      error: null,
      range,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "PhonePe request failed";
    console.error(`[admin-phonepe] store=${store} fetch failed:`, message);
    return { rows: [], truncated: false, configured: true, error: message, range };
  }
}

export interface PhonePeOverview {
  configured: boolean; // false → creds not set; UI shows a setup notice
  error: string | null; // non-null → the live PhonePe call failed; show inline
  truncated: boolean; // hit the API size cap → older rows may be missing
  totalCount: number;
  completedCount: number;
  pendingCount: number;
  failedCount: number;
  totalVolume: number; // sum of COMPLETED amounts, rupees
  byChannel: { STATIC: number; DQR: number }; // completed volume per channel
  range: { from: string; to: string };
}

export async function getPhonePeOverview(params: {
  store: string;
  from?: string;
  to?: string;
  skipAuth?: boolean;
}): Promise<PhonePeOverview> {
  if (!params.skipAuth) await requireGatewayAccess();
  const { rows, truncated, configured, error, range } = await fetchWindow(
    params.store,
    params.from,
    params.to,
  );

  const ov: PhonePeOverview = {
    configured,
    error,
    truncated,
    totalCount: rows.length,
    completedCount: 0,
    pendingCount: 0,
    failedCount: 0,
    totalVolume: 0,
    byChannel: { STATIC: 0, DQR: 0 },
    range,
  };

  for (const r of rows) {
    if (r.status === "COMPLETED") {
      ov.completedCount++;
      ov.totalVolume += r.amount;
      ov.byChannel[r.channel] += r.amount;
    } else if (r.status === "FAILED") {
      ov.failedCount++;
    } else {
      ov.pendingCount++;
    }
  }
  return ov;
}

export interface PhonePeTxnPage {
  configured: boolean;
  error: string | null;
  truncated: boolean;
  items: PhonePeTxn[];
  total: number;
  page: number;
  totalPages: number;
}

export async function getPhonePeTransactions(params: {
  store: string;
  from?: string;
  to?: string;
  status?: PhonePeStatus; // optional filter
  channel?: PhonePeChannel; // STATIC | DQR, optional filter
  page?: number;
  skipAuth?: boolean;
}): Promise<PhonePeTxnPage> {
  if (!params.skipAuth) await requireGatewayAccess();
  const { rows, truncated, configured, error } = await fetchWindow(
    params.store,
    params.from,
    params.to,
  );
  const page = Math.max(params.page ?? 1, 1);

  const filtered = rows.filter(
    (r) =>
      (!params.status || r.status === params.status) &&
      (!params.channel || r.channel === params.channel),
  );

  const total = filtered.length;
  const start = (page - 1) * PAGE_SIZE;
  const items = filtered
    .slice(start, start + PAGE_SIZE)
    // strip the internal sort key
    .map(({ _ms, ...txn }) => txn);

  return {
    configured,
    error,
    truncated,
    items,
    total,
    page,
    totalPages: Math.max(Math.ceil(total / PAGE_SIZE), 1),
  };
}
