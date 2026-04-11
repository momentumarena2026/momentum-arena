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
        token.userType = "customer";
        token.phone = (user as { phone?: string }).phone;
      }
      return token;
    },
    session({ session, token }) {
      if (token) {
        (session.user as unknown as Record<string, unknown>).id = token.id;
        (session.user as unknown as Record<string, unknown>).userType = "customer";
        (session.user as unknown as Record<string, unknown>).phone = token.phone;
      }
      return session;
    },
    authorized() {
      // Route protection is handled by middleware.ts directly
      return true;
    },
  },
} satisfies NextAuthConfig;
