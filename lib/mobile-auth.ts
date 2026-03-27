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

export function signMobileToken(userId: string, email: string): string {
  return jwt.sign(
    { userId, email, type: "mobile" } satisfies MobileTokenPayload,
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
