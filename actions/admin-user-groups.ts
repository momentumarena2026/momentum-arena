"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin as requireAdminBase } from "@/lib/admin-auth";

/**
 * Admin-curated user groups + per-coupon user/group assignments.
 *
 * These sit alongside the auto-computed `UserGroupType` buckets
 * (FIRST_TIME, PREMIUM_PLAYER, etc) on the Coupon model. The auto
 * groups answer "does this user *qualify* by behaviour?"; the
 * admin groups answer "is this user explicitly *invited*?". Coupon
 * validation OR's all eligibility paths together — if any one
 * matches the user is allowed, otherwise blocked.
 *
 * Permission model: `MANAGE_DISCOUNTS` is the same admin scope used
 * by the existing coupon CRUD, so anyone who can edit a coupon can
 * also manage the groups that target it.
 */
async function requireAdmin() {
  const user = await requireAdminBase("MANAGE_DISCOUNTS");
  return user.id;
}

const groupSchema = z.object({
  name: z.string().min(1, "Group name is required").max(80),
  description: z.string().max(500).optional().or(z.literal("")),
});

// ─── Group CRUD ──────────────────────────────────────────────────

export async function listUserGroups(filters?: { search?: string }) {
  await requireAdmin();

  const where: Record<string, unknown> = { deletedAt: null };
  if (filters?.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { description: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const groups = await db.userGroup.findMany({
    where,
    include: {
      _count: { select: { members: true, coupons: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    memberCount: g._count.members,
    couponCount: g._count.coupons,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  }));
}

export async function getUserGroupWithMembers(groupId: string) {
  await requireAdmin();

  const group = await db.userGroup.findFirst({
    where: { id: groupId, deletedAt: null },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true },
          },
        },
        orderBy: { addedAt: "desc" },
      },
    },
  });
  if (!group) return null;

  return {
    id: group.id,
    name: group.name,
    description: group.description,
    createdAt: group.createdAt.toISOString(),
    members: group.members.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      phone: m.user.phone,
      addedAt: m.addedAt.toISOString(),
    })),
  };
}

export async function createUserGroup(data: {
  name: string;
  description?: string;
  initialUserIds?: string[];
}) {
  const adminId = await requireAdmin();

  const parsed = groupSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message ?? "Invalid data",
    };
  }

  const ids = data.initialUserIds ?? [];

  try {
    const group = await db.userGroup.create({
      data: {
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() || null,
        createdBy: adminId,
        ...(ids.length
          ? {
              members: {
                createMany: {
                  // dedupe — the unique index would catch this anyway
                  // but skipping the round-trip is cheaper
                  data: Array.from(new Set(ids)).map((userId) => ({ userId })),
                  skipDuplicates: true,
                },
              },
            }
          : {}),
      },
    });
    return { success: true as const, groupId: group.id };
  } catch (error) {
    console.error("Failed to create user group:", error);
    return { success: false as const, error: "Failed to create group" };
  }
}

export async function updateUserGroup(
  groupId: string,
  data: { name?: string; description?: string | null },
) {
  await requireAdmin();

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) {
    const parsed = groupSchema.shape.name.safeParse(data.name);
    if (!parsed.success) {
      return {
        success: false as const,
        error: parsed.error.issues[0]?.message ?? "Invalid name",
      };
    }
    updateData.name = parsed.data.trim();
  }
  if (data.description !== undefined) {
    updateData.description = data.description?.trim() || null;
  }

  try {
    await db.userGroup.update({ where: { id: groupId }, data: updateData });
    return { success: true as const };
  } catch (error) {
    console.error("Failed to update user group:", error);
    return { success: false as const, error: "Failed to update group" };
  }
}

export async function deleteUserGroup(groupId: string) {
  await requireAdmin();

  try {
    // Soft delete — coupons that target this group will continue to
    // function (validation queries the live `members` relation but
    // a deleted group naturally has zero matching members) and we
    // keep the audit trail. If the admin really wants the row gone,
    // they can clear it from the DB directly.
    await db.userGroup.update({
      where: { id: groupId },
      data: { deletedAt: new Date() },
    });
    return { success: true as const };
  } catch (error) {
    console.error("Failed to delete user group:", error);
    return { success: false as const, error: "Failed to delete group" };
  }
}

// ─── Membership management ───────────────────────────────────────

export async function addUsersToGroup(groupId: string, userIds: string[]) {
  await requireAdmin();
  if (!userIds.length) return { success: true as const, added: 0 };

  try {
    const result = await db.userGroupMember.createMany({
      data: Array.from(new Set(userIds)).map((userId) => ({
        groupId,
        userId,
      })),
      skipDuplicates: true,
    });
    return { success: true as const, added: result.count };
  } catch (error) {
    console.error("Failed to add users to group:", error);
    return { success: false as const, error: "Failed to add users" };
  }
}

export async function removeUserFromGroup(groupId: string, userId: string) {
  await requireAdmin();

  try {
    await db.userGroupMember.deleteMany({ where: { groupId, userId } });
    return { success: true as const };
  } catch (error) {
    console.error("Failed to remove user from group:", error);
    return { success: false as const, error: "Failed to remove user" };
  }
}

// ─── User search (powers the per-coupon and per-group pickers) ────

/**
 * Lightweight user lookup for the admin pickers. Returns at most
 * `limit` (default 20) non-deleted users matching `query` against
 * name, email, or phone.
 *
 * Distinct from `getAdminUsers` (which paginates the full users
 * table for the Users admin page) — this is shaped for autocomplete:
 * smaller payload, lower limit, no role filter.
 */
export async function searchUsersForPicker(query: string, limit = 20) {
  await requireAdmin();

  const trimmed = query.trim();
  if (trimmed.length === 0) return [] as Array<{
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  }>;

  const users = await db.user.findMany({
    where: {
      deletedAt: null,
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        { email: { contains: trimmed, mode: "insensitive" } },
        { phone: { contains: trimmed } },
      ],
    },
    select: { id: true, name: true, email: true, phone: true },
    take: Math.min(limit, 50),
    orderBy: { createdAt: "desc" },
  });

  return users;
}

/**
 * Look up a batch of users by id — used to render the chip list of
 * a coupon's currently-assigned users without loading the full table.
 */
export async function getUsersByIds(userIds: string[]) {
  await requireAdmin();
  if (userIds.length === 0) return [];

  return db.user.findMany({
    where: { id: { in: userIds }, deletedAt: null },
    select: { id: true, name: true, email: true, phone: true },
  });
}
