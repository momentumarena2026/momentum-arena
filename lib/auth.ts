import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import authConfig from "@/lib/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db) as never,
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,
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
  },
  providers: [
    Credentials({
      id: "otp",
      name: "OTP",
      credentials: {
        identifier: { label: "Email or Phone", type: "text" },
        type: { label: "Type", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.type) return null;

        const identifier = credentials.identifier as string;
        const type = credentials.type as string;

        let user;

        if (type === "email") {
          user = await db.user.findUnique({ where: { email: identifier } });
        } else {
          user = await db.user.findUnique({ where: { phone: identifier } });
        }

        if (!user) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone ?? undefined,
          image: user.image,
        };
      },
    }),
  ],
});
