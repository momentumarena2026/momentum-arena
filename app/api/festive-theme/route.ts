import { NextResponse } from "next/server";
import { getFestiveTheme } from "@/actions/admin-arena-settings";

/**
 * Public read of the festive theme for the mobile app — the same
 * `getFestiveTheme()` the website renders from, so both surfaces turn
 * festive and plain together. No auth; it is a decoration.
 *
 * Only the theme ID crosses the wire. The palette and the motif live in
 * each platform's own bundle (`lib/festive-themes.ts` on web, its mirror
 * in the app), because sending colours would make the server a second
 * source of truth that could disagree with the installed build.
 *
 * ISR-cached 5 min, like /api/info-bar. `setFestiveTheme` purges this
 * path on save, which is the half that gets forgotten — see gotcha 26.
 */
export const revalidate = 300;

export async function GET() {
  try {
    return NextResponse.json(await getFestiveTheme());
  } catch {
    // A decoration must never take an endpoint down.
    return NextResponse.json({ theme: null, greeting: null });
  }
}
