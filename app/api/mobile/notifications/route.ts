import { NextRequest, NextResponse } from "next/server";
import { getMobileUser } from "@/lib/mobile-auth";
import {
  listNotifications,
  markAllNotificationsRead,
  unreadNotificationCount,
} from "@/lib/user-notifications";

// GET /api/mobile/notifications — the signed-in customer's in-app
// notifications (newest first) + unread count for the bell badge.
export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Math.max(Number.parseInt(searchParams.get("limit") ?? "20", 10) || 20, 1),
    50,
  );
  const cursor = searchParams.get("cursor");

  // limit + 1 so "is there another page" needs no second COUNT.
  const [rows, unread] = await Promise.all([
    listNotifications(user.id, limit + 1, cursor),
    unreadNotificationCount(user.id),
  ]);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return NextResponse.json({
    notifications: items,
    unread,
    // Keyset cursor: the timestamp of the last row on this page. Null on
    // the final page. Older installs ignore it and keep working.
    nextCursor: hasMore
      ? (items[items.length - 1]?.createdAt.toISOString() ?? null)
      : null,
  });
}

// POST — mark everything read (called when the screen opens).
export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await markAllNotificationsRead(user.id);
  return NextResponse.json({ ok: true });
}
