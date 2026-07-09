import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { X } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { rainBannerApi } from "../lib/rain-banner";
import { radius, spacing } from "../theme";

/**
 * "Rain doesn't slow us down" banner — the mobile twin of the web
 * `components/rain-banner.tsx`. Fetches the shared `/api/rain-banner`
 * endpoint (same `getRainBanner()` logic: AUTO weather-driven / ON /
 * OFF, controlled from /admin/pricing), so web + app show and hide
 * together and the admin toggle governs both.
 *
 * Dismissible for the session; reappears on next launch. Never blocks a
 * screen — renders nothing while loading, on error, or when `show` is
 * false. Colours mirror web's secondary-orange (amber) gradient so it
 * reads distinctly from the green welcome-offer strip it sits under.
 *
 * Layout note: the title + body are ONE multi-line `<Text>` (body on a
 * second line via `\n`), NOT stacked flex children. A flex row/column of
 * separate Texts kept collapsing the wrapping body to zero/one line and
 * clipping it behind the hero; a single Text always lays out every line
 * and grows to fit, so both always show. `textAlign:"center"` centres
 * both lines; the dismiss button lives in the right padding gutter.
 *
 * Uses raw RN `Text` (not the app's variant `Text`) so no default
 * variant line-height interferes with the two type sizes.
 *
 * @param onPress  When provided, the whole strip is tappable (used on
 *                 Home to deep-link into booking). Omit on the booking
 *                 flow itself, where it's purely informational.
 * @param rounded  Inset, fully-bordered card style for padded screens
 *                 (booking flow). Default is a full-bleed strip with a
 *                 bottom border, for stacking under the promo banner.
 */
export function RainBanner({
  onPress,
  rounded = false,
}: {
  onPress?: () => void;
  rounded?: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ["rain-banner"],
    queryFn: rainBannerApi.get,
    // Server ISR-caches this 5 min and the weather 15 min; a 15-min
    // client stale window keeps it from refetching on every focus.
    staleTime: 15 * 60 * 1000,
  });

  if (dismissed || !data?.show) return null;

  const title = data.title || "Rain doesn't slow us down";

  const inner = (
    <LinearGradient
      // amber-950/80 → amber-900/40 → orange-950/60 (web parity).
      colors={[
        "rgba(69, 26, 3, 0.80)",
        "rgba(120, 53, 15, 0.40)",
        "rgba(67, 20, 7, 0.60)",
      ]}
      locations={[0, 0.5, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[styles.strip, rounded && styles.stripRounded]}
    >
      <Text style={styles.message} allowFontScaling={false}>
        <Text style={styles.titleRun}>{`🌧️  ${title}`}</Text>
        {data.body ? (
          <Text style={styles.bodyRun}>{`\n${data.body}`}</Text>
        ) : null}
      </Text>
      {/* Absolutely positioned in the right padding gutter so its width
          never pulls the centred message off-centre. */}
      <Pressable
        onPress={() => setDismissed(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={styles.dismiss}
      >
        <X size={16} color="rgba(254, 243, 199, 0.6)" />
      </Pressable>
    </LinearGradient>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => pressed && styles.pressed}
      >
        {inner}
      </Pressable>
    );
  }
  return inner;
}

const styles = StyleSheet.create({
  strip: {
    position: "relative",
    paddingVertical: spacing["2.5"],
    // Symmetric side room so the centred text always clears the
    // absolutely-positioned dismiss button in the right gutter.
    paddingHorizontal: spacing["10"],
    borderBottomWidth: 1,
    borderBottomColor: "rgba(245, 158, 11, 0.20)", // amber-500/20
  },
  stripRounded: {
    marginVertical: spacing["2"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.20)",
  },
  // One line-height for the whole block keeps the two type sizes on a
  // consistent rhythm and avoids iOS nested-lineHeight clipping.
  message: {
    textAlign: "center",
    lineHeight: 18,
  },
  titleRun: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  bodyRun: {
    color: "rgba(254, 243, 199, 0.85)", // amber-100
    fontSize: 11,
  },
  dismiss: {
    position: "absolute",
    right: spacing["3"],
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.85,
  },
});
