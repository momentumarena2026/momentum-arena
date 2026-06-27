import { request } from "./admin-api";

/**
 * Legacy discount codes. Mirrors web /admin/discounts.
 *
 * Units (match the DiscountCode model):
 *   - PERCENTAGE value = basis points (1000 = 10%).
 *   - FLAT value = whole rupees.
 *   - minBookingAmount = whole rupees.
 * The screen converts ₹/% inputs before sending.
 */
export type DiscountType = "PERCENTAGE" | "FLAT";
export type DiscountSport = "CRICKET" | "FOOTBALL" | "PICKLEBALL";

export interface AdminDiscountCode {
  id: string;
  code: string;
  type: DiscountType;
  /** PERCENTAGE = basis points (1000 = 10%); FLAT = rupees. */
  value: number;
  maxUses: number | null;
  usedCount: number;
  maxUsesPerUser: number;
  minBookingAmount: number | null;
  sportFilter: DiscountSport[];
  validFrom: string;
  validUntil: string;
  isSystemCode: boolean;
  isActive: boolean;
  usages: number;
  createdAt: string;
}

export interface CreateDiscountInput {
  code: string;
  type: DiscountType;
  value: number;
  maxUses?: number;
  maxUsesPerUser?: number;
  minBookingAmount?: number;
  sportFilter?: DiscountSport[];
  validFrom: string;
  validUntil: string;
}

export type UpdateDiscountInput = Partial<{
  value: number;
  maxUses: number;
  maxUsesPerUser: number;
  minBookingAmount: number;
  sportFilter: DiscountSport[];
  validFrom: string;
  validUntil: string;
  isActive: boolean;
}>;

export const adminDiscountsApi = {
  list: (showInactive = false) =>
    request<{
      codes: AdminDiscountCode[];
      total: number;
      page: number;
      totalPages: number;
    }>(
      `/api/mobile/admin/discounts${showInactive ? "?showInactive=1" : ""}`,
      { method: "GET" },
    ),
  create: (body: CreateDiscountInput) =>
    request<{ ok: true }>("/api/mobile/admin/discounts", {
      method: "POST",
      body,
    }),
  update: (id: string, body: UpdateDiscountInput) =>
    request<{ ok: true }>(`/api/mobile/admin/discounts/${id}`, {
      method: "PATCH",
      body,
    }),
  remove: (id: string) =>
    request<{ ok: true }>(`/api/mobile/admin/discounts/${id}`, {
      method: "DELETE",
    }),
};
