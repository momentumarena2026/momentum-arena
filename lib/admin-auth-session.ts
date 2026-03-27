import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

/**
 * Separate NextAuth instance for admin authentication.
 * Uses a different cookie name so admin and customer sessions
 * can coexist independently in the same browser.
 */
export const {
  handlers: adminHandlers,
  auth: adminAuth,
  signIn: adminSignIn,
  signOut: adminSignOut,
} = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  cookies: {
    sessionToken: {
      name: "admin-session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  pages: {
    signIn: "/godmode",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.userType = "admin";
        token.adminRole = (user as { adminRole?: string }).adminRole;
        token.permissions = (user as { permissions?: string[] }).permissions;
        token.username = (user as { name?: string }).name;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        (session.user as unknown as Record<string, unknown>).userType = "admin";
        (session.user as unknown as Record<string, unknown>).adminRole = token.adminRole;
        (session.user as unknown as Record<string, unknown>).permissions = token.permissions;
        session.user.name = token.username as string;
      }
      return session;
    },
  },
  providers: [
    Credentials({
      id: "admin-credentials",
      name: "Admin Login",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        const username = credentials.username as string;
        const password = credentials.password as string;

        const admin = await db.adminUser.findUnique({ where: { username } });
        if (!admin) return null;

        const valid = await verifyPassword(password, admin.passwordHash);
        if (!valid) return null;

        // Update last login
        await db.adminUser.update({
          where: { id: admin.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: admin.id,
          name: admin.username,
          email: admin.email,
          adminRole: admin.role,
          permissions: admin.permissions,
        } as never;
      },
    }),
  ],
});
