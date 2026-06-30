import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  getPhonePeStores,
  getPhonePeOverview,
  getPhonePeTransactions,
  type PhonePeChannel,
  type PhonePeStatus,
  type PhonePeOverview,
  type PhonePeTxnPage,
} from "@/actions/admin-phonepe";

/**
 * Mobile admin PhonePe transactions dashboard (LIVE from PhonePe).
 *
 * Sourced straight from PhonePe's QR transaction-list API (static + Dynamic
 * QR), not our DB — so it reflects PhonePe's truth including payments whose S2S
 * callback we may have missed. Standard-Checkout payments are out of scope.
 * All monetary fields are already in RUPEES (no paise conversion).
 *
 * One PhonePe merchant has FIVE stores; the list API is keyed per store. The
 * caller passes ?store=ONLINE to choose one; if omitted we use the default
 * (first) store. Stores come back already ordered Online, Offline, Gym, Yoga,
 * Cafe so the mobile client can render them as tabs.
 *
 * Mobile bearer callers can't satisfy the web actions' cookie-session
 * requireAdmin gate, so this route authorizes with requireMobileAdmin(
 * VIEW_RAZORPAY) — the SAME permission the Razorpay dashboard uses — then calls
 * the actions with skipAuth=true. SUPERADMIN bypasses, 401/403 mirror the
 * razorpay mobile route.
 *
 * GET  ?store&from&to&status&channel&page
 *   → { stores, defaultStore, configured, overview, transactions }
 */
function notConfiguredOverview(): PhonePeOverview {
  return {
    configured: false,
    error: null,
    truncated: false,
    totalCount: 0,
    completedCount: 0,
    pendingCount: 0,
    failedCount: 0,
    totalVolume: 0,
    byChannel: { STATIC: 0, DQR: 0 },
    range: { from: "", to: "" },
  };
}

function notConfiguredTransactions(): PhonePeTxnPage {
  return {
    configured: false,
    error: null,
    truncated: false,
    items: [],
    total: 0,
    page: 1,
    totalPages: 1,
  };
}

export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "VIEW_RAZORPAY");
  if ("error" in gate) return gate.error;

  const { searchParams } = new URL(request.url);

  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const status = (searchParams.get("status") || undefined) as
    | PhonePeStatus
    | undefined;
  const channel = (searchParams.get("channel") || undefined) as
    | PhonePeChannel
    | undefined;
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  // Resolve the store: explicit ?store wins, else the default (first) store.
  const { stores, defaultStore } = await getPhonePeStores(true);
  const store = searchParams.get("store") || defaultStore;

  // Nothing configured → empty/not-configured payload, no PhonePe calls.
  if (!store) {
    return NextResponse.json({
      stores,
      defaultStore,
      configured: false,
      overview: notConfiguredOverview(),
      transactions: notConfiguredTransactions(),
    });
  }

  const [overview, transactions] = await Promise.all([
    getPhonePeOverview({ store, from, to, skipAuth: true }),
    getPhonePeTransactions({
      store,
      from,
      to,
      status,
      channel,
      page,
      skipAuth: true,
    }),
  ]);

  return NextResponse.json({
    stores,
    defaultStore,
    configured: overview.configured,
    overview,
    transactions,
  });
}
