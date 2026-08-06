import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { getCafeOrderDue, settleCafeOrderDue } from "@/actions/admin-cafe-due";

/**
 * Outstanding balance on a part-paid cafe order, and collecting it.
 *
 *   GET  ?orderId=…  → the ledger (total, collected, due, instalments)
 *   POST { orderId, cashAmount, upiAmount, receivedAt?, note? } → record one
 *
 * Both delegate to the same actions the web admin uses, so the arithmetic,
 * the overpayment guard and the flip-to-COMPLETED rule live in exactly one
 * place. Those actions re-check MANAGE_CAFE_ORDERS from this request's own
 * bearer token; the check here exists so an unauthorized call gets a clean
 * 401/403 rather than a thrown 500.
 */

function guard(admin: Awaited<ReturnType<typeof getMobileAdmin>>) {
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Same shape as the sibling create route: superadmins bypass, everyone
  // else needs the explicit permission.
  if (
    admin.role !== "SUPERADMIN" &&
    !hasPermission(admin.permissions ?? [], "MANAGE_CAFE_ORDERS")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  const denied = guard(admin);
  if (denied) return denied;

  const orderId = request.nextUrl.searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }
  const due = await getCafeOrderDue(orderId);
  if (!due) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json(due);
}

export async function POST(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  const denied = guard(admin);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  if (!body?.orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }
  const res = await settleCafeOrderDue({
    orderId: String(body.orderId),
    cashAmount: Number(body.cashAmount) || 0,
    upiAmount: Number(body.upiAmount) || 0,
    receivedAt: body.receivedAt ? String(body.receivedAt) : undefined,
    note: body.note ? String(body.note) : undefined,
  });
  if (!res.success) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json(res);
}
