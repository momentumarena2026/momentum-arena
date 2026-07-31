import { request } from "./admin-api";

/**
 * Mobile admin passes client — mirrors the web admin passes hub
 * (actions/admin-passes.ts) via /api/mobile/admin/passes. One GET
 * returns the whole dashboard; mutations POST { action, ...payload }.
 */

// Pricing band cell — (dayType × timeType). Matches lib/pass-bands.Band.
export type DayType = "WEEKDAY" | "WEEKEND";
export type TimeType = "PEAK" | "OFF_PEAK";
export interface Band {
  dayType: DayType;
  timeType: TimeType;
}

export const bandKey = (b: Band) => `${b.dayType}-${b.timeType}`;
export const bandLabel = (b: Band) =>
  `${b.dayType === "WEEKDAY" ? "Weekday" : "Weekend"} · ${
    b.timeType === "PEAK" ? "Peak" : "Off-peak"
  }`;
/** Court group option (interchangeable positions collapsed) + rates. */
export interface PassConfigOption {
  id: string;
  sport: string;
  label: string;
  category: string | null;
  slotDurationMinutes: number;
  maxPassMembers: number;
  rates: { dayType: string; timeType: string; pricePerSlot: number }[];
}

export interface AdminPassPlan {
  id: string;
  name: string;
  sport: string;
  courtConfigId: string;
  totalMinutes: number;
  anchorPricePerHour: number | null;
  anchorPrice: number | null;
  bands: Band[];
  /** False when the sport's price drifted off the anchor — unsellable. */
  pricingValid: boolean;
  baseAmount: number;
  discountPercent: number;
  price: number;
  validityDays: number;
  isActive: boolean;
  /** True when this plan is the sport's cheapest-hour showcase — the
   *  bucket (peak/off-peak/both) is derived from its bands. */
  isCheapestHourAnchor: boolean;
  soldCount: number;
}

export interface SoldPass {
  id: string;
  name: string;
  customer: string;
  phone: string;
  totalMinutes: number;
  remainingMinutes: number;
  price: number;
  status: "ACTIVE" | "UPCOMING" | "EXHAUSTED" | "EXPIRED" | "CANCELLED";
  method: string;
  purchasedAt: string;
  startsAt: string;
  expiresAt: string;
  redemptionCount: number;
  memberCount: number;
}

export interface AdminPassesData {
  enabled: boolean;
  configs: PassConfigOption[];
  plans: AdminPassPlan[];
  sold: SoldPass[];
}

export interface PassMembersData {
  passName: string;
  owner: { name: string | null; phone: string | null };
  maxMembers: number;
  members: {
    userId: string;
    name: string | null;
    phone: string | null;
    addedAt: string;
  }[];
}

type OkResult = { ok: boolean; error?: string };

const BASE = "/api/mobile/admin/passes";

function action<T = OkResult>(body: Record<string, unknown>) {
  return request<T>(BASE, { method: "POST", body });
}

export const adminPassesApi = {
  data: () => request<AdminPassesData>(BASE, { method: "GET" }),

  setEnabled: (enabled: boolean) => action({ action: "set-enabled", enabled }),

  createPlan: (input: {
    courtConfigId: string;
    totalHours: number;
    bands: Band[];
    discountPercent: number;
    validityDays: number;
    name?: string;
  }) => action({ action: "create-plan", ...input }),

  updatePlan: (
    id: string,
    input: {
      totalHours: number;
      bands: Band[];
      discountPercent: number;
      validityDays: number;
      name?: string;
    },
  ) => action({ action: "update-plan", id, ...input }),

  togglePlan: (id: string, isActive: boolean) =>
    action({ action: "toggle-plan", id, isActive }),

  /** Tick/untick a plan as the sport's cheapest-hour anchor (bucket
   *  derives from its bands; overlapping plans get un-ticked). */
  setCheapestHour: (id: string, on: boolean) =>
    action({ action: "set-cheapest-hour", id, on }),

  deletePlan: (id: string) => action({ action: "delete-plan", id }),

  issue: (input: {
    planId: string;
    userId: string;
    paymentMethod: "CASH" | "UPI_QR" | "FREE";
    amountCollected?: number;
    offlineRef?: string;
    startDate?: string;
  }) =>
    action<OkResult & { userPassId?: string }>({ action: "issue", ...input }),

  gift: (input: {
    userId: string;
    courtConfigId: string;
    totalHours: number;
    validityDays: number;
    bands?: Band[];
    name?: string;
    value?: number;
    note?: string;
    startDate?: string;
  }) => action<OkResult & { userPassId?: string }>({ action: "gift", ...input }),

  extend: (id: string, extraDays: number) =>
    action({ action: "extend", id, extraDays }),

  adjustMinutes: (id: string, deltaMinutes: number) =>
    action({ action: "adjust-minutes", id, deltaMinutes }),

  cancel: (id: string) => action({ action: "cancel", id }),

  setSharing: (courtConfigId: string, max: number) =>
    action({ action: "set-sharing", courtConfigId, max }),

  members: (passId: string) =>
    request<PassMembersData>(`${BASE}/${passId}/members`, { method: "GET" }),

  addMember: (passId: string, phone: string) =>
    request<OkResult & { notRegistered?: boolean; phone?: string }>(
      `${BASE}/${passId}/members`,
      { method: "POST", body: { phone } },
    ),

  removeMember: (passId: string, userId: string) =>
    request<OkResult>(`${BASE}/${passId}/members`, {
      method: "POST",
      body: { remove: userId },
    }),
};
