import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { festiveApi } from "../../lib/festive";
import { FESTIVE_THEMES, type FestiveThemeId } from "../../lib/festive-themes";
import { GarlandUnit } from "./FestiveArt";

/**
 * The garland that hangs under a screen's own header, and the festival
 * wish beneath it. The app twin of web's
 * `components/festive/festive-garland.tsx`.
 *
 * ── WHY THIS IS NOT PART OF THE APP-WIDE OVERLAY ──────────────────────
 * It was, and it landed ON the home header — across the logo, beside
 * the points chip. A toran hangs from something, and in the overlay
 * there is nothing to hang it from: the only available anchor is the
 * top of the screen, which is where the header already is. Offsetting
 * by a constant would have meant guessing a header height that differs
 * per screen.
 *
 * So it is rendered BY the header it decorates, exactly as the web one
 * is rendered by `SiteHeader` — the component that knows how tall it
 * is. `position: absolute` with `top: "100%"` keeps it out of the
 * header's layout, so nothing shifts by a pixel when a festival starts.
 *
 * The glows, the diyas and Santa stay in the app-wide overlay, because
 * those genuinely belong to the whole screen rather than to the header.
 *
 * Shares `["festive-theme"]` with the backdrop, so react-query serves
 * both from one request.
 */
/**
 * How many things hang from the string.
 *
 * Was 20, which on a 402pt phone is one every 20pt — they touched, and
 * the garland stopped reading as a string of flowers and became a solid
 * orange band welded to the bottom of the header. Eleven leaves black
 * between them, which is what makes it look hung rather than printed.
 *
 * The web garland can afford 28 because it has three times the width.
 */
const GARLAND_UNITS = 11;

export function FestiveGarland() {
  const { data } = useQuery({
    queryKey: ["festive-theme"],
    queryFn: festiveApi.get,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const id = data?.theme as FestiveThemeId | undefined;
  const theme = id && id in FESTIVE_THEMES ? FESTIVE_THEMES[id] : null;

  const sway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!theme) return;
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(sway, { toValue: 1, duration: 2300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(sway, { toValue: 0, duration: 2300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [theme, sway]);

  if (!theme) return null;
  const rotate = sway.interpolate({ inputRange: [0, 1], outputRange: ["-5deg", "5deg"] });

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={[styles.thread, { backgroundColor: theme.accent, shadowColor: theme.accent }]} />
      <View style={styles.row}>
        {Array.from({ length: GARLAND_UNITS }).map((_, i) => (
          <Animated.View
            key={i}
            style={{
              // Alternating drop, so the garland scallops rather than
              // sitting in a straight line.
              marginTop: i % 2 === 0 ? 0 : 5,
              transform: [{ rotate }],
            }}
          >
            <GarlandUnit theme={theme.id} i={i} />
          </Animated.View>
        ))}
      </View>
      <View style={styles.greetingRow}>
        <Text style={[styles.greeting, { color: theme.accentText, shadowColor: theme.accent }]}>
          {theme.greeting}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // `marginTop` is the gap between the header's bottom edge and the
  // string. Without it the garland sat flush against the header border
  // and the two read as one thick bar.
  wrap: { position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, marginTop: 3 },
  thread: { height: 1, opacity: 0.35, shadowOpacity: 0.5, shadowRadius: 3 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 6 },
  greetingRow: { alignItems: "center", marginTop: 3 },
  greeting: {
    // Smaller and flatter than it was. A bold pill under a dense
    // garland made a third horizontal band across the top of the app,
    // directly under the header and above the hero — three stacked
    // strips before any content. It is a touch, not a banner.
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.6,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.35)",
    shadowOpacity: 0.45,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
});
