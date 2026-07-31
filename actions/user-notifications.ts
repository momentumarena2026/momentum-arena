"use server";

import { auth } from "@/lib/auth";
import {
  listNotifications,
  markAllNotificationsRead,
  unreadNotificationCount,
} from "@/lib/user-notifications";

/** The signed-in customer's notifications, newest first. */
export async function myNotifications() {
  const session = await auth();
  if (!session?.user?.id) return [];
  return listNotifications(session.user.id);
}

export async function myUnreadNotificationCount(): Promise<number> {
  const session = await auth();
  if (!session?.user?.id) return 0;
  return unreadNotificationCount(session.user.id);
}

export async function markMyNotificationsRead(): Promise<{ ok: true }> {
  const session = await auth();
  if (session?.user?.id) await markAllNotificationsRead(session.user.id);
  return { ok: true };
}
