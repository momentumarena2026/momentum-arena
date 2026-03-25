import type { NextAuthConfig } from "next-auth";

export default {
  providers: [],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.userType = (user as { userType?: string }).userType || "customer";
        token.phone = (user as { phone?: string }).phone;
        token.needsPasswordSetup = (user as { needsPasswordSetup?: boolean }).needsPasswordSetup;
        token.adminRole = (user as { adminRole?: string }).adminRole;
        token.permissions = (user as { permissions?: string[] }).permissions;
      }
      return token;
    },
    session({ session, token }) {
      if (token) {
        (session.user as unknown as Record<string, unknown>).id = token.id;
        (session.user as unknown as Record<string, unknown>).userType = token.userType;
        (session.user as unknown as Record<string, unknown>).phone = token.phone;
        (session.user as unknown as Record<string, unknown>).needsPasswordSetup = token.needsPasswordSetup;
        (session.user as unknown as Record<string, unknown>).adminRole = token.adminRole;
        (session.user as unknown as Record<string, unknown>).permissions = token.permissions;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const userType = (auth as { user?: { userType?: string } })?.user
        ?.userType;
      const { pathname } = nextUrl;

      // Admin dashboard routes — require admin session
      if (pathname.startsWith("/admin")) {
        if (!isLoggedIn) return false;
        if (userType !== "admin")
          return Response.redirect(new URL("/dashboard", nextUrl));
        return true;
      }

      // Godmode login page — allow unauthenticated or non-admin users
      if (pathname.startsWith("/godmode")) {
        if (isLoggedIn && userType === "admin") {
          if (pathname.startsWith("/godmode/setup-password")) return true;
          return Response.redirect(new URL("/admin", nextUrl));
        }
        return true;
      }

      // Protected customer routes
      if (
        pathname.startsWith("/dashboard") ||
        pathname.startsWith("/book") ||
        pathname.startsWith("/bookings") ||
        pathname.startsWith("/profile")
      ) {
        return isLoggedIn;
      }

      // Auth pages — redirect away if already logged in as customer
      if (pathname === "/login") {
        if (isLoggedIn && userType === "customer")
          return Response.redirect(new URL("/dashboard", nextUrl));
      }

      return true;
    },
  },
} satisfies NextAuthConfig;
