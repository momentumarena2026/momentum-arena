import { NextResponse } from "next/server";
import { getQuickBookSettings } from "@/lib/booking-bot/settings";

export const dynamic = "force-dynamic";

/**
 * Public. The home screen needs to know whether to show the Quick book
 * entry and which badges to put on it, and that question is not about
 * who is asking — a signed-out customer sees the same home screen.
 *
 * Deliberately its own endpoint rather than a field on a bigger config
 * payload: the app already fetches module switches this way (camps,
 * tournaments), and matching that shape means the home screen holds its
 * layout while this loads instead of shoving the page down when it
 * arrives.
 */
export async function GET() {
  const s = await getQuickBookSettings();
  return NextResponse.json(s);
}
