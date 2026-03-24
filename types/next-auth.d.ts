import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      userType: "customer" | "admin";
      // Customer fields
      phone?: string;
      needsPasswordSetup?: boolean;
      // Admin fields
      adminRole?: "SUPERADMIN" | "ADMIN";
      permissions?: string[];
    } & DefaultSession["user"];
  }

  interface User {
    userType?: "customer" | "admin";
    phone?: string;
    needsPasswordSetup?: boolean;
    adminRole?: "SUPERADMIN" | "ADMIN";
    permissions?: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    userType: "customer" | "admin";
    phone?: string;
    needsPasswordSetup?: boolean;
    adminRole?: "SUPERADMIN" | "ADMIN";
    permissions?: string[];
  }
}
