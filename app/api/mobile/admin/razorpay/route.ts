import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { getRazorpayOverview } from "@/actions/admin-razorpay";

/**
 * Mobile admin Razorpay dashboard (read-only KPI overview). Reuses
 * getRazorpayOverview with skipAuth=true after validating the bearer token.
 * All monetary fields are in PAISE. Permission: VIEW_RAZORPAY.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "VIEW_RAZORPAY")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const overview = await getRazorpayOverview(true);
  return NextResponse.json({ overview });
}
