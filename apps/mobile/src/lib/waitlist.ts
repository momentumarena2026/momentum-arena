import { api } from "./api";

export interface WaitlistEntry {
  id: string;
  courtConfigId: string;
  date: string; // ISO datetime
  startHour: number;
  endHour: number;
  status: "WAITING" | "NOTIFIED" | "BOOKED" | "EXPIRED" | "CANCELLED";
  notifiedAt: string | null;
  expiresAt: string;
  createdAt: string;
  courtConfig: {
    id: string;
    sport: string;
    size: string;
    label: string;
  };
}

export const waitlistApi = {
  /**
   * Join the waitlist for a specific (court, date, hour-range). Server
   * dedupes silently — calling twice with the same params returns the
   * existing entry's error rather than creating a duplicate.
   */
  join: (input: {
    courtConfigId: string;
    date: string; // YYYY-MM-DD
    startHour: number;
    endHour: number;
  }) =>
    api.post<{ success: boolean; waitlistId?: string; error?: string }>(
      "/api/mobile/waitlist/join",
      input,
    ),

  /** Withdraw a waitlist entry the user owns. */
  cancel: (waitlistId: string) =>
    api.post<{ success: boolean; error?: string }>(
      "/api/mobile/waitlist/cancel",
      { waitlistId },
    ),

  /** All of the signed-in user's WAITING + NOTIFIED entries that haven't expired yet. */
  mine: () =>
    api.get<{ success: boolean; entries: WaitlistEntry[]; error?: string }>(
      "/api/mobile/waitlist/mine",
    ),
};
