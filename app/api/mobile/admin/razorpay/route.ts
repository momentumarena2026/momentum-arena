import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { getRazorpayOverview } from "@/actions/admin-razorpay";

/**
 * Mobile admin Razorpay dashboard (read-only KPI overview). Reuses
 * getRazorpayOverview with skipAuth=true after validating the bearer token +
 * VIEW_RAZORPAY. All monetary fields are in PAISE.
 *
 * Drill-down lists (payments / orders / refunds / settlements / disputes) live
 * at /api/mobile/admin/razorpay/transactions.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "VIEW_RAZORPAY");
  if ("error" in gate) return gate.error;

  const overview = await getRazorpayOverview(true);
  return NextResponse.json({ overview });
}
