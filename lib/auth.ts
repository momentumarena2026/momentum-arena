import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import authConfig from "@/lib/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db) as never,
  session: {
    strategy: "jwt",
    maxAge: 90 * 24 * 60 * 60, // 90 days
  },
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id as string;
        token.userType = "customer";
        token.phone = user.phone;
      }

      // Allow session updates
      if (trigger === "update") {
        try {
          const dbUser = await db.user.findUnique({
            where: { id: token.id as string },
            select: { phone: true, name: true },
          });
          if (dbUser) {
            token.phone = dbUser.phone ?? undefined;
          }
        } catch {
          // DB unavailable, keep existing token value
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.userType = "customer";
        session.user.phone = token.phone as string | undefined;
      }
      return session;
    },
    async signIn() {
      return true;
    },
  },
  providers: [
    // Phone OTP login (Google sign-in was removed — unused).
    Credentials({
      id: "otp",
      name: "OTP",
      credentials: {
        phone: { label: "Phone", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.phone) return null;

        const phone = credentials.phone as string;

        const user = await db.user.findUnique({ where: { phone } });
        if (!user) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          userType: "customer" as const,
          phone: user.phone ?? undefined,
        };
      },
    }),

    // Admin auth is handled by separate NextAuth instance at /api/admin-auth
    // See lib/admin-auth-session.ts
  ],
});
