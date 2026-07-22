"use server";

import { z } from "zod";
import { AdminRole } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { requireSuperadmin } from "@/lib/admin-auth";
import { ALL_PERMISSIONS, SUPERADMIN_ONLY_PERMISSIONS } from "@/lib/permissions";

/**
 * Mobile-facing admin-account management (db.adminUser). SUPERADMIN only.
 *
 * This is a sibling to the web invite-email flow in actions/admin-auth.ts:
 * the mobile surface has no e-mail capture/invite-link experience, so these
 * actions take a password directly and write a usable account in one step.
 * They share the same authorization rule (requireSuperadmin) and the same
 * SUPERADMIN_ONLY_PERMISSIONS filtering, but accept plain JSON args (not
 * FormData) so the mobile route can call them directly. requireSuperadmin
 * resolves the caller from either the web cookie session or the mobile bearer
 * token, so there is no auth-skipping argument — every export here is a public
 * POST endpoint whose arguments come from the client.
 */

const ROLES = ["ADMIN", "STAFF"] as const;
type CreatableRole = (typeof ROLES)[number];

export interface AdminAccountRow {
  id: string;
  username: string;
  email: string;
  role: AdminRole;
  permissions: string[];
  isDeletable: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  passwordSet: boolean;
}

/** Strip permissions a non-superadmin role may never hold. */
function sanitizePermissions(role: CreatableRole, permissions: string[]) {
  if (role === "STAFF") return [];
  const allowed = new Set<string>(ALL_PERMISSIONS);
  return permissions.filter(
    (p) => allowed.has(p) && !SUPERADMIN_ONLY_PERMISSIONS.includes(p as never),
  );
}

export async function listAdminAccounts(): Promise<AdminAccountRow[]> {
  await requireSuperadmin();
  const admins = await db.adminUser.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      permissions: true,
      isDeletable: true,
      lastLoginAt: true,
      createdAt: true,
      // inviteToken === null means the user has set a real password.
      inviteToken: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return admins.map(({ inviteToken, lastLoginAt, createdAt, ...rest }) => ({
    ...rest,
    lastLoginAt: lastLoginAt ? lastLoginAt.toISOString() : null,
    createdAt: createdAt.toISOString(),
    passwordSet: inviteToken === null,
  }));
}

const CreateSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores",
    ),
  email: z.string().trim().email("Please enter a valid email"),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .regex(/[a-zA-Z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a number")
    .regex(/[^a-zA-Z0-9]/, "Password must contain a special character"),
  role: z.enum(ROLES),
  permissions: z.array(z.string()),
});

export type CreateAdminAccountInput = z.input<typeof CreateSchema>;

export async function createAdminAccount(
  input: CreateAdminAccountInput,
): Promise<AdminAccountRow> {
  await requireSuperadmin();

  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const { username, email, password, role, permissions } = parsed.data;

  const existing = await db.adminUser.findFirst({
    where: { OR: [{ username }, { email }] },
  });
  if (existing) {
    throw new Error(
      existing.username === username
        ? "Username already taken"
        : "Email already in use",
    );
  }

  const passwordHash = await hashPassword(password);
  const created = await db.adminUser.create({
    data: {
      username,
      email,
      passwordHash,
      role: role as AdminRole,
      permissions: sanitizePermissions(role, permissions),
      // Mobile sets a real password up-front, so there is no pending invite.
      inviteToken: null,
      inviteTokenExpiry: null,
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      permissions: true,
      isDeletable: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
  return {
    ...created,
    lastLoginAt: created.lastLoginAt
      ? created.lastLoginAt.toISOString()
      : null,
    createdAt: created.createdAt.toISOString(),
    passwordSet: true,
  };
}

const UpdateSchema = z.object({
  email: z.string().trim().email("Please enter a valid email").optional(),
  role: z.enum(ROLES).optional(),
  permissions: z.array(z.string()).optional(),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .regex(/[a-zA-Z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a number")
    .regex(/[^a-zA-Z0-9]/, "Password must contain a special character")
    .optional(),
});

export type UpdateAdminAccountInput = z.input<typeof UpdateSchema>;

export async function updateAdminAccount(
  id: string,
  input: UpdateAdminAccountInput,
): Promise<AdminAccountRow> {
  await requireSuperadmin();

  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const admin = await db.adminUser.findUnique({ where: { id } });
  if (!admin) throw new Error("Admin account not found");
  if (admin.role === "SUPERADMIN") {
    throw new Error("The superadmin account cannot be edited here");
  }

  const data: {
    email?: string;
    role?: AdminRole;
    permissions?: string[];
    passwordHash?: string;
  } = {};

  if (parsed.data.email && parsed.data.email !== admin.email) {
    const clash = await db.adminUser.findFirst({
      where: { email: parsed.data.email, id: { not: id } },
    });
    if (clash) throw new Error("Email already in use");
    data.email = parsed.data.email;
  }

  // Resolve the effective role to filter permissions against (a role change
  // and a permission change can arrive together).
  const nextRole = (parsed.data.role ?? admin.role) as CreatableRole;
  if (parsed.data.role) data.role = parsed.data.role as AdminRole;
  if (parsed.data.permissions) {
    data.permissions = sanitizePermissions(nextRole, parsed.data.permissions);
  } else if (parsed.data.role === "STAFF") {
    // Demoting to STAFF drops all permissions.
    data.permissions = [];
  }

  if (parsed.data.password) {
    data.passwordHash = await hashPassword(parsed.data.password);
  }

  const updated = await db.adminUser.update({
    where: { id },
    data,
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      permissions: true,
      isDeletable: true,
      lastLoginAt: true,
      createdAt: true,
      inviteToken: true,
    },
  });
  const { inviteToken, lastLoginAt, createdAt, ...rest } = updated;
  return {
    ...rest,
    lastLoginAt: lastLoginAt ? lastLoginAt.toISOString() : null,
    createdAt: createdAt.toISOString(),
    passwordSet: inviteToken === null,
  };
}

export async function deleteAdminAccount(
  id: string,
): Promise<{ success: true }> {
  await requireSuperadmin();
  const admin = await db.adminUser.findUnique({ where: { id } });
  if (!admin) throw new Error("Admin account not found");
  if (admin.role === "SUPERADMIN" || !admin.isDeletable) {
    throw new Error("This account cannot be deleted");
  }
  await db.adminUser.delete({ where: { id } });
  return { success: true };
}
