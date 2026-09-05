"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { revalidatePath } from "next/cache";
import type { BannerPlacement, Sport } from "@prisma/client";

/**
 * Promotion banners — admin CRUD (web "Web & App Config" section + the
 * mobile admin route). Both surfaces are authenticated by `gate()` below:
 * requireAdmin resolves the caller from the web cookie session or the
 * mobile Bearer JWT, so no caller-supplied auth context exists.
 */

const PERMISSION = "MANAGE_PROMO_BANNERS" as const;

async function gate(): Promise<{ id: string }> {
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
  /** SLOT_SELECTION refinement — which sports' slot pages (empty = all). */
  slotSports?: string[];
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
        slotSports: Sport[];
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
      slotSports: (input.slotSports ?? []).filter((s): s is Sport =>
        ["CRICKET", "FOOTBALL", "PICKLEBALL"].includes(s),
      ),
      couponId: input.couponId || null,
      startsAt,
      endsAt,
      isActive: input.isActive ?? true,
      sortOrder: Number.isInteger(input.sortOrder) ? (input.sortOrder as number) : 0,
    },
  };
}

/** All banners + the lightweight coupon list the form's picker needs. */
export async function getPromoBannersAdminData() {
  await gate();
  const now = new Date();
  const [banners, coupons] = await Promise.all([
    db.promoBanner.findMany({
      include: {
        coupon: {
          select: {
            id: true,
            code: true,
            isActive: true,
            validFrom: true,
            validUntil: true,
          },
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
  // Same rules getLivePromoBanners applies — surfaced as a status +
  // human reason so "why isn't my banner showing?" is answered in the
  // admin list instead of by support.
  const fmt = (d: Date) =>
    d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  function liveStatus(b: (typeof banners)[number]): {
    live: boolean;
    reason: string | null;
  } {
    if (!b.isActive) return { live: false, reason: "Turned off" };
    if (b.startsAt && b.startsAt > now) {
      return { live: false, reason: `Scheduled — goes live ${fmt(b.startsAt)}` };
    }
    if (b.endsAt && b.endsAt < now) {
      return { live: false, reason: `Ended ${fmt(b.endsAt)}` };
    }
    if (b.coupon) {
      if (!b.coupon.isActive) {
        return { live: false, reason: `Coupon ${b.coupon.code} is disabled` };
      }
      if (b.coupon.validFrom > now) {
        return {
          live: false,
          reason: `Coupon ${b.coupon.code} starts ${fmt(b.coupon.validFrom)}`,
        };
      }
      if (b.coupon.validUntil < now) {
        return { live: false, reason: `Coupon ${b.coupon.code} expired` };
      }
    }
    return { live: true, reason: null };
  }

  return {
    banners: banners.map((b) => {
      const status = liveStatus(b);
      return {
        id: b.id,
        title: b.title,
        imageUrl: b.imageUrl,
        appImageUrl: b.appImageUrl,
        aspectRatio: b.aspectRatio,
        linkUrl: b.linkUrl,
        screens: b.placement as string[],
        slotSports: b.slotSports as string[],
        couponId: b.couponId,
        couponCode: b.coupon?.code ?? null,
        couponLive:
          !!b.coupon &&
          b.coupon.isActive &&
          b.coupon.validFrom <= now &&
          b.coupon.validUntil >= now,
        startsAt: b.startsAt?.toISOString() ?? null,
        endsAt: b.endsAt?.toISOString() ?? null,
        isActive: b.isActive,
        sortOrder: b.sortOrder,
        live: status.live,
        hiddenReason: status.reason,
      };
    }),
    coupons: coupons.map((c) => ({
      id: c.id,
      code: c.code,
      validUntil: c.validUntil.toISOString(),
    })),
  };
}

export async function createPromoBanner(
  input: PromoBannerInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const admin = await gate();
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  await gate();
  const parsed = normalise(input);
  if (parsed.error !== undefined) return { ok: false, error: parsed.error };
  await db.promoBanner.update({ where: { id }, data: parsed.data });
  revalidateBannerSurfaces();
  return { ok: true };
}

export async function togglePromoBanner(
  id: string,
  isActive: boolean,
): Promise<{ ok: true }> {
  await gate();
  await db.promoBanner.update({ where: { id }, data: { isActive } });
  revalidateBannerSurfaces();
  return { ok: true };
}

export async function deletePromoBanner(id: string): Promise<{ ok: true }> {
  await gate();
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

/**
 * Persist the order an admin dragged the banners into.
 *
 * The whole visible list is rewritten rather than the one item that
 * moved: a single index is ambiguous the moment two people reorder at
 * once, and a full list is idempotent. Positions are the array index, so
 * they stay dense and always match what was on screen.
 *
 * Hidden banners keep positions too. A banner is usually hidden because
 * it is between runs, and losing its place means rebuilding the order
 * every time one is switched back on.
 */
export async function reorderPromoBanners(
  ids: string[],
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin("MANAGE_PROMO_BANNERS");
  if (ids.length === 0) return { success: true };
  try {
    await db.$transaction(
      ids.map((id, i) =>
        db.promoBanner.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
  } catch {
    return { success: false, error: "Couldn't save the new order." };
  }
  revalidatePath("/admin/config/promo-banners");
  return { success: true };
}
