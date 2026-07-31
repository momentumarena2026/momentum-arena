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
  list: () =>
    api.get<{ notifications: UserNotification[]; unread: number }>(
      "/api/mobile/notifications",
    ),
  markAllRead: () =>
    api.post<{ ok: true }>("/api/mobile/notifications", {}),
};
