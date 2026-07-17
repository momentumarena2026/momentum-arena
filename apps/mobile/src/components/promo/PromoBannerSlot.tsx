import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { env } from "../../config/env";
import { colors, spacing } from "../../theme";
import {
  promoBannersApi,
  type PromoBannerItem,
  type PromoScreen,
} from "../../lib/promo-banners";

/**
 * Admin-managed promotion banners for one screen (Web & App Config →
 * Promotion Banners). Renders nothing while loading / when no banner
 * is live, so screens mount it unconditionally.
 *
 * Tap → the banner's web URL is resolved to the matching native
 * surface (/book/<sport> → Sports flow, /cafe → Cafe tab, ...);
 * anything unrecognised opens in the browser. Unknown route names
 * bubble up the navigator tree, so navigate("Main", …) works from any
 * screen.
 */

type NavLike = { navigate: (name: string, params?: object) => void };

const SPORT_BY_SLUG: Record<string, string> = {
  cricket: "CRICKET",
  football: "FOOTBALL",
  pickleball: "PICKLEBALL",
};

function resolveLink(nav: NavLike, linkUrl: string) {
  let path = linkUrl;
  try {
    if (/^https?:\/\//.test(linkUrl)) path = new URL(linkUrl).pathname;
  } catch {
    path = linkUrl;
  }

  const sportMatch = path.match(/^\/book\/(cricket|football|pickleball)/);
  if (sportMatch) {
    nav.navigate("Main", {
      screen: "Sports",
      params: {
        screen: "BookCourt",
        params: { sport: SPORT_BY_SLUG[sportMatch[1]] },
      },
    });
    return;
  }
  if (path.startsWith("/book")) {
    nav.navigate("Main", { screen: "Sports", params: { screen: "BookSport" } });
    return;
  }
  if (path.startsWith("/cafe")) {
    nav.navigate("Main", { screen: "Cafe" });
    return;
  }
  if (path.startsWith("/shop")) {
    nav.navigate("Main", { screen: "Shop" });
    return;
  }
  if (path.startsWith("/passes") || path.startsWith("/my-passes")) {
    nav.navigate("Main", { screen: "Passes" });
    return;
  }
  if (path.startsWith("/coupons")) {
    nav.navigate("Main", { screen: "Account", params: { screen: "Coupons" } });
    return;
  }
  // Unrecognised → browser (absolutise site-relative paths).
  const url = /^https?:\/\//.test(linkUrl) ? linkUrl : `${env.apiUrl}${linkUrl}`;
  Linking.openURL(url).catch(() => {});
}

function Banner({ banner, nav }: { banner: PromoBannerItem; nav: NavLike }) {
  // Layout starts from the stored ratio, then self-corrects to the
  // image's REAL dimensions on load — a mismatched stored ratio (e.g.
  // the default on URL-pasted banners) must never crop the artwork.
  const [ratio, setRatio] = useState(banner.aspectRatio || 3);
  const body = (
    <Image
      source={{ uri: banner.imageUrl }}
      style={[styles.image, { aspectRatio: ratio }]}
      resizeMode="cover"
      accessibilityLabel={banner.title}
      onLoad={(e) => {
        const s = e.nativeEvent?.source;
        if (s?.width && s?.height) setRatio(s.width / s.height);
      }}
    />
  );
  if (!banner.linkUrl) return <View style={styles.frame}>{body}</View>;
  return (
    <Pressable
      onPress={() => resolveLink(nav, banner.linkUrl!)}
      style={({ pressed }) => [styles.frame, pressed && { opacity: 0.85 }]}
    >
      {body}
    </Pressable>
  );
}

export function PromoBannerSlot({
  screen,
  sportSlug,
  style,
}: {
  screen: PromoScreen;
  /** Slot screens pass the sport so sport-specific banners only show
   *  on their own sport (mirrors the web filter). */
  sportSlug?: string;
  style?: object;
}) {
  const navigation = useNavigation() as unknown as NavLike;
  const { data } = useQuery({
    queryKey: ["promo-banners", screen, sportSlug ?? null],
    queryFn: () => promoBannersApi.forScreen(screen, sportSlug),
    staleTime: 5 * 60_000,
  });

  const banners = data?.banners ?? [];
  if (banners.length === 0) return null;

  return (
    <View style={[styles.stack, style]}>
      {banners.map((b) => (
        <Banner key={b.id} banner={b} nav={navigation} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing["3"],
  },
  frame: {
    overflow: "hidden",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.zinc800,
  },
  image: {
    width: "100%",
    height: undefined,
  },
});
