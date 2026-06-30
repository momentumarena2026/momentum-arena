import { StyleSheet, View } from "react-native";
import Svg, { Circle, G, Text as SvgText } from "react-native-svg";
import { Text } from "../ui";
import { colors, fonts, spacing } from "../../theme";
import { ChartEmpty, useMeasuredWidth } from "./chart-internals";

export interface DonutChartProps {
  data: { label: string; value: number; color: string }[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
}

const STROKE = 18;

/**
 * Donut chart built from stacked SVG circles using strokeDasharray, with an
 * optional center label/value and a legend list rendering
 * "label — value (pct%)".
 */
export function DonutChart({
  data,
  size = 160,
  centerLabel,
  centerValue,
}: DonutChartProps) {
  // Container width is measured so the legend can wrap, but the donut itself
  // is a fixed square (`size`).
  const { onLayout } = useMeasuredWidth();

  const total = data.reduce(
    (sum, d) => sum + (Number.isFinite(d.value) && d.value > 0 ? d.value : 0),
    0
  );

  if (data.length === 0 || total <= 0) {
    return (
      <View onLayout={onLayout}>
        <ChartEmpty height={size} />
      </View>
    );
  }

  const radius = (size - STROKE) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  // Walk segments accumulating offset around the circle.
  let acc = 0;
  const segments = data
    .filter((d) => Number.isFinite(d.value) && d.value > 0)
    .map((d) => {
      const frac = d.value / total;
      const dash = frac * circumference;
      const seg = {
        color: d.color,
        dash,
        // Negative offset advances clockwise from 12 o'clock (with the -90 rot).
        offset: -acc * circumference,
      };
      acc += frac;
      return seg;
    });

  return (
    <View onLayout={onLayout}>
      <View style={styles.row}>
        <Svg width={size} height={size}>
          {/* Track */}
          <Circle
            cx={cx}
            cy={cy}
            r={radius}
            stroke={colors.muted}
            strokeWidth={STROKE}
            fill="none"
          />
          {/* Segments, rotated so they start at the top. */}
          <G rotation={-90} origin={`${cx}, ${cy}`}>
            {segments.map((s, i) => (
              <Circle
                key={i}
                cx={cx}
                cy={cy}
                r={radius}
                stroke={s.color}
                strokeWidth={STROKE}
                fill="none"
                strokeDasharray={`${s.dash} ${circumference - s.dash}`}
                strokeDashoffset={s.offset}
                strokeLinecap="butt"
              />
            ))}
          </G>
          {centerValue ? (
            <SvgText
              x={cx}
              y={centerLabel ? cy + 1 : cy + 5}
              fill={colors.foreground}
              fontSize={18}
              fontWeight="700"
              fontFamily={fonts.sans}
              textAnchor="middle"
            >
              {centerValue}
            </SvgText>
          ) : null}
          {centerLabel ? (
            <SvgText
              x={cx}
              y={centerValue ? cy + 16 : cy + 4}
              fill={colors.subtleForeground}
              fontSize={10}
              fontFamily={fonts.sans}
              textAnchor="middle"
            >
              {centerLabel}
            </SvgText>
          ) : null}
        </Svg>

        <View style={styles.legend}>
          {data.map((d, i) => {
            const v = Number.isFinite(d.value) ? d.value : 0;
            const pct = total > 0 ? Math.round((v / total) * 100) : 0;
            return (
              <View key={`${d.label}-${i}`} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: d.color }]} />
                <Text
                  variant="tiny"
                  color={colors.mutedForeground}
                  numberOfLines={1}
                  style={styles.legendText}
                >
                  {d.label} — {v.toLocaleString("en-IN")} ({pct}%)
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing["4"],
  },
  legend: {
    flex: 1,
    minWidth: 120,
    gap: spacing["2"],
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  legendText: { flex: 1 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
