"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { revalidatePath } from "next/cache";
import type { BannerPlacement } from "@prisma/client";

/**
 * Promotion banners — admin CRUD (web "Web & App Config" section + the
 * mobile admin route, which authenticates via requireMobileAdmin and
 * passes { skipAuth, adminId } like the passes actions do).
 */

const PERMISSION = "MANAGE_PROMO_BANNERS" as const;

export interface PromoBannerCtx {
  skipAuth: true;
  adminId: string;
}

async function gate(ctx?: PromoBannerCtx): Promise<{ id: string }> {
  if (ctx?.skipAuth) return { id: ctx.adminId };
  return requireAdmin(PERMISSION);
}

const VALID_SCREENS: BannerPlacement[] = [
  "HOME_TOP",
  "HOME_PROMO",
  "BOOK_SPORT",
  "SLOT_SELECTION",
  "CAFE",
  "SHOP",
  "PASSES",
];

export interface PromoBannerInput {
  title: string;
  imageUrl: string;
  appImageUrl?: string | null;
  aspectRatio?: number;
  linkUrl?: string | null;
  screens: string[];
  couponId?: string | null;
  /** ISO datetimes (or null) — exact go-live / retire moments. */
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

type Normalised =
  | { error: string; data?: never }
  | {
      error?: never;
      data: {
        title: string;
        imageUrl: string;
        appImageUrl: string | null;
        aspectRatio: number;
        linkUrl: string | null;
        placement: BannerPlacement[];
        couponId: string | null;
        startsAt: Date | null;
        endsAt: Date | null;
        isActive: boolean;
        sortOrder: number;
      };
    };

function normalise(input: PromoBannerInput): Normalised {
  const title = input.title?.trim();
  if (!title) return { error: "Title is required." };
  if (!input.imageUrl?.trim()) return { error: "Banner image is required." };
  const screens = (input.screens ?? []).filter((s) =>
    VALID_SCREENS.includes(s as BannerPlacement),
  ) as BannerPlacement[];
  if (screens.length === 0) {
    return { error: "Pick at least one screen to show the banner on." };
  }
  const aspectRatio =
    Number.isFinite(input.aspectRatio) && (input.aspectRatio as number) > 0.1
      ? (input.aspectRatio as number)
      : 3;
  const parseDate = (v?: string | null) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const startsAt = parseDate(input.startsAt);
  const endsAt = parseDate(input.endsAt);
  if (startsAt && endsAt && endsAt <= startsAt) {
    return { error: "End time must be after the start time." };
  }
  return {
    data: {
      title,
      imageUrl: input.imageUrl.trim(),
      appImageUrl: input.appImageUrl?.trim() || null,
      aspectRatio,
      linkUrl: input.linkUrl?.trim() || null,
      placement: screens,
      couponId: input.couponId || null,
      startsAt,
      endsAt,
      isActive: input.isActive ?? true,
      sortOrder: Number.isInteger(input.sortOrder) ? (input.sortOrder as number) : 0,
    },
  };
}

/** All banners + the lightweight coupon list the form's picker needs. */
export async function getPromoBannersAdminData(ctx?: PromoBannerCtx) {
  await gate(ctx);
  const now = new Date();
  const [banners, coupons] = await Promise.all([
    db.promoBanner.findMany({
      include: {
        coupon: {
          select: { id: true, code: true, isActive: true, validUntil: true },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
    db.coupon.findMany({
      where: { isActive: true, validUntil: { gte: now } },
      select: { id: true, code: true, validUntil: true },
      orderBy: { code: "asc" },
    }),
  ]);
  return {
    banners: banners.map((b) => ({
      id: b.id,
      title: b.title,
      imageUrl: b.imageUrl,
      appImageUrl: b.appImageUrl,
      aspectRatio: b.aspectRatio,
      linkUrl: b.linkUrl,
      screens: b.placement as string[],
      couponId: b.couponId,
      couponCode: b.coupon?.code ?? null,
      couponLive:
        !!b.coupon &&
        b.coupon.isActive &&
        b.coupon.validUntil >= now,
      startsAt: b.startsAt?.toISOString() ?? null,
      endsAt: b.endsAt?.toISOString() ?? null,
      isActive: b.isActive,
      sortOrder: b.sortOrder,
    })),
    coupons: coupons.map((c) => ({
      id: c.id,
      code: c.code,
      validUntil: c.validUntil.toISOString(),
    })),
  };
}

export async function createPromoBanner(
  input: PromoBannerInput,
  ctx?: PromoBannerCtx,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const admin = await gate(ctx);
  const parsed = normalise(input);
  if (parsed.error !== undefined) return { ok: false, error: parsed.error };
  const created = await db.promoBanner.create({
    data: { ...parsed.data, createdBy: admin.id },
    select: { id: true },
  });
  revalidateBannerSurfaces();
  return { ok: true, id: created.id };
}

export async function updatePromoBanner(
  id: string,
  input: PromoBannerInput,
  ctx?: PromoBannerCtx,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await gate(ctx);
  const parsed = normalise(input);
  if (parsed.error !== undefined) return { ok: false, error: parsed.error };
  await db.promoBanner.update({ where: { id }, data: parsed.data });
  revalidateBannerSurfaces();
  return { ok: true };
}

export async function togglePromoBanner(
  id: string,
  isActive: boolean,
  ctx?: PromoBannerCtx,
): Promise<{ ok: true }> {
  await gate(ctx);
  await db.promoBanner.update({ where: { id }, data: { isActive } });
  revalidateBannerSurfaces();
  return { ok: true };
}

export async function deletePromoBanner(
  id: string,
  ctx?: PromoBannerCtx,
): Promise<{ ok: true }> {
  await gate(ctx);
  await db.promoBanner.delete({ where: { id } }).catch(() => {});
  revalidateBannerSurfaces();
  return { ok: true };
}

function revalidateBannerSurfaces() {
  try {
    for (const p of ["/", "/book", "/cafe", "/shop", "/passes", "/admin/config/promo-banners"]) {
      revalidatePath(p);
    }
  } catch {
    // write already landed; revalidation is best-effort
  }
}
