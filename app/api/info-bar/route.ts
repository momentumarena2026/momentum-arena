import { NextResponse } from "next/server";
import { getInfoBar } from "@/actions/admin-arena-settings";

/**
 * Public read of the home-page Information Bar for the mobile app —
 * the same `getInfoBar()` the web home renders, so both surfaces show
 * identical copy. No auth — it's public announcement text.
 *
 * ISR-cached 5 min: admin edits land promptly while the DB read stays
 * cheap under app traffic.
 */
export const revalidate = 300;

export async function GET() {
  try {
    return NextResponse.json(await getInfoBar());
  } catch {
    // The bar must never take an endpoint down — hide it on any error.
    return NextResponse.json({ show: false, text: "" });
  }
}
