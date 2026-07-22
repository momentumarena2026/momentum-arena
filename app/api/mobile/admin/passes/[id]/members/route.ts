import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  adminGetPassMembers,
  adminAddPassMember,
  adminRemovePassMember,
} from "@/actions/admin-passes";

/** Mobile admin — pass members roster (mirror of the web Members
 *  modal). GET lists members + cap; POST { phone } adds, POST
 *  { remove: userId } removes. Business failures ride a 200 with
 *  { ok:false, error } like the customer members route. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_PASSES");
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const data = await adminGetPassMembers(id);
  if (!data) {
    return NextResponse.json({ error: "Pass not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileAdmin(request, "MANAGE_PASSES");
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    phone?: string;
    remove?: string;
  };

  if (body.remove) {
    const result = await adminRemovePassMember(id, body.remove);
    return NextResponse.json(result);
  }
  if (!body.phone) {
    return NextResponse.json({ ok: false, error: "Phone number required" });
  }
  const result = await adminAddPassMember(id, body.phone);
  return NextResponse.json(result);
}
