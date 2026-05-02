import { NextRequest, NextResponse } from "next/server";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { searchCustomers } from "@/actions/admin-booking";

/**
 * GET /api/mobile/admin/customers/search?q=...
 *
 * Free-text customer lookup over name / email / phone. Used by the
 * mobile admin create-booking form to attach an existing customer
 * to a new booking before falling back to the create-customer path.
 */
export async function GET(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    // Same minimum the web form enforces — saves a round trip when the
    // admin has only typed one letter.
    return NextResponse.json({ customers: [] });
  }

  const result = await searchCustomers(q, true);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ customers: result.customers });
}
