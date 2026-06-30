import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  getPhonePeOverview,
  getPhonePeTransactions,
  refreshPhonePeStatus,
  type PhonePeTxnType,
} from "@/actions/admin-phonepe";

/**
 * Mobile admin PhonePe transactions dashboard (DB-backed).
 *
 * PhonePe's PG product has NO merchant-wide list / settlement / dispute API —
 * only a per-order status call. So this dashboard reads our own PhonePe Payment
 * / CafePayment rows (getPhonePeOverview + getPhonePeTransactions), and the one
 * live action is a per-transaction status refresh (refreshPhonePeStatus). All
 * monetary fields are already in RUPEES (no paise conversion).
 *
 * Mobile bearer callers can't satisfy the web actions' cookie-session
 * requireAdmin gate, so this route authorizes with requireMobileAdmin(
 * VIEW_RAZORPAY) — the SAME permission the Razorpay dashboard uses — then calls
 * the actions with skipAuth=true. SUPERADMIN bypasses, 401/403 mirror the
 * razorpay mobile route.
 *
 * GET  ?from&to&status&type&page  → { overview, transactions }
 * GET  ?refresh=<merchantTxnId>   → { status }   (live PhonePe state)
 * POST { merchantTxnId }          → { status }   (live PhonePe state)
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "VIEW_RAZORPAY");
  if ("error" in gate) return gate.error;

  const { searchParams } = new URL(request.url);

  // Live per-transaction status refresh shortcut.
  const refresh = searchParams.get("refresh");
  if (refresh) {
    const status = await refreshPhonePeStatus(refresh, true);
    return NextResponse.json({ status });
  }

  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const status = searchParams.get("status") || undefined;
  const typeParam = searchParams.get("type");
  const type =
    typeParam === "booking" || typeParam === "cafe"
      ? (typeParam as PhonePeTxnType)
      : undefined;
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const [overview, transactions] = await Promise.all([
    getPhonePeOverview(from, to, true),
    getPhonePeTransactions({ from, to, status, type, page, skipAuth: true }),
  ]);

  return NextResponse.json({ overview, transactions });
}

export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "VIEW_RAZORPAY");
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => null)) as {
    merchantTxnId?: string;
  } | null;
  const merchantTxnId = body?.merchantTxnId;
  if (!merchantTxnId) {
    return NextResponse.json(
      { error: "merchantTxnId is required" },
      { status: 400 },
    );
  }

  const status = await refreshPhonePeStatus(merchantTxnId, true);
  return NextResponse.json({ status });
}
