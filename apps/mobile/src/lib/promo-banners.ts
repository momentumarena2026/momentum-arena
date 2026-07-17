import { api } from "./api";

/** Live promotion banner for one screen — served by
 *  /api/mobile/promo-banners (public; image URLs pre-absolutised). */
export interface PromoBannerItem {
  id: string;
  title: string;
  imageUrl: string;
  aspectRatio: number;
  linkUrl: string | null;
}

export type PromoScreen =
  | "HOME_TOP"
  | "HOME_PROMO"
  | "BOOK_SPORT"
  | "SLOT_SELECTION"
  | "CAFE"
  | "SHOP"
  | "PASSES";

export const promoBannersApi = {
  forScreen: (screen: PromoScreen, sportSlug?: string) => {
    const q = new URLSearchParams({ screen });
    if (sportSlug) q.set("sport", sportSlug);
    return api.get<{ banners: PromoBannerItem[] }>(
      `/api/mobile/promo-banners?${q.toString()}`,
    );
  },
};
