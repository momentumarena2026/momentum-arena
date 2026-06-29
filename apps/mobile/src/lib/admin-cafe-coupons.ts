import { request } from "./admin-api";

export type CafeCouponType = "PERCENTAGE" | "FLAT";
/** Booking.platform values. Empty validPlatforms = all platforms. */
export type CafeCouponPlatform = "web" | "android" | "ios";
export type CafeCategory =
  | "SNACKS"
  | "BEVERAGES"
  | "MEALS"
  | "DESSERTS"
  | "COMBOS";

export interface AdminCafeCoupon {
  id: string;
  code: string;
  type: CafeCouponType;
  /** PERCENTAGE = basis points (1000 = 10%); FLAT = rupees. */
  value: number;
  maxUses: number | null;
  maxUsesPerUser: number;
  minOrderAmount: number | null;
  categoryFilter: CafeCategory[];
  /** Empty = all platforms; ["android","ios"] = app-only; etc. */
  validPlatforms: CafeCouponPlatform[];
  validFrom: string;
  validUntil: string;
  isActive: boolean;
  createdAt: string;
  _count: { usages: number };
}

export interface CreateCafeCouponInput {
  code: string;
  type: CafeCouponType;
  value: number;
  maxUses?: number;
  maxUsesPerUser?: number;
  minOrderAmount?: number;
  categoryFilter?: CafeCategory[];
  validPlatforms?: CafeCouponPlatform[];
  validFrom: string;
  validUntil: string;
}

export type UpdateCafeCouponInput = Partial<
  Omit<CreateCafeCouponInput, "code" | "type"> & { isActive: boolean }
>;

export const adminCafeCouponsApi = {
  list: (showInactive = false) =>
    request<{ coupons: AdminCafeCoupon[] }>(
      `/api/mobile/admin/cafe-coupons${showInactive ? "?showInactive=1" : ""}`,
      { method: "GET" },
    ),
  create: (body: CreateCafeCouponInput) =>
    request<{ ok: true }>("/api/mobile/admin/cafe-coupons", {
      method: "POST",
      body,
    }),
  update: (id: string, body: UpdateCafeCouponInput) =>
    request<{ ok: true }>(`/api/mobile/admin/cafe-coupons/${id}`, {
      method: "PATCH",
      body,
    }),
  remove: (id: string) =>
    request<{ ok: true }>(`/api/mobile/admin/cafe-coupons/${id}`, {
      method: "DELETE",
    }),
};
