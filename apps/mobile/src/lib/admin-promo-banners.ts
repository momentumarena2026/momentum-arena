import { request } from "./admin-api";

/**
 * Mobile admin promo-banners client — mirrors the web manager via
 * /api/mobile/admin/promo-banners. Image FILE uploads live on the web
 * admin; the app edits every field (and can paste an image URL).
 */

export const PROMO_SCREEN_OPTIONS: { value: string; label: string }[] = [
  { value: "HOME_TOP", label: "Home — top (above logo)" },
  { value: "HOME_PROMO", label: "Home — promo slot" },
  { value: "BOOK_SPORT", label: "Book — choose sport" },
  { value: "SLOT_SELECTION", label: "Slot selection" },
  { value: "CAFE", label: "Cafe" },
  { value: "SHOP", label: "Shop" },
  { value: "PASSES", label: "Passes storefront" },
];

export interface AdminPromoBanner {
  id: string;
  title: string;
  imageUrl: string;
  appImageUrl: string | null;
  aspectRatio: number;
  linkUrl: string | null;
  screens: string[];
  couponId: string | null;
  couponCode: string | null;
  couponLive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface PromoBannerInput {
  title: string;
  imageUrl: string;
  appImageUrl?: string | null;
  aspectRatio?: number;
  linkUrl?: string | null;
  screens: string[];
  couponId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

type OkResult = { ok: boolean; error?: string };

const BASE = "/api/mobile/admin/promo-banners";

export const adminPromoBannersApi = {
  data: () =>
    request<{
      banners: AdminPromoBanner[];
      coupons: { id: string; code: string; validUntil: string }[];
    }>(BASE, { method: "GET" }),
  create: (banner: PromoBannerInput) =>
    request<OkResult>(BASE, { method: "POST", body: { action: "create", banner } }),
  update: (id: string, banner: PromoBannerInput) =>
    request<OkResult>(BASE, { method: "POST", body: { action: "update", id, banner } }),
  toggle: (id: string, isActive: boolean) =>
    request<OkResult>(BASE, { method: "POST", body: { action: "toggle", id, isActive } }),
  remove: (id: string) =>
    request<OkResult>(BASE, { method: "POST", body: { action: "delete", id } }),
};
