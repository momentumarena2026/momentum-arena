import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser } from "@/lib/mobile-auth";

/**
 * Browse-only cafe menu for the mobile app. Returns all items (available and
 * otherwise) so the mobile UI can render a full menu — the client filters for
 * display. Matches the Prisma `CafeItem` shape.
 */
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const items = await db.cafeItem.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(items);
}
