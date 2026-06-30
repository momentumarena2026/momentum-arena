import { useCallback, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Text } from "../ui";
import { colors, radius } from "../../theme";

/**
 * Shared internals for the charting kit. Not exported from the barrel —
 * these are private helpers used by the individual chart components.
 */

/** Theme-friendly categorical palette (~8 distinct hues) for series/segments. */
export const CHART_COLORS: string[] = [
  "#34d399", // emerald
  "#facc15", // yellow
  "#60a5fa", // blue
  "#fb923c", // orange
  "#a78bfa", // violet
  "#f472b6", // pink
  "#22d3ee", // cyan
  "#f87171", // red
];

/**
 * Measures the container width via onLayout so charts fill their parent
 * without hardcoding the device width. Returns the measured width (0 until
 * first layout) and the handler to spread onto the wrapping View.
 */
export function useMeasuredWidth(): {
  width: number;
  onLayout: (e: LayoutChangeEvent) => void;
} {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
  }, []);
  return { width, onLayout };
}

/** Muted centered placeholder shown when there's no data / all zeros. */
export function ChartEmpty({ height }: { height: number }) {
  return (
    <View style={[styles.empty, { height }]}>
      <Text variant="small" color={colors.subtleForeground}>
        No data for this period
      </Text>
    </View>
  );
}

/**
 * "Nice" number for axis steps — rounds up to 1/2/5 × 10^n so tick labels
 * land on readable values.
 */
export function niceNum(range: number, round: boolean): number {
  if (range <= 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

/** Default y formatter — compact-ish integer formatting. */
export function defaultFormatY(n: number): string {
  if (!isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

/**
 * Pick at most `max` evenly-spaced indices from a list of `count` items so
 * dense x-axes don't overlap their labels.
 */
export function thinnedIndices(count: number, max: number): number[] {
  if (count <= 0) return [];
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const out: number[] = [];
  const step = (count - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(Math.round(i * step));
  return Array.from(new Set(out));
}

export const chartShared = StyleSheet.create({
  axisLabel: {},
});

const styles = StyleSheet.create({
  empty: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
});
