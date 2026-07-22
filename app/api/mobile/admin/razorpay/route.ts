import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { getRazorpayOverview } from "@/actions/admin-razorpay";

/**
 * Mobile admin Razorpay dashboard (read-only KPI overview). Validates the
 * bearer token + VIEW_RAZORPAY here so failures answer 401/403 JSON, then
 * calls getRazorpayOverview, which re-checks VIEW_RAZORPAY off the same
 * bearer token. All monetary fields are in PAISE.
 *
 * Drill-down lists (payments / orders / refunds / settlements / disputes) live
 * at /api/mobile/admin/razorpay/transactions.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "VIEW_RAZORPAY");
  if ("error" in gate) return gate.error;

  const overview = await getRazorpayOverview();
  return NextResponse.json({ overview });
}
