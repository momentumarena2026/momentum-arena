import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export async function requireAdmin(permission?: string) {
  const session = await auth();

  if (!session?.user || session.user.userType !== "admin") {
    throw new Error("Unauthorized");
  }

  if (
    permission &&
    !hasPermission(session.user.permissions || [], permission)
  ) {
    throw new Error("Insufficient permissions");
  }

  return session.user;
}

export async function requireSuperadmin() {
  const session = await auth();

  if (
    !session?.user ||
    session.user.userType !== "admin" ||
    session.user.adminRole !== "SUPERADMIN"
  ) {
    throw new Error("Unauthorized: Superadmin access required");
  }

  return session.user;
}
