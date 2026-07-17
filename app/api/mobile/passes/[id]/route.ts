import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import { getPassDetailForUser } from "@/lib/passes";

/** Full pass detail (owner or shared member) — same shape as the web
 *  /passes/[id] page, via lib/passes.getPassDetailForUser. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const pass = await getPassDetailForUser(id, user.id);
  if (!pass) {
    return NextResponse.json({ error: "Pass not found" }, { status: 404 });
  }
  return NextResponse.json({ pass });
}
