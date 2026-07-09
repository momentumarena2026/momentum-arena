import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { X } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { Text } from "./ui/Text";
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
 * false.
 *
 * Styling deliberately mirrors the green "₹100 OFF" promo strip above it
 * (`HomeScreen` `styles.promo`): a plain <View> with a SOLID background
 * and centred, freely-wrapping <Text>. An earlier `LinearGradient`
 * version clipped its own multi-line content (the gradient didn't grow
 * to fit inside the ScrollView); a plain View sizes to its text
 * correctly, so nothing is cut off. Colour is the secondary orange so it
 * still reads distinctly from the green promo it sits under.
 *
 * @param onPress  When provided, the whole strip is tappable (used on
 *                 Home to deep-link into booking). Omit on the booking
 *                 flow itself, where it's purely informational.
 * @param rounded  Inset, rounded card style for padded screens (booking
 *                 flow). Default is a full-bleed strip, for stacking
 *                 directly under the promo banner.
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
    <View style={[styles.strip, rounded && styles.stripRounded]}>
      <Text variant="small" weight="700" style={styles.title}>
        {`🌧️  ${title}`}
      </Text>
      {data.body ? (
        <Text variant="tiny" weight="500" style={styles.body}>
          {data.body}
        </Text>
      ) : null}
      {/* Absolutely positioned in the right padding gutter so its width
          never pulls the centred message off-centre. */}
      <Pressable
        onPress={() => setDismissed(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={styles.dismiss}
      >
        <X size={16} color="rgba(67, 20, 7, 0.65)" />
      </Pressable>
    </View>
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
  // Mirrors HomeScreen `styles.promo`, in secondary orange. Extra
  // horizontal padding leaves room for the absolute dismiss button.
  strip: {
    position: "relative",
    paddingHorizontal: spacing["10"],
    paddingVertical: spacing["2"],
    backgroundColor: "#f59e0b", // secondary orange (amber-500)
    alignItems: "center",
  },
  stripRounded: {
    marginVertical: spacing["2"],
    borderRadius: radius.lg,
  },
  title: {
    color: "#431407", // dark amber, high contrast on the orange
    textAlign: "center",
  },
  body: {
    color: "#7c2d12", // slightly softer dark amber for the sub-line
    textAlign: "center",
    marginTop: 2,
  },
  dismiss: {
    position: "absolute",
    right: spacing["3"],
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.9,
  },
});
