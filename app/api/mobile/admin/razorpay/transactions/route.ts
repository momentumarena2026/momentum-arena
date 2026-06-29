import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  fetchPayments,
  fetchOrders,
  fetchRefunds,
  fetchSettlements,
  fetchDisputes,
} from "@/lib/razorpay-api";

/**
 * GET /api/mobile/admin/razorpay/transactions?type=payments&page=1&from=&to=
 *
 * Drill-down list for the mobile Razorpay dashboard, mirroring the web
 * razorpay-dashboard tabs (Payments / Orders / Refunds / Settlements +
 * Disputes). Paginated read-only, PAGE_SIZE 20 — same shape the web server
 * actions (getRazorpayPayments etc.) return: { items, count, page, totalPages }.
 *
 * The web actions guard via a cookie-session requireRazorpayAccess() that
 * mobile bearer callers can't satisfy, so this route authorizes with
 * requireMobileAdmin(VIEW_RAZORPAY) — the SAME permission — then calls the
 * lower-level lib/razorpay-api fetchers directly. All amounts are in PAISE.
 */
const PAGE_SIZE = 20;

const TYPES = ["payments", "orders", "refunds", "settlements", "disputes"] as const;
type TxnType = (typeof TYPES)[number];

export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "VIEW_RAZORPAY");
  if ("error" in gate) return gate.error;

  const { searchParams } = new URL(request.url);
  const type = (searchParams.get("type") || "payments") as TxnType;
  if (!TYPES.includes(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const skip = (page - 1) * PAGE_SIZE;
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;

  try {
    let result: { items: unknown[]; count: number };
    switch (type) {
      case "payments":
        result = await fetchPayments({ count: PAGE_SIZE, skip, from, to });
        break;
      case "orders":
        result = await fetchOrders({ count: PAGE_SIZE, skip, from, to });
        break;
      case "refunds":
        result = await fetchRefunds({ count: PAGE_SIZE, skip, from, to });
        break;
      case "settlements":
        result = await fetchSettlements({ count: PAGE_SIZE, skip, from, to });
        break;
      case "disputes":
        result = await fetchDisputes({ count: PAGE_SIZE, skip });
        break;
    }

    return NextResponse.json({
      items: result.items,
      count: result.count,
      page,
      totalPages: Math.max(1, Math.ceil(result.count / PAGE_SIZE)),
    });
  } catch (err) {
    return NextResponse.json(
      {
        items: [],
        count: 0,
        page,
        totalPages: 1,
        error: err instanceof Error ? err.message : `Failed to fetch ${type}`,
      },
      { status: 200 },
    );
  }
}
