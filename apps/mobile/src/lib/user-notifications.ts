import { api } from "./api";

/**
 * In-app notifications — bell badge + the My Notifications screen.
 * Rows are written server-side (lib/user-notifications.ts) whenever
 * something user-specific happens: added to a pass, a pass-paid
 * booking, your booking confirmed, a pass purchase.
 */
export interface UserNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export const notificationsApi = {
  /** One page, newest first. Omit `cursor` for the first page. */
  list: (cursor?: string | null, limit = 20) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set("cursor", cursor);
    return api.get<{
      notifications: UserNotification[];
      unread: number;
      /** Keyset cursor for the next page; null on the last one. */
      nextCursor?: string | null;
    }>(`/api/mobile/notifications?${q.toString()}`);
  },
  markAllRead: () =>
    api.post<{ ok: true }>("/api/mobile/notifications", {}),
};
