import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
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
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const grouped = await listActiveExpenseOptionsByField(true);
  return NextResponse.json({ options: grouped });
}
