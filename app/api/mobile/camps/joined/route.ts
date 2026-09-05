import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth-unified";

export const dynamic = "force-dynamic";

/**
 * Which camps this customer has already joined.
 *
 * Separate from the camps list because that list is cached for everyone
 * — a per-customer field on a shared payload is how one person's history
 * ends up shown to another. This is small, uncached, and only asked for
 * once the app knows who is looking.
 *
 * Used to decide whether to show the one-time joining fee. The SERVER is
 * still the authority on what is actually charged; this only stops the
 * app quoting a returning participant a fee they will not pay.
 */
export async function GET(request: NextRequest) {
  const userId = await getAuthUserId(request).catch(() => null);
  // Signed out is not an error here. Nobody has a history yet, so every
  // camp shows its joining fee — which is the correct quote for someone
  // the venue cannot recognise.
  if (!userId) return NextResponse.json({ campIds: [] });

  const rows = await db.campRegistration
    .findMany({
      where: { userId, status: "CONFIRMED", archivedAt: null },
      select: { campId: true },
      distinct: ["campId"],
    })
    .catch(() => []);

  return NextResponse.json({ campIds: rows.map((r) => r.campId) });
}
