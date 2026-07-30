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
  "MANAGE_APP_RELEASES",
  "MANAGE_PAYMENT_SETTINGS",
  "MANAGE_TRUSTED_DEVICES",
  "MANAGE_PROMO_BANNERS",
  "MANAGE_PASSES",
  "MANAGE_TOURNAMENTS",
] as const;

export type AdminPermission = (typeof ALL_ADMIN_PERMISSIONS)[number];

/**
 * Human-readable labels for each permission, mirroring the web
 * `lib/permissions.ts` PERMISSION_LABELS map. Used by the admin-account
 * editor to render permission checkboxes. Keep in sync.
 */
export const PERMISSION_LABELS: Record<AdminPermission, string> = {
  MANAGE_BOOKINGS: "Manage Bookings",
  MANAGE_PRICING: "Manage Pricing",
  MANAGE_SLOTS: "Manage Slot Blocks",
  MANAGE_SPORTS: "Manage Sports",
  MANAGE_USERS: "Manage Users",
  MANAGE_DISCOUNTS: "Manage Discounts",
  MANAGE_FAQS: "Manage FAQs",
  VIEW_ANALYTICS: "View Analytics",
  VIEW_RAZORPAY: "View Payment Gateways (Razorpay/PhonePe)",
  MANAGE_ADMIN_USERS: "Manage Admin Users",
  MANAGE_CAFE_MENU: "Manage Cafe Menu",
  MANAGE_CAFE_ORDERS: "Manage Cafe Orders",
  MANAGE_CAFE_DISCOUNTS: "Manage Cafe Coupons",
  MANAGE_REWARDS: "Manage Reward Points",
  MANAGE_COUPONS: "Manage Unified Coupons",
  MANAGE_EXPENSES: "Manage Expenses",
  MANAGE_PUSH: "Manage Push Notifications",
  MANAGE_SHOP_CATALOG: "Manage Shop Catalog",
  MANAGE_SHOP_ORDERS: "Manage Shop Orders",
  MANAGE_APP_RELEASES: "Manage App Releases (OTA)",
  MANAGE_PAYMENT_SETTINGS: "Manage Payment Settings",
  MANAGE_TRUSTED_DEVICES: "Manage Trusted Devices (5-tap admin entry)",
  MANAGE_PROMO_BANNERS: "Manage Promotion Banners (web & app)",
  MANAGE_PASSES: "Manage Monthly Passes",
  MANAGE_TOURNAMENTS: "Manage Tournaments",
};

/**
 * Permissions only a SUPERADMIN may hold. The admin-account editor hides
 * these from the checkbox list since a created/edited ADMIN can never be
 * granted them (the server filters them out too). Mirrors the web
 * SUPERADMIN_ONLY_PERMISSIONS.
 */
export const SUPERADMIN_ONLY_PERMISSIONS: AdminPermission[] = [
  "MANAGE_ADMIN_USERS",
];

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
