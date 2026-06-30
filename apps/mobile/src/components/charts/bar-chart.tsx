import { StyleSheet, View } from "react-native";
import Svg, { Rect, Text as SvgText } from "react-native-svg";
import { Text } from "../ui";
import { colors, fonts, radius, spacing } from "../../theme";
import {
  ChartEmpty,
  defaultFormatY,
  thinnedIndices,
  useMeasuredWidth,
} from "./chart-internals";

export interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  horizontal?: boolean;
  formatValue?: (n: number) => string;
}

const V_PAD_TOP = 18; // room for value labels above bars
const V_PAD_BOTTOM = 22; // room for x labels
const MAX_X_LABELS = 8;

/**
 * Bar chart. Vertical bars by default; `horizontal` renders a horizontal
 * bar list (good for rankings). Value is shown on/next to each bar and the
 * label under/beside it.
 */
export function BarChart({
  data,
  height = 180,
  horizontal = false,
  formatValue = defaultFormatY,
}: BarChartProps) {
  const { width, onLayout } = useMeasuredWidth();

  const hasData =
    data.length > 0 &&
    data.some((d) => Number.isFinite(d.value) && d.value !== 0);

  if (!hasData) {
    return (
      <View onLayout={onLayout}>
        <ChartEmpty height={height} />
      </View>
    );
  }

  if (horizontal) {
    return (
      <View onLayout={onLayout}>
        <HorizontalBars data={data} formatValue={formatValue} />
      </View>
    );
  }

  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <VerticalBars
          data={data}
          width={width}
          height={height}
          formatValue={formatValue}
        />
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}

function VerticalBars({
  data,
  width,
  height,
  formatValue,
}: {
  data: BarChartProps["data"];
  width: number;
  height: number;
  formatValue: (n: number) => string;
}) {
  const plotH = Math.max(1, height - V_PAD_TOP - V_PAD_BOTTOM);
  const max = Math.max(...data.map((d) => (Number.isFinite(d.value) ? d.value : 0)), 1);
  const n = data.length;
  const slot = width / n;
  const barW = Math.max(2, Math.min(slot * 0.62, 40));
  const labelIdx = new Set(thinnedIndices(n, MAX_X_LABELS));

  return (
    <Svg width={width} height={height}>
      {data.map((d, i) => {
        const v = Number.isFinite(d.value) ? Math.max(0, d.value) : 0;
        const h = (v / max) * plotH;
        const cx = slot * i + slot / 2;
        const x = cx - barW / 2;
        const y = V_PAD_TOP + (plotH - h);
        return (
          <Rect
            key={`bar-${i}`}
            x={x}
            y={y}
            width={barW}
            height={Math.max(0, h)}
            rx={3}
            fill={d.color ?? colors.emerald400}
            opacity={0.9}
          />
        );
      })}

      {/* Value labels above bars */}
      {data.map((d, i) => {
        const v = Number.isFinite(d.value) ? Math.max(0, d.value) : 0;
        const h = (v / max) * plotH;
        const cx = slot * i + slot / 2;
        const y = V_PAD_TOP + (plotH - h);
        return (
          <SvgText
            key={`val-${i}`}
            x={cx}
            y={y - 5}
            fill={colors.mutedForeground}
            fontSize={9}
            fontFamily={fonts.sans}
            textAnchor="middle"
          >
            {formatValue(d.value)}
          </SvgText>
        );
      })}

      {/* x labels (thinned) */}
      {data.map((d, i) =>
        labelIdx.has(i) ? (
          <SvgText
            key={`lbl-${i}`}
            x={slot * i + slot / 2}
            y={height - 7}
            fill={colors.subtleForeground}
            fontSize={9}
            fontFamily={fonts.sans}
            textAnchor="middle"
          >
            {d.label}
          </SvgText>
        ) : null
      )}
    </Svg>
  );
}

function HorizontalBars({
  data,
  formatValue,
}: {
  data: BarChartProps["data"];
  formatValue: (n: number) => string;
}) {
  const max = Math.max(
    ...data.map((d) => (Number.isFinite(d.value) ? d.value : 0)),
    1
  );
  return (
    <View style={styles.hList}>
      {data.map((d, i) => {
        const v = Number.isFinite(d.value) ? Math.max(0, d.value) : 0;
        const pct = (v / max) * 100;
        return (
          <View key={`${d.label}-${i}`} style={styles.hRow}>
            <View style={styles.hHead}>
              <Text
                variant="tiny"
                color={colors.zinc300}
                numberOfLines={1}
                style={styles.hLabel}
              >
                {d.label}
              </Text>
              <Text variant="tiny" color={colors.foreground} weight="600">
                {formatValue(d.value)}
              </Text>
            </View>
            <View style={styles.hTrack}>
              <View
                style={[
                  styles.hFill,
                  {
                    width: `${pct}%`,
                    backgroundColor: d.color ?? colors.emerald400,
                  },
                ]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  hList: { gap: spacing["2.5"] },
  hRow: { gap: 4 },
  hHead: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  hLabel: { flex: 1 },
  hTrack: {
    height: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.muted,
    overflow: "hidden",
  },
  hFill: { height: 8, borderRadius: radius.sm, opacity: 0.9 },
});
