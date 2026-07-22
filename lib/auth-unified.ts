import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getMobileUser, verifyMobileToken } from "@/lib/mobile-auth";

/**
 * Unified auth that checks both NextAuth sessions (web) and JWT tokens (mobile).
 * Returns the user ID if authenticated, null otherwise.
 *
 * Works with OR without a NextRequest. Route handlers pass theirs; server
 * actions have none, so the no-argument form reads the incoming request's
 * headers via `headers()` instead. That matters because the mobile API routes
 * call customer server actions IN-PROCESS — the mobile Bearer token is on the
 * same request either way.
 *
 * ─── WHY THERE IS NO `userIdOverride` PARAMETER ─────────────────────────
 * Customer actions used to accept one, and it was the same hole as the admin
 * surface's `skipAuth`: in a "use server" module every export is a public POST
 * endpoint whose ARGUMENTS COME FROM THE CLIENT. `getMyRewardOverview(victimId)`
 * read anyone's points balance; `cancelOrder(orderId, reason, victimId)`
 * cancelled anyone's order. Identity must be derived from the request, never
 * accepted as an argument.
 *
 * Server-to-server callers that legitimately act for a user (the Razorpay
 * webhook confirming an order it looked up in the DB) call the internal
 * non-"use server" helper instead — see lib/shop-confirm.ts.
 * ────────────────────────────────────────────────────────────────────────
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
  } else {
    const mobileId = await readMobileUserFromHeaders();
    if (mobileId) return mobileId;
  }

  // Fall back to NextAuth session
  const session = await auth();
  return session?.user?.id || null;
}

/**
 * The request-free half of the mobile check. `headers()` throws outside a
 * request scope (a build-time render, say), which is not an auth failure —
 * treat it as "no mobile caller" and let the session path decide.
 */
async function readMobileUserFromHeaders(): Promise<string | null> {
  let authHeader: string | null = null;
  try {
    authHeader = (await headers()).get("authorization");
  } catch {
    return null;
  }
  if (!authHeader?.startsWith("Bearer ")) return null;

  const payload = verifyMobileToken(authHeader.slice(7));
  return payload?.userId ?? null;
}
