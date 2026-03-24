import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
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
        token.userType = user.userType || "customer";
        token.phone = user.phone;
        token.adminRole = user.adminRole;
        token.permissions = user.permissions;

        // Always check DB for needsPasswordSetup (handles Google, OTP, and password logins)
        if (token.userType === "customer") {
          const dbUser = await db.user.findUnique({
            where: { id: user.id as string },
            select: { passwordHash: true },
          });
          token.needsPasswordSetup = !dbUser?.passwordHash;
        } else {
          token.needsPasswordSetup = false;
        }
      }

      // Allow session updates (e.g., after setting password)
      if (trigger === "update") {
        const dbUser = await db.user.findUnique({
          where: { id: token.id },
          select: { passwordHash: true },
        });
        if (dbUser) {
          token.needsPasswordSetup = !dbUser.passwordHash;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.userType = token.userType;
        session.user.phone = token.phone;
        session.user.needsPasswordSetup = token.needsPasswordSetup;
        session.user.adminRole = token.adminRole;
        session.user.permissions = token.permissions;
      }
      return session;
    },
    async signIn({ user, account }) {
      // For Google sign-in, mark email as verified and check password setup
      if (account?.provider === "google" && user.email) {
        const dbUser = await db.user.findUnique({
          where: { email: user.email },
          select: { id: true, emailVerified: true, passwordHash: true },
        });
        if (dbUser && !dbUser.emailVerified) {
          await db.user.update({
            where: { id: dbUser.id },
            data: { emailVerified: new Date() },
          });
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
        // Only return fields that exist in the User model
        // userType and needsPasswordSetup are set in the JWT callback
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        };
      },
    }),

    // Customer OTP login
    Credentials({
      id: "otp",
      name: "OTP",
      credentials: {
        identifier: { label: "Email", type: "text" },
        type: { label: "Type", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.type) return null;

        const identifier = credentials.identifier as string;
        const type = credentials.type as string;

        // Phone OTP disabled for now
        // if (type === "phone") {
        //   user = await db.user.findUnique({ where: { phone: identifier } });
        // }

        if (type !== "email") return null;

        const user = await db.user.findUnique({ where: { email: identifier } });
        if (!user) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          userType: "customer" as const,
          phone: user.phone ?? undefined,
          needsPasswordSetup: !user.passwordHash,
        };
      },
    }),

    // Customer password login
    Credentials({
      id: "customer-password",
      name: "Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email as string;
        const password = credentials.password as string;

        const user = await db.user.findUnique({ where: { email } });
        if (!user) return null;

        // User hasn't set a password yet
        if (!user.passwordHash) return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          userType: "customer" as const,
          phone: user.phone ?? undefined,
          needsPasswordSetup: false,
        };
      },
    }),

    // Admin credentials login
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
          userType: "admin" as const,
          adminRole: admin.role,
          permissions: admin.permissions,
        };
      },
    }),
  ],
});
