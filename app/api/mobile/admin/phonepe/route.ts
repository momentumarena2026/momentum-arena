import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  getPhonePeOverview,
  getPhonePeTransactions,
  type PhonePeChannel,
  type PhonePeStatus,
} from "@/actions/admin-phonepe";

/**
 * Mobile admin PhonePe transactions dashboard (LIVE from PhonePe).
 *
 * Sourced straight from PhonePe's QR transaction-list API (static + Dynamic
 * QR), not our DB — so it reflects PhonePe's truth including payments whose S2S
 * callback we may have missed. Standard-Checkout payments are out of scope.
 * All monetary fields are already in RUPEES (no paise conversion).
 *
 * Mobile bearer callers can't satisfy the web actions' cookie-session
 * requireAdmin gate, so this route authorizes with requireMobileAdmin(
 * VIEW_RAZORPAY) — the SAME permission the Razorpay dashboard uses — then calls
 * the actions with skipAuth=true. SUPERADMIN bypasses, 401/403 mirror the
 * razorpay mobile route.
 *
 * GET  ?from&to&status&channel&page  → { overview, transactions }
 */
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

  const [overview, transactions] = await Promise.all([
    getPhonePeOverview(from, to, true),
    getPhonePeTransactions({ from, to, status, channel, page, skipAuth: true }),
  ]);

  return NextResponse.json({ overview, transactions });
}
