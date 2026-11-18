import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { getExpenseContributions } from "@/actions/admin-expenses";

/**
 * GET /api/mobile/admin/expenses/contributions?module=&from=&to=&search=
 *
 * Who fronted the money and what the venture owes them, per person and
 * per month. Same action the web Running Expenses page calls, so the
 * two surfaces cannot disagree about a figure somebody is about to
 * transfer.
 *
 * Takes the same filters as the list so the panel describes exactly the
 * rows the list is showing.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_EXPENSES");
  if ("error" in gate) return gate.error;

  const sp = new URL(request.url).searchParams;
  const data = await getExpenseContributions({
    module: sp.get("module") === "RUNNING" ? "RUNNING" : "GENERAL",
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    spentType: sp.get("spentType") || undefined,
    doneBy: sp.get("doneBy") || undefined,
    paymentType: sp.get("paymentType") || undefined,
    vendor: sp.get("vendor") || undefined,
    search: sp.get("search") || undefined,
  });
  return NextResponse.json(data);
}
