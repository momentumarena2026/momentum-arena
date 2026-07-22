import { headers } from "next/headers";
import { adminAuth } from "@/lib/admin-auth-session";
import { verifyMobileAdminToken } from "@/lib/mobile-auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";

/**
 * The caller's admin identity, normalised across both surfaces. The
 * shape is the web session's — mobile admins are mapped onto it
 * (`username` -> `name`, `role` -> `adminRole`) so the ~28 action files
 * that read `user.id` / `user.adminRole` / `user.permissions` don't care
 * which surface the call arrived from.
 */
export type AdminIdentity = {
  id: string;
  name?: string;
  email?: string;
  userType: string;
  adminRole?: string;
  permissions?: string[];
};

/**
 * Resolve the calling admin from EITHER the web cookie session or the
 * mobile Bearer JWT, then enforce `permission`.
 *
 * Both surfaces land here because the mobile API routes under
 * /api/mobile/admin/* call these server actions IN-PROCESS — so
 * `headers()` inside the action returns the mobile request's own
 * Authorization header. There is no second hop and no request object to
 * thread through.
 *
 * ─── WHY THERE IS NO `skipAuth` PARAMETER ───────────────────────────
 * There used to be one, on ~28 action files. In a "use server" module
 * EVERY exported function is a public POST endpoint whose ARGUMENTS COME
 * FROM THE CLIENT, and the action id ships in the public /_next/static
 * bundle for any action a "use client" component imports. So
 * `updateAdminRewardConfig(input, skipAuth = true)` was a self-service
 * bypass of the permission gate, reachable by anyone — as were the
 * booking, cafe, users, passes and payment-settings equivalents.
 *
 * Never reintroduce a parameter that affects whether auth runs. If a
 * caller needs to skip the gate, it is not a caller that should be
 * reaching a "use server" export.
 * ────────────────────────────────────────────────────────────────────
 */
export async function requireAdmin(
  permission?: string,
): Promise<AdminIdentity> {
  const user = await resolveAdmin();
  if (!user) {
    throw new Error("Unauthorized");
  }

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

export async function requireSuperadmin(): Promise<AdminIdentity> {
  const user = await resolveAdmin();

  if (!user || user.adminRole !== "SUPERADMIN") {
    throw new Error("Unauthorized: Superadmin access required");
  }

  return user;
}

/**
 * Web session first, mobile bearer second. Order matters only for an
 * admin browsing the web app while holding a mobile token; the cookie
 * session is the more specific signal there.
 */
async function resolveAdmin(): Promise<AdminIdentity | null> {
  const session = await adminAuth().catch(() => null);
  if (session?.user) {
    return session.user as unknown as AdminIdentity;
  }
  return readMobileAdmin();
}

async function readMobileAdmin(): Promise<AdminIdentity | null> {
  // headers() throws outside a request scope (e.g. a build-time render).
  // That is not an auth failure, so treat it as "no mobile caller".
  let authHeader: string | null = null;
  try {
    authHeader = (await headers()).get("authorization");
  } catch {
    return null;
  }
  if (!authHeader?.startsWith("Bearer ")) return null;

  const payload = verifyMobileAdminToken(authHeader.slice(7));
  if (!payload) return null;

  // Permissions are read fresh from the row rather than trusted from the
  // token, so revoking an admin's access takes effect immediately rather
  // than at token expiry.
  const admin = await db.adminUser.findUnique({
    where: { id: payload.adminId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      permissions: true,
    },
  });
  if (!admin) return null;

  return {
    id: admin.id,
    name: admin.username,
    email: admin.email ?? undefined,
    userType: "ADMIN",
    adminRole: admin.role,
    permissions: admin.permissions ?? [],
  };
}
