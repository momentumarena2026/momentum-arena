import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { getExpenseAnalytics } from "@/actions/admin-expenses";

/**
 * GET /api/mobile/admin/expenses/analytics?from=&to=
 *
 * Aggregations the analytics screen renders: total amount + count,
 * monthly series, breakdowns by spentType / doneBy / paymentType /
 * vendor / toName. Same shape `getExpenseAnalytics` returns.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;
  const data = await getExpenseAnalytics(
    {
      from: sp.get("from") || undefined,
      to: sp.get("to") || undefined,
    },
    true,
  );
  return NextResponse.json(data);
}
