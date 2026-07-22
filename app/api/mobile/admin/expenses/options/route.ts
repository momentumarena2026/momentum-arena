import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { listActiveExpenseOptionsByField } from "@/actions/admin-expenses";

/**
 * GET /api/mobile/admin/expenses/options
 *
 * Returns the active dropdown labels grouped by field
 * (PAYMENT_TYPE / DONE_BY / VENDOR / SPENT_TYPE / TO_NAME), so the
 * mobile create/edit form can render the same chip-pickers the web
 * admin uses without sending a giant Expense table down the wire.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_EXPENSES");
  if ("error" in gate) return gate.error;

  const sp = new URL(request.url).searchParams;
  const grouped = await listActiveExpenseOptionsByField(
    sp.get("module") === "RUNNING" ? "RUNNING" : "GENERAL",
  );
  return NextResponse.json({ options: grouped });
}
