import { api } from "./api";

export interface RewardConfigSnapshot {
  pointValuePaise: number;
  minPointsToRedeem: number;
  maxRedemptionPctOfBill: number;
  maxRedemptionPaisePerTxn: number;
  earnToRedeemMinHours: number;
  enabled: boolean;
  earnRateBookingBps: number;
  earnRateCafeBps: number;
  cafeEarnEnabled: boolean;
  // Months until earned points expire. 0 = no expiry — the
  // RewardsHowItWorksScreen flips to a "points never expire"
  // variant when this is 0.
  pointExpiryMonths: number;
}

export interface RewardOverview {
  pointsAvailable: number;
  pointsValuePaise: number;
  pointsLifetimeEarned: number;
  pointsLifetimeRedeemed: number;
  pointsLifetimeExpired: number;
  expiringSoonPoints: number;
  expiringSoonPaise: number;
  config: RewardConfigSnapshot;
}

export interface RewardTxnRow {
  id: string;
  type: string;
  points: number;
  pointsValuePaise: number;
  bookingId: string | null;
  cafeOrderId: string | null;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface MyTxnsResult {
  rows: RewardTxnRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface RedemptionPreview {
  enabled: boolean;
  maxPoints: number;
  maxPaise: number;
  pointsAvailable: number;
  pointValuePaise: number;
  minPoints: number;
  blockedReason?: string;
}

export const rewardsApi = {
  overview: () =>
    api.get<{ overview: RewardOverview | null }>(
      "/api/mobile/rewards/overview",
    ),

  transactions: (params?: { before?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.before) q.set("before", params.before);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return api.get<MyTxnsResult>(
      `/api/mobile/rewards/transactions${qs ? `?${qs}` : ""}`,
    );
  },

  redemptionPreview: (billPaise: number) =>
    api.get<{ preview: RedemptionPreview | null }>(
      `/api/mobile/rewards/redemption-preview?billPaise=${billPaise}`,
    ),

  /**
   * Live earn-rate for this customer + sport. Returns `{ bps: 0 }`
   * when rewards are disabled or this sport is excluded, which the
   * checkout uses to hide the "you'll earn X points" line.
   * Fetched once per checkout mount; the projected earn itself is
   * recomputed locally as the bill total changes.
   */
  bookingEarnRate: (sport: string) =>
    api.get<{ bps: number }>(
      `/api/mobile/rewards/booking-earn-rate?sport=${encodeURIComponent(sport)}`,
    ),
};
