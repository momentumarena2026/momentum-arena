"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { BannerPlacement } from "@prisma/client";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized");
  }
  return session.user.id;
}

const bannerSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  discountInfo: z.string().optional(),
  placement: z.array(z.enum(["BOOK_PAGE", "SLOT_SELECTION", "CHECKOUT"])).min(1),
  razorpayOfferId: z.string().optional(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
});

export async function createPromoBanner(data: {
  title: string;
  description: string;
  discountInfo?: string;
  placement: BannerPlacement[];
  razorpayOfferId?: string;
  startsAt: string;
  endsAt: string;
}) {
  const adminId = await requireAdmin();

  const parsed = bannerSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid data" };
  }

  await db.promoBanner.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      discountInfo: parsed.data.discountInfo || null,
      placement: parsed.data.placement,
      razorpayOfferId: parsed.data.razorpayOfferId || null,
      startsAt: new Date(parsed.data.startsAt),
      endsAt: new Date(parsed.data.endsAt),
      createdBy: adminId,
    },
  });

  return { success: true };
}

export async function updatePromoBanner(
  id: string,
  data: Partial<{
    title: string;
    description: string;
    discountInfo: string;
    placement: BannerPlacement[];
    razorpayOfferId: string;
    startsAt: string;
    endsAt: string;
    isActive: boolean;
  }>
) {
  await requireAdmin();

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.discountInfo !== undefined) updateData.discountInfo = data.discountInfo;
  if (data.placement !== undefined) updateData.placement = data.placement;
  if (data.razorpayOfferId !== undefined) updateData.razorpayOfferId = data.razorpayOfferId;
  if (data.startsAt !== undefined) updateData.startsAt = new Date(data.startsAt);
  if (data.endsAt !== undefined) updateData.endsAt = new Date(data.endsAt);
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  await db.promoBanner.update({ where: { id }, data: updateData });
  return { success: true };
}

export async function deletePromoBanner(id: string) {
  await requireAdmin();
  await db.promoBanner.delete({ where: { id } });
  return { success: true };
}

export async function getPromoBanners() {
  await requireAdmin();
  return db.promoBanner.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getActiveBanners(placement: BannerPlacement) {
  const now = new Date();
  return db.promoBanner.findMany({
    where: {
      isActive: true,
      placement: { has: placement },
      startsAt: { lte: now },
      endsAt: { gte: now },
    },
    orderBy: { createdAt: "desc" },
  });
}
