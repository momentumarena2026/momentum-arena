import { useEffect, useRef } from "react";
import { Animated, StyleSheet, type ViewStyle } from "react-native";
import { colors, radius } from "../../theme";

interface SkeletonProps {
  width?: ViewStyle["width"];
  height?: ViewStyle["height"];
  /** Pre-set radius shortcut. Default `md` matches the rest of the UI. */
  rounded?: "sm" | "md" | "lg" | "xl" | "full";
  style?: ViewStyle;
}

/**
 * Animated placeholder block used in place of a centered ActivityIndicator
 * while data is loading. The pulse uses RN Animated (no extra deps),
 * with `useNativeDriver` for off-thread animation so the rest of the
 * screen stays responsive.
 *
 * Pattern: shape the skeleton like the real content. Don't use this for
 * button loading states — keep ActivityIndicator there since the
 * surrounding shape is already on screen.
 */
export function Skeleton({ width, height, rounded = "md", style }: SkeletonProps) {
  // Single shared pulse value across all Skeletons in a tree would be
  // ideal for synchrony, but RN can'"'"'t share Animated values across
  // unrelated trees cleanly. Per-instance loop is cheap (driver runs
  // on UI thread) and the visual difference is barely noticeable.
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.75,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        styles.base,
        { width, height, borderRadius: RADIUS_MAP[rounded], opacity: pulse },
        style,
      ]}
    />
  );
}

const RADIUS_MAP: Record<NonNullable<SkeletonProps["rounded"]>, number> = {
  sm: radius.sm,
  md: radius.md,
  lg: radius.lg,
  xl: radius.xl,
  full: 9999,
};

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.zinc800,
  },
});
