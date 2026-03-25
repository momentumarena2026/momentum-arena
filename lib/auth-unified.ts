import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getMobileUser } from "@/lib/mobile-auth";

/**
 * Unified auth that checks both NextAuth sessions (web) and JWT tokens (mobile).
 * Returns the user ID if authenticated, null otherwise.
 */
export async function getAuthUserId(
  request?: NextRequest
): Promise<string | null> {
  // Try mobile JWT first (if request has Authorization header)
  if (request) {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const mobileUser = await getMobileUser(request);
      return mobileUser?.id || null;
    }
  }

  // Fall back to NextAuth session
  const session = await auth();
  return session?.user?.id || null;
}
