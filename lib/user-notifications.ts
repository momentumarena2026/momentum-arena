import { db } from "./db";
import { sendToUser } from "./push";

/**
 * In-app notifications — the rows behind the bell icon and the
 * "My Notifications" screens on web and app. Every notifyUser() call
 * writes a UserNotification row AND fires a matching FCM push
 * best-effort (push failure never blocks the caller; the row is the
 * source of truth and renders regardless).
 *
 * Current types (plain strings so new ones need no migration):
 *   PASS_MEMBER_ADDED — you were added to someone's pass
 *   PASS_BOOKING      — a booking was paid from a pass you're on
 *   PASS_PURCHASED    — your pass purchase was confirmed
 *   BOOKING_CONFIRMED — your own booking got confirmed
 */
export async function notifyUser(
  userId: string,
  input: {
    type: string;
    title: string;
    body: string;
    /** In-app destination, e.g. "/account/passes/<id>". */
    link?: string | null;
    /** Skip the FCM push (row only). Default: push. */
    silent?: boolean;
  },
): Promise<void> {
  try {
    await db.userNotification.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
      },
    });
  } catch (err) {
    console.error("[notify] failed to write notification row:", err);
    return; // no row → don't push either
  }

  if (!input.silent) {
    sendToUser(userId, {
      title: input.title,
      body: input.body,
      data: { kind: "in_app", ...(input.link ? { link: input.link } : {}) },
    }).catch((err) => console.error("[notify] push failed:", err));
  }
}

/**
 * One page of a customer's notifications, newest first.
 *
 * `limit` used to be a silent ceiling: the endpoint took 50 and there was
 * no way to ask for more, so anyone past 50 simply lost their older
 * notifications with nothing saying so. Production's heaviest user is at
 * 26 today, which is exactly why this is worth fixing now rather than
 * after someone notices history disappearing.
 *
 * Keyset paging on createdAt, not offset: rows arrive at the top while a
 * customer is scrolling, and an offset would make that shift duplicate or
 * skip a row.
 */
export async function listNotifications(
  userId: string,
  limit = 20,
  cursor?: string | null,
) {
  return db.userNotification.findMany({
    where: {
      userId,
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      link: true,
      readAt: true,
      createdAt: true,
    },
  });
}

export async function unreadNotificationCount(userId: string) {
  return db.userNotification.count({ where: { userId, readAt: null } });
}

export async function markAllNotificationsRead(userId: string) {
  await db.userNotification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
