import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Admin routes — check admin session cookie
  if (pathname.startsWith("/admin")) {
    const adminToken = request.cookies.get("admin-session-token");
    if (!adminToken) {
      return NextResponse.redirect(new URL("/godmode", request.url));
    }
    return NextResponse.next();
  }

  // Godmode login page — if admin already logged in, redirect to admin
  if (pathname.startsWith("/godmode")) {
    const adminToken = request.cookies.get("admin-session-token");
    if (adminToken && !pathname.startsWith("/godmode/setup-password")) {
      return NextResponse.redirect(new URL("/admin", request.url));
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
      request.cookies.get("authjs.session-token") ||
      request.cookies.get("__Secure-authjs.session-token");
    if (!customerToken) {
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
