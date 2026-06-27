import { request } from "./admin-api";

export type CouponScope = "BOTH" | "SPORTS" | "CAFE";
export type CouponType = "PERCENTAGE" | "FLAT";

export interface AdminCoupon {
  id: string;
  code: string;
  description: string | null;
  scope: CouponScope;
  type: CouponType;
  /** PERCENTAGE = basis points; FLAT = paise. */
  value: number;
  maxDiscount: number | null; // paise
  maxUses: number | null;
  usedCount: number;
  maxUsesPerUser: number;
  minAmount: number | null; // whole rupees
  isPublic: boolean;
  isActive: boolean;
  validFrom: string;
  validUntil: string;
  createdAt: string;
  _count: { usages: number };
}

export interface CreateCouponInput {
  code: string;
  description?: string;
  scope: CouponScope;
  type: CouponType;
  value: number; // already in bps / paise
  maxDiscount?: number | null; // paise
  maxUses?: number | null;
  maxUsesPerUser?: number;
  minAmount?: number | null; // whole rupees
  isPublic?: boolean;
  validFrom: string;
  validUntil: string;
}

export type UpdateCouponInput = Partial<
  Omit<CreateCouponInput, "code" | "type"> & { isActive: boolean }
>;

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
};
