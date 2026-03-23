import type { NextAuthConfig } from "next-auth";

export default {
  providers: [],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: string }).role;
        token.phone = (user as { phone?: string }).phone;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        (session.user as { id: string }).id = token.id as string;
        (session.user as { role: string }).role = token.role as string;
        (session.user as { phone?: string }).phone = token.phone as string;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isAdmin = auth?.user?.role === "ADMIN";
      const { pathname } = nextUrl;

      // Protected routes
      if (
        pathname.startsWith("/dashboard") ||
        pathname.startsWith("/book") ||
        pathname.startsWith("/bookings") ||
        pathname.startsWith("/profile")
      ) {
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
