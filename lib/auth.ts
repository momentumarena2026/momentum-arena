import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import authConfig from "@/lib/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db) as never,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
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
    async signIn({ user, account }) {
      // For Google sign-in, mark email as verified
      if (account?.provider === "google" && user.email) {
        try {
          const dbUser = await db.user.findUnique({
            where: { email: user.email },
            select: { id: true, emailVerified: true },
          });
          if (dbUser && !dbUser.emailVerified) {
            await db.user.update({
              where: { id: dbUser.id },
              data: { emailVerified: new Date() },
            });
          }
        } catch {
          // DB error shouldn't block sign-in
        }
      }
      return true;
    },
  },
  providers: [
    // Google OAuth for customers
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        };
      },
    }),

    // Phone OTP login
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
