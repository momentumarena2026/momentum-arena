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
  const [items, unread] = await Promise.all([
    listNotifications(user.id),
    unreadNotificationCount(user.id),
  ]);
  return NextResponse.json({ notifications: items, unread });
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
