import { useEffect, useRef } from "react";
import { Animated, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { colors } from "../theme";

/**
 * Top-of-screen thin progress bar that shows whenever a TanStack
 * Query is in flight or a mutation is committing. Mounted once at
 * the root so every screen — customer + admin — gets the same
 * visual feedback when data is loading.
 *
 * Sits ABOVE the safe-area inset (so on iPhones with a notch the
 * bar is just below the dynamic island, not hidden by it). Native-
 * driver animations on opacity (cheap), JS-driver on width (no
 * native equivalent for percentage interpolation).
 *
 * Why hook into TanStack Query (not React Navigation):
 *   - The user-perceived lag on a "navigate to detail" tap is almost
 *     always the data fetch on the new screen, not the screen
 *     transition itself. Query's in-flight state is the right signal.
 *   - Screen transitions are intentional ~250ms motion; we don't
 *     want to flash a bar for them.
 */
export function NavLoader() {
  const insets = useSafeAreaInsets();
  // Show the bar while ANY query is fetching OR a mutation is in
  // flight. Both are common during navigation: list screens fetch,
  // detail screens fetch, action buttons mutate.
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const busy = isFetching > 0 || isMutating > 0;

  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const trickleRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (busy) {
      // Trickle to 90% over 1.2s — never finishes on its own; the
      // !busy branch below pushes to 100% then fades.
      trickleRef.current?.stop();
      progress.setValue(20);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 80,
        useNativeDriver: true,
      }).start();
      trickleRef.current = Animated.timing(progress, {
        toValue: 90,
        duration: 1200,
        useNativeDriver: false,
      });
      trickleRef.current.start();
    } else {
      trickleRef.current?.stop();
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 100,
          duration: 180,
          useNativeDriver: false,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Reset position so the next start() animates from 20%.
        progress.setValue(0);
      });
    }
  }, [busy, opacity, progress]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.container, { top: insets.top, opacity }]}
    >
      <Animated.View
        style={[
          styles.bar,
          {
            width: progress.interpolate({
              inputRange: [0, 100],
              outputRange: ["0%", "100%"],
              extrapolate: "clamp",
            }),
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    zIndex: 9999,
  },
  bar: {
    height: "100%",
    backgroundColor: colors.emerald400,
    // Soft glow — matches web NavLoader's box-shadow.
    shadowColor: colors.emerald400,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 4,
  },
});
