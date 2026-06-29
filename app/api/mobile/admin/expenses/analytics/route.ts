import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { getExpenseAnalytics } from "@/actions/admin-expenses";

/**
 * GET /api/mobile/admin/expenses/analytics?from=&to=
 *
 * Aggregations the analytics screen renders: total amount + count,
 * monthly series, breakdowns by spentType / doneBy / paymentType /
 * vendor / toName. Same shape `getExpenseAnalytics` returns.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_EXPENSES");
  if ("error" in gate) return gate.error;

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
