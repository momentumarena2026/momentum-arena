// All granular admin permissions.
// When adding a new feature, add its permission constant here.
export const ALL_PERMISSIONS = [
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
  // Shop module: catalog (products + categories + stock) and the
  // orders queue + walk-in POS sale form. Kept as two so a venue
  // can split "stock & pricing" duty from "front-desk sale" duty.
  "MANAGE_SHOP_CATALOG",
  "MANAGE_SHOP_ORDERS",
  // Mobile-app release operations: OTA rollouts/rollbacks, release-flow
  // dashboard, version gates (min build / force update). Previously borrowed
  // MANAGE_PRICING — split out so app releases can be granted independently.
  "MANAGE_APP_RELEASES",
  // Payment gateway settings: active gateway switch, per-method toggles,
  // DQR enablement. Previously straddled VIEW_RAZORPAY (sidebar) and
  // MANAGE_PRICING (actions) — now one dedicated permission for both.
  "MANAGE_PAYMENT_SETTINGS",
  // Trusted-device allowlist for the app's hidden 5-tap admin entry
  // (/admin/trusted-devices + the mobile-admin screen).
  "MANAGE_TRUSTED_DEVICES",
  "MANAGE_PROMO_BANNERS",
  // Monthly passes: plan wizard + sold-pass management.
  "MANAGE_PASSES",
  // HR / Legal: employee NDA generator (/admin/nda) + its audit log.
  "MANAGE_HR",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

// Only superadmin can manage other admin users
export const SUPERADMIN_ONLY_PERMISSIONS: Permission[] = ["MANAGE_ADMIN_USERS"];

// Permission labels for display in UI
export const PERMISSION_LABELS: Record<Permission, string> = {
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
  MANAGE_HR: "Manage HR / Legal (Employee NDA Generator)",
};

export function hasPermission(
  userPermissions: string[],
  required: string
): boolean {
  return userPermissions.includes(required);
}

export function hasAnyPermission(
  userPermissions: string[],
  required: string[]
): boolean {
  return required.some((p) => userPermissions.includes(p));
}
