import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileAdmin } from "@/lib/mobile-auth";
import { markCheckedIn } from "@/actions/checkin";

/**
 * POST /api/mobile/admin/checkin/check-in
 * body: { qrToken: string }
 *
 * Stamps `checkedInAt` on a confirmed booking. The action handles the
 * "already checked in" / "not confirmed" / "not found" edge cases and
 * returns a friendly error message — we surface those verbatim with a
 * 400 so the RN screen can show them in a banner without translating.
 *
 * `preAuthorized: true` skips the NextAuth web cookie gate inside
 * `markCheckedIn` because we've already verified the JWT bearer above.
 */
const Body = z.object({ qrToken: z.string().min(1) });

export async function POST(request: NextRequest) {
  const admin = await getMobileAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "qrToken required" }, { status: 400 });
  }

  const result = await markCheckedIn(parsed.data.qrToken, true);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
