import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { festiveApi } from "../../lib/festive";
import { FESTIVE_THEMES, type FestiveThemeId } from "../../lib/festive-themes";
import { Diya, SantaSleigh } from "./FestiveArt";

/**
 * The seasonal skin — the app twin of web's festive layer.
 *
 * ── WHY THIS IS AN OVERLAY AND THE WEB ONE SITS AT z-45 ───────────────
 * React Native has no z-index below the content: every screen here
 * paints an OPAQUE `colors.background`, so anything rendered behind the
 * navigator is simply covered. It sits on top instead, with
 * `pointerEvents="none"` so it can never eat a tap. (Web reaches the
 * same conclusion for the same reason — `<main>` carries `bg-black`.)
 *
 * Mounted once at the app root so every screen wears it, which means it
 * has to stay cheap: one shared animation driver, native-driven
 * transforms only, and nothing that triggers layout.
 *
 * The query is PUBLIC (`auth: false`) so it runs signed out — the
 * landing screen is the first thing a new visitor sees and should be
 * dressed up for them too. See `tests/app-authed-queries.test.ts`.
 */
export function FestiveBackdrop() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const { data } = useQuery({
    queryKey: ["festive-theme"],
    queryFn: festiveApi.get,
    // Matches the server's 5-minute ISR window, so an admin toggling the
    // theme reaches a reopened app promptly without the app polling.
    staleTime: 5 * 60 * 1000,
    // Opts into the foreground refetch bridged in lib/queryClient.ts.
    // Without it, an app left open through the last night of a festival
    // keeps the skin until something remounts — the same staleness that
    // was reported against the Information Bar.
    refetchOnWindowFocus: true,
  });

  const id = data?.theme as FestiveThemeId | undefined;
  const theme = id && id in FESTIVE_THEMES ? FESTIVE_THEMES[id] : null;

  // Two shared drivers: a slow one everything breathes on, and a long
  // one Santa crosses on. Native-driven, so neither touches the JS
  // thread per frame.
  const breathe = useRef(new Animated.Value(0)).current;
  const cross = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!theme) return;
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [theme, breathe]);

  useEffect(() => {
    if (theme?.motif !== "snow") return;
    // 45 seconds, matching the web sleigh: long enough that it is a
    // surprise rather than wallpaper in the corner of a booking flow.
    const a = Animated.loop(
      Animated.timing(cross, { toValue: 1, duration: 45000, easing: Easing.linear, useNativeDriver: true }),
    );
    a.start();
    return () => a.stop();
  }, [theme, cross]);

  if (!theme) return null;

  const glow = Math.min(width, height) * 1.1;
  const lift = breathe.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Corner glows. Plain circles at low opacity rather than a real
          blur: RN has no cheap cross-platform blur, and a large blurred
          view on Android costs more than the screen under it. At this
          size a wide, very transparent circle reads the same.

          0.10, below what a true backdrop would use, because this is
          over the UI rather than behind it. */}
      <View
        style={[styles.glow, {
          width: glow, height: glow, borderRadius: glow / 2,
          backgroundColor: theme.accent, top: -glow * 0.45, left: -glow * 0.3,
        }]}
      />
      <View
        style={[styles.glow, {
          width: glow, height: glow, borderRadius: glow / 2,
          backgroundColor: theme.accentSoft, bottom: -glow * 0.5, right: -glow * 0.32,
        }]}
      />

      {/* NOTE: the garland is NOT here. It hangs from the header that
          it decorates — see FestiveGarland.tsx for why putting it in
          this overlay put marigolds across the home logo. */}

      {/* Diwali: a row of lamps along the foot of the screen, lifted
          clear of the tab bar so they sit ON the ledge. They breathe
          rather than travel, because that is what a row of lamps does. */}
      {theme.motif === "diyas" && (
        <View style={[styles.diyaRow, { bottom: insets.bottom + 56 }]}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Animated.View key={i} style={{ transform: [{ translateY: lift }] }}>
              <Diya size={i % 2 === 0 ? 30 : 24} />
            </Animated.View>
          ))}
        </View>
      )}

      {/* Christmas: Santa crosses, then is off-screen until the next
          pass. Parked well clear at both ends so he never pops in or
          out mid-screen. */}
      {theme.motif === "snow" && (
        <Animated.View
          style={[
            styles.sleigh,
            {
              top: insets.top + 90,
              transform: [
                {
                  translateX: cross.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-190, width + 190],
                  }),
                },
                {
                  translateY: cross.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [0, -22, 8],
                  }),
                },
              ],
            },
          ]}
        >
          <SantaSleigh width={150} color={theme.accent} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { position: "absolute", opacity: 0.1 },
  diyaRow: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 8,
  },
  sleigh: { position: "absolute", left: 0 },
});
