import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { festiveApi } from "../../lib/festive";
import {
  FESTIVE_THEMES,
  type FestiveThemeId,
} from "../../lib/festive-themes";

/**
 * The seasonal skin — the app twin of web's
 * `components/festive/festive-backdrop.tsx`.
 *
 * ── WHY THIS IS AN OVERLAY AND THE WEB ONE IS A BACKDROP ──────────────
 * On the web the layer sits at `-z-10` behind the page, because the page
 * background is transparent over the body's black. React Native has no
 * such luxury: every screen here paints an OPAQUE `colors.background`,
 * so anything rendered behind the navigator is simply covered.
 *
 * So this sits ON TOP, with `pointerEvents="none"` so it can never eat a
 * tap, and at low opacity so it reads as the UI being lit warmly rather
 * than as a film over it. The opacities below are lower than the web's
 * for exactly that reason — on the web the glow is under the text, here
 * it is over it.
 *
 * Mounted once at the app root so every screen wears it, which also
 * means it must stay cheap: eight particles, native-driven transforms
 * only, and nothing that lays out.
 *
 * The query is PUBLIC (`auth: false`), so it runs signed out — which is
 * required, since the landing screen is the first thing a new visitor
 * sees and it should be dressed up for them too. See
 * `tests/app-authed-queries.test.ts` for why that distinction is load-
 * bearing on this surface.
 */
export function FestiveBackdrop() {
  const { width, height } = useWindowDimensions();

  const { data } = useQuery({
    queryKey: ["festive-theme"],
    queryFn: festiveApi.get,
    // Matches the server's 5-minute ISR window, so an admin toggling the
    // theme reaches a reopened app promptly without the app polling.
    staleTime: 5 * 60 * 1000,
    // Opts into the foreground refetch bridged in lib/queryClient.ts.
    // Without it, an app left open through midnight on the last day of
    // a festival keeps the skin until something remounts — the same
    // staleness that was reported against the Information Bar.
    refetchOnWindowFocus: true,
  });

  const id = data?.theme as FestiveThemeId | undefined;
  const theme = id && id in FESTIVE_THEMES ? FESTIVE_THEMES[id] : null;

  // One shared driver for every particle; each reads it at a different
  // phase. Native-driven, so it does not touch the JS thread per frame.
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!theme) return;
    const loop = Animated.loop(
      Animated.timing(drift, {
        toValue: 1,
        duration: theme.motif === "snow" ? 13000 : 5500,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [theme, drift]);

  if (!theme) return null;

  const snow = theme.motif === "snow";
  const glow = Math.min(width, height) * 1.1;

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Corner glows. Plain circles with a low opacity rather than a
          real blur: RN has no cheap cross-platform blur, and a large
          blurred view on Android costs more than this whole screen. A
          wide, very transparent circle reads the same at this size. */}
      <View
        style={[
          styles.glow,
          {
            width: glow,
            height: glow,
            borderRadius: glow / 2,
            backgroundColor: theme.accent,
            top: -glow * 0.45,
            left: -glow * 0.3,
          },
        ]}
      />
      <View
        style={[
          styles.glow,
          {
            width: glow,
            height: glow,
            borderRadius: glow / 2,
            backgroundColor: theme.accentSoft,
            bottom: -glow * 0.5,
            right: -glow * 0.32,
          },
        ]}
      />

      {PARTICLES.map((p, i) => {
        const translateY = drift.interpolate({
          inputRange: [0, 1],
          outputRange: snow ? [-40, height + 40] : [0, -14],
        });
        return (
          <Animated.View
            key={i}
            style={[
              snow ? styles.flake : styles.ember,
              {
                left: `${p.left}%`,
                top: snow ? -40 : (`${p.top}%` as unknown as number),
                backgroundColor:
                  theme.motif === "colour-splash" && i % 2 === 1
                    ? theme.accentSoft
                    : snow
                      ? "#ffffff"
                      : theme.accent,
                shadowColor: theme.accent,
                transform: [{ translateY }],
              },
              theme.motif === "colour-splash" && styles.splash,
            ]}
          />
        );
      })}
    </View>
  );
}

/**
 * Eight hand-picked positions. Not generated: a modulo spread bands
 * visibly, and random would change on every render and re-mount the
 * animation. Eight rather than the web's eighteen because this is over
 * live UI on a phone, where more reads as dirt on the screen.
 */
const PARTICLES = [
  { left: 8, top: 16 },
  { left: 22, top: 64 },
  { left: 35, top: 28 },
  { left: 48, top: 78 },
  { left: 61, top: 20 },
  { left: 74, top: 55 },
  { left: 86, top: 34 },
  { left: 93, top: 72 },
];

const styles = StyleSheet.create({
  glow: {
    position: "absolute",
    // Deliberately below the web's 0.18: there the glow is UNDER the
    // text, here it is over it, so the same value would wash out body
    // copy on the darkest screens.
    opacity: 0.1,
  },
  ember: {
    position: "absolute",
    width: 5,
    height: 5,
    borderRadius: 3,
    opacity: 0.6,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  flake: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 2,
    opacity: 0.45,
    shadowOpacity: 0.6,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  splash: {
    width: 26,
    height: 26,
    borderRadius: 13,
    opacity: 0.16,
  },
});
