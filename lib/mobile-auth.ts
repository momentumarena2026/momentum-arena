import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import { db } from "./db";

function getJwtSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET environment variable is required");
  return secret;
}
const JWT_EXPIRES_IN = "30d"; // 30 day sessions

export interface MobileTokenPayload {
  userId: string;
  email: string;
  type: "mobile";
}

/**
 * Admin variant of the mobile token. Issued by /api/mobile/admin/login
 * after username + password verification against the AdminUser table.
 * Same signing key as the customer token but `type: "mobile-admin"`,
 * so the two are not interchangeable — `verifyMobileToken` rejects
 * admin tokens and `verifyMobileAdminToken` rejects customer tokens.
 */
export interface MobileAdminTokenPayload {
  adminId: string;
  username: string;
  role: string;
  permissions: string[];
  type: "mobile-admin";
}

export function signMobileToken(userId: string, email: string): string {
  return jwt.sign(
    { userId, email, type: "mobile" } satisfies MobileTokenPayload,
    getJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function signMobileAdminToken(
  admin: { id: string; username: string; role: string; permissions: string[] }
): string {
  return jwt.sign(
    {
      adminId: admin.id,
      username: admin.username,
      role: admin.role,
      permissions: admin.permissions,
      type: "mobile-admin",
    } satisfies MobileAdminTokenPayload,
    getJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyMobileToken(token: string): MobileTokenPayload | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as MobileTokenPayload;
    if (payload.type !== "mobile") return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifyMobileAdminToken(
  token: string
): MobileAdminTokenPayload | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as MobileAdminTokenPayload;
    if (payload.type !== "mobile-admin") return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract and verify JWT from Authorization header.
 * Returns the user ID or null if invalid.
 */
export async function getMobileUser(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const payload = verifyMobileToken(token);
  if (!payload) return null;

  // Verify user still exists
  const user = await db.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      emailVerified: true,
      passwordHash: true,
      image: true,
    },
  });

  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    emailVerified: !!user.emailVerified,
    hasPassword: !!user.passwordHash,
    image: user.image,
  };
}

/**
 * Mobile admin auth gate. Reads the bearer token, verifies it as a
 * `mobile-admin` JWT, then re-fetches the AdminUser row to confirm
 * the row still exists. Returns null on any failure so route handlers
 * can early-return 401 without surfacing internal errors.
 */
export async function getMobileAdmin(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const payload = verifyMobileAdminToken(token);
  if (!payload) return null;

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

  return admin;
}

/**
 * Read the platform of a request originating from the mobile app.
 * Mobile sends `X-Platform: android` or `X-Platform: ios` automatically
 * (set in apps/mobile/src/lib/api.ts). Falls back to "android" rather
 * than "web" because anything hitting /api/mobile/* is, by definition,
 * the mobile client — and this default still groups correctly when an
 * older build that doesn't set the header makes a request.
 */
export function getMobilePlatform(request: NextRequest): "android" | "ios" {
  const v = request.headers.get("x-platform")?.toLowerCase();
  return v === "ios" ? "ios" : "android";
}

export function mobileUserResponse(user: {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  image: string | null;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    emailVerified: user.emailVerified,
    hasPassword: user.hasPassword,
    image: user.image,
  };
}
