import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import {
  addPassMemberForOwner,
  removePassMemberForOwner,
} from "@/lib/passes";

/** Owner adds a member by phone: { phone }. Mirrors the web
 *  addPassMemberByPhone action — notRegistered + phone in the error
 *  payload drives the WhatsApp-invite prompt. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    phone?: string;
    remove?: string;
  };

  // { remove: userId } — owner removes a member (mobile api client only
  // speaks GET/POST, so removal rides the same route).
  // Business failures ride a 200 with { ok:false, error } — same
  // contract as the web server actions, so the screen reads one shape.
  if (body.remove) {
    const result = await removePassMemberForOwner(id, user.id, body.remove);
    return NextResponse.json(result);
  }

  if (!body.phone) {
    return NextResponse.json({ ok: false, error: "Phone number required" });
  }
  const result = await addPassMemberForOwner(id, user.id, body.phone);
  return NextResponse.json(result);
}
