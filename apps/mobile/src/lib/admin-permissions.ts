import type { AdminUser } from "./admin-auth";

/**
 * All granular admin permissions — a mirror of the web `lib/permissions.ts`
 * ALL_PERMISSIONS list. The mobile app is a separate package and can't import
 * the web lib, so the (small, stable) list is duplicated here. Keep in sync.
 */
export const ALL_ADMIN_PERMISSIONS = [
  "MANAGE_BOOKINGS",
  "MANAGE_PRICING",
  "MANAGE_SLOTS",
  "MANAGE_SPORTS",
  "MANAGE_USERS",
  "MANAGE_DISCOUNTS",
  "MANAGE_FAQS",
  "VIEW_ANALYTICS",
  "VIEW_RAZORPAY",
  "MANAGE_ADMIN_USERS",
  "MANAGE_CAFE_MENU",
  "MANAGE_CAFE_ORDERS",
  "MANAGE_CAFE_DISCOUNTS",
  "MANAGE_REWARDS",
  "MANAGE_COUPONS",
  "MANAGE_EXPENSES",
  "MANAGE_PUSH",
  "MANAGE_SHOP_CATALOG",
  "MANAGE_SHOP_ORDERS",
] as const;

export type AdminPermission = (typeof ALL_ADMIN_PERMISSIONS)[number];

type AdminLike = Pick<AdminUser, "role" | "permissions"> | null | undefined;

/**
 * True if the admin holds `required`. SUPERADMIN implicitly holds everything
 * (mirrors the web layout's "SUPERADMIN sees all" rule).
 */
export function adminCan(
  admin: AdminLike,
  required: AdminPermission | null,
): boolean {
  // null = visible to every admin (e.g. "My profile").
  if (required === null) return true;
  if (!admin) return false;
  if (admin.role === "SUPERADMIN") return true;
  return (admin.permissions ?? []).includes(required);
}

/** True if the admin holds ANY of `required` (SUPERADMIN always true). */
export function adminCanAny(
  admin: AdminLike,
  required: AdminPermission[],
): boolean {
  return required.some((p) => adminCan(admin, p));
}
