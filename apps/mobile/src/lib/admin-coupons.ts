import { request } from "./admin-api";

export type CouponScope = "BOTH" | "SPORTS" | "CAFE";
export type CouponType = "PERCENTAGE" | "FLAT";
/** Booking.platform values. Empty validPlatforms = all platforms. */
export type CouponPlatform = "web" | "android" | "ios";

export type Sport = "CRICKET" | "FOOTBALL" | "PICKLEBALL";
export type CafeItemCategory =
  | "SNACKS"
  | "BEVERAGES"
  | "MEALS"
  | "DESSERTS"
  | "COMBOS";
export type BookingCategory = "BOX_CRICKET" | "BOWLING_MACHINE";
export type UserGroupType =
  | "FIRST_TIME"
  | "PREMIUM_PLAYER"
  | "FREQUENT_VISITOR"
  | "BIRTHDAY_MONTH"
  | "CUSTOM";
export type CouponConditionType =
  | "MIN_AMOUNT"
  | "FIRST_PURCHASE"
  | "USER_GROUP"
  | "SPORT_SPECIFIC"
  | "CATEGORY_SPECIFIC"
  | "TIME_WINDOW"
  | "BIRTHDAY"
  | "REFERRAL"
  | "FIRST_APP_BOOKING"
  | "BOOKING_DATE";

export interface CouponCondition {
  conditionType: CouponConditionType;
  /** JSON string, e.g. {"minAmount":500} or {"startHour":9,"endHour":12}. */
  conditionValue: string;
}

export interface EligibleUserSummary {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface EligibleGroupSummary {
  id: string;
  name: string;
}

export interface AdminCoupon {
  id: string;
  code: string;
  description: string | null;
  scope: CouponScope;
  type: CouponType;
  /** PERCENTAGE = basis points; FLAT = whole RUPEES. */
  value: number;
  maxDiscount: number | null; // whole rupees (% cap)
  maxUses: number | null;
  usedCount: number;
  maxUsesPerUser: number;
  minAmount: number | null; // whole rupees
  sportFilter: Sport[];
  categoryFilter: CafeItemCategory[];
  categoryExclude: BookingCategory[];
  userGroupFilter: UserGroupType[];
  /** Empty = all platforms; ["android","ios"] = app-only; etc. */
  validPlatforms: CouponPlatform[];
  isStackable: boolean;
  stackGroup: string | null;
  isPublic: boolean;
  isSystemCode: boolean;
  autoApply: boolean;
  showStrikethrough?: boolean;
  isActive: boolean;
  validFrom: string;
  validUntil: string;
  createdAt: string;
  conditions: CouponCondition[];
  eligibleUsers: EligibleUserSummary[];
  eligibleGroups: EligibleGroupSummary[];
  _count: { usages: number };
}

export interface CreateCouponInput {
  code: string;
  description?: string;
  scope: CouponScope;
  type: CouponType;
  value: number; // already in bps (%) / whole rupees (FLAT)
  maxDiscount?: number | null; // whole rupees
  maxUses?: number | null;
  maxUsesPerUser?: number;
  minAmount?: number | null; // whole rupees
  sportFilter?: Sport[];
  categoryFilter?: CafeItemCategory[];
  categoryExclude?: BookingCategory[];
  userGroupFilter?: UserGroupType[];
  validPlatforms?: CouponPlatform[];
  isStackable?: boolean;
  stackGroup?: string | null;
  isPublic?: boolean;
  isSystemCode?: boolean;
  autoApply?: boolean;
  showStrikethrough?: boolean;
  validFrom: string;
  validUntil: string;
  conditions?: CouponCondition[];
  eligibleUserIds?: string[];
  eligibleGroupIds?: string[];
}

export type UpdateCouponInput = Partial<
  Omit<CreateCouponInput, "code"> & { isActive: boolean }
>;

export interface CouponGroupOption {
  id: string;
  name: string;
  memberCount: number;
}

export const adminCouponsApi = {
  list: (showInactive = false) =>
    request<{ coupons: AdminCoupon[] }>(
      `/api/mobile/admin/coupons${showInactive ? "?showInactive=1" : ""}`,
      { method: "GET" },
    ),
  create: (body: CreateCouponInput) =>
    request<{ ok: true }>("/api/mobile/admin/coupons", {
      method: "POST",
      body,
    }),
  update: (id: string, body: UpdateCouponInput) =>
    request<{ ok: true }>(`/api/mobile/admin/coupons/${id}`, {
      method: "PATCH",
      body,
    }),
  remove: (id: string) =>
    request<{ ok: true }>(`/api/mobile/admin/coupons/${id}`, {
      method: "DELETE",
    }),
  /** Customer search for the "Customer Targeting" picker. */
  searchUsers: (q: string) =>
    request<{ users: EligibleUserSummary[] }>(
      `/api/mobile/admin/coupons/users?q=${encodeURIComponent(q)}`,
      { method: "GET" },
    ),
  /** Admin-curated groups available to target a coupon. */
  listGroups: () =>
    request<{ groups: CouponGroupOption[] }>("/api/mobile/admin/user-groups", {
      method: "GET",
    }),
};
