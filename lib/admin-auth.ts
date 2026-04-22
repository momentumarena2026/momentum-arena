import { adminAuth } from "@/lib/admin-auth-session";
import { hasPermission } from "@/lib/permissions";

export async function requireAdmin(permission?: string) {
  const session = await adminAuth();

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const user = session.user as unknown as {
    id: string;
    name?: string;
    email?: string;
    userType: string;
    adminRole?: string;
    permissions?: string[];
  };

  // Superadmins bypass per-permission checks. This matches the admin
  // sidebar, which already treats SUPERADMIN as having every permission,
  // and means newly-introduced permissions (added to ALL_PERMISSIONS in
  // a later release) don't lock superadmins out until their DB row is
  // manually updated.
  if (
    permission &&
    user.adminRole !== "SUPERADMIN" &&
    !hasPermission(user.permissions || [], permission)
  ) {
    throw new Error("Insufficient permissions");
  }

  return user;
}

export async function requireSuperadmin() {
  const session = await adminAuth();

  if (!session?.user) {
    throw new Error("Unauthorized: Superadmin access required");
  }

  const user = session.user as unknown as {
    id: string;
    name?: string;
    email?: string;
    userType: string;
    adminRole?: string;
    permissions?: string[];
  };

  if (user.adminRole !== "SUPERADMIN") {
    throw new Error("Unauthorized: Superadmin access required");
  }

  return user;
}
