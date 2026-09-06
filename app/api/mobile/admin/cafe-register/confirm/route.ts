import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { confirmRegisterOrders } from "@/actions/admin-cafe-register";

export const dynamic = "force-dynamic";

/**
 * Create the orders the admin approved on the phone.
 *
 * Delegates to the same server action the web review screen calls, so
 * the two surfaces cannot drift on what "approving a row" means — the
 * order creation, the alias learning and the upload bookkeeping all live
 * in one place.
 */
export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_CAFE_ORDERS");
  if ("error" in gate) return gate.error;

  let body: { uploadId?: string | null; rows?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: "Nothing to create" }, { status: 400 });
  }

  const res = await confirmRegisterOrders({
    uploadId: body.uploadId ?? null,
    rows: body.rows as never,
  });
  return NextResponse.json(res);
}
