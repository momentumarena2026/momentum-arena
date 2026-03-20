import type { NextAuthConfig } from "next-auth";

export default {
  providers: [],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isAdmin = auth?.user?.role === "ADMIN";
      const { pathname } = nextUrl;

      // Protected dashboard routes
      if (pathname.startsWith("/dashboard")) {
        return isLoggedIn;
      }

      // Admin routes
      if (pathname.startsWith("/admin")) {
        if (!isLoggedIn) return false;
        if (!isAdmin)
          return Response.redirect(new URL("/dashboard", nextUrl));
        return true;
      }

      // Auth pages — redirect away if already logged in
      if (pathname === "/login") {
        if (isLoggedIn)
          return Response.redirect(new URL("/dashboard", nextUrl));
      }

      return true;
    },
  },
} satisfies NextAuthConfig;
