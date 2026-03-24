// All granular admin permissions.
// When adding a new feature, add its permission constant here.
export const ALL_PERMISSIONS = [
  "MANAGE_BOOKINGS",
  "MANAGE_PRICING",
  "MANAGE_SLOTS",
  "MANAGE_SPORTS",
  "MANAGE_USERS",
  "MANAGE_DISCOUNTS",
  "MANAGE_BANNERS",
  "MANAGE_FAQS",
  "VIEW_ANALYTICS",
  "MANAGE_ADMIN_USERS",
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
  MANAGE_BANNERS: "Manage Banners",
  MANAGE_FAQS: "Manage FAQs",
  VIEW_ANALYTICS: "View Analytics",
  MANAGE_ADMIN_USERS: "Manage Admin Users",
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
