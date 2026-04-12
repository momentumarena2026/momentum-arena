import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Check if a session cookie has a non-empty value.
 * Full JWT/session validation happens server-side in requireAdmin()/auth().
 * Middleware provides defense-in-depth by rejecting clearly invalid cookies.
 */
function hasValidCookie(cookieValue: string | undefined): boolean {
  return !!cookieValue && cookieValue.length > 10;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Admin routes — check admin session cookie
  if (pathname.startsWith("/admin")) {
    const adminToken = request.cookies.get("admin-session-token")?.value;
    if (!hasValidCookie(adminToken)) {
      const godmodeUrl = new URL("/godmode", request.url);
      // Preserve the original URL so admin can return after login
      godmodeUrl.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
      const response = NextResponse.redirect(godmodeUrl);
      if (adminToken) response.cookies.delete("admin-session-token");
      return response;
    }
    return NextResponse.next();
  }

  // Godmode login page — if admin already logged in, redirect to admin (or callbackUrl)
  if (pathname.startsWith("/godmode")) {
    const adminToken = request.cookies.get("admin-session-token")?.value;
    if (
      hasValidCookie(adminToken) &&
      !pathname.startsWith("/godmode/setup-password")
    ) {
      const callbackUrl = request.nextUrl.searchParams.get("callbackUrl");
      const redirectTo = callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/admin";
      return NextResponse.redirect(new URL(redirectTo, request.url));
    }
    return NextResponse.next();
  }

  // Protected customer routes — check customer session cookie
  if (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/bookings") ||
    pathname.startsWith("/profile")
  ) {
    const customerToken =
      request.cookies.get("authjs.session-token")?.value ||
      request.cookies.get("__Secure-authjs.session-token")?.value;
    if (!hasValidCookie(customerToken)) {
      return NextResponse.redirect(new URL("/", request.url));
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
