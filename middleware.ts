import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Decode JWT payload without verification (Edge runtime compatible).
 * Returns null if token is malformed or expired.
 */
function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    );
    // Check expiry
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null; // expired
    }
    return payload;
  } catch {
    return null;
  }
}

function isValidSessionCookie(cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  // NextAuth session tokens are JWTs — validate structure and expiry
  const payload = decodeJwtPayload(cookieValue);
  return payload !== null;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Admin routes — check admin session cookie validity
  if (pathname.startsWith("/admin")) {
    const adminToken = request.cookies.get("admin-session-token")?.value;
    if (!isValidSessionCookie(adminToken)) {
      // Clear stale cookie
      const response = NextResponse.redirect(new URL("/godmode", request.url));
      if (adminToken) response.cookies.delete("admin-session-token");
      return response;
    }
    return NextResponse.next();
  }

  // Godmode login page — if admin already logged in, redirect to admin
  if (pathname.startsWith("/godmode")) {
    const adminToken = request.cookies.get("admin-session-token")?.value;
    if (
      isValidSessionCookie(adminToken) &&
      !pathname.startsWith("/godmode/setup-password")
    ) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  // Protected customer routes — check customer session cookie validity
  if (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/bookings") ||
    pathname.startsWith("/profile")
  ) {
    const customerToken =
      request.cookies.get("authjs.session-token")?.value ||
      request.cookies.get("__Secure-authjs.session-token")?.value;
    if (!isValidSessionCookie(customerToken)) {
      const response = NextResponse.redirect(new URL("/", request.url));
      return response;
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/godmode/:path*",
    "/bookings/:path*",
    "/profile/:path*",
  ],
};
