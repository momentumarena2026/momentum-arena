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
// Shared with push notifications, so a URL that works on a banner works
// on a push too — one list, not two that drift apart.
import { resolveDeepLink, type NavLike } from "../../lib/deep-link";

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
      onPress={() => resolveDeepLink(nav, banner.linkUrl!)}
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
