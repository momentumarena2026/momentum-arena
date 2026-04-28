import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { listExpenses, createExpense } from "@/actions/admin-expenses";

/**
 * GET /api/mobile/admin/expenses?from=&to=&search=&page=&pageSize=
 *   Paginated list with the same filter set the web /admin/expenses
 *   page exposes — date range, free-text, page/pageSize. Returns the
 *   total amount alongside the rows so the UI can show "showing X of
 *   Y · ₹Z total" without a second aggregate request.
 *
 * POST /api/mobile/admin/expenses
 *   body: ExpenseInput (date, description, amount, paymentType,
 *   doneBy, toName, vendor, spentType, note?)
 *   Creates a new expense row + an audit-log entry.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;
  const filters = {
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    spentType: sp.get("spentType") || undefined,
    doneBy: sp.get("doneBy") || undefined,
    paymentType: sp.get("paymentType") || undefined,
    vendor: sp.get("vendor") || undefined,
    search: sp.get("search") || undefined,
    page: sp.get("page") ? Number(sp.get("page")) : undefined,
    pageSize: sp.get("pageSize") ? Number(sp.get("pageSize")) : undefined,
  };

  const result = await listExpenses(filters, true);
  return NextResponse.json({
    rows: result.rows.map((r) => ({
      ...r,
      date: r.date.toISOString(),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
    totalAmount: result.totalAmount,
  });
}

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(500),
  amount: z.number().int().positive(),
  paymentType: z.string().min(1).max(100),
  doneBy: z.string().min(1).max(100),
  toName: z.string().min(1).max(200),
  vendor: z.string().min(1).max(100),
  spentType: z.string().min(1).max(100),
  note: z.string().max(1000).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid data" },
      { status: 400 },
    );
  }

  const result = await createExpense(parsed.data, {
    id: admin.id,
    name: admin.username,
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: result.id });
}
