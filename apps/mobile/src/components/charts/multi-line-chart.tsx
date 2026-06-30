import { StyleSheet, View } from "react-native";
import Svg, {
  G,
  Line,
  Polyline,
  Text as SvgText,
} from "react-native-svg";
import { Text } from "../ui";
import { colors, fonts, spacing } from "../../theme";
import {
  ChartEmpty,
  defaultFormatY,
  niceNum,
  thinnedIndices,
  useMeasuredWidth,
} from "./chart-internals";

export interface MultiLineChartProps {
  series: {
    name: string;
    color: string;
    points: { x: string; y: number }[];
  }[];
  height?: number;
  formatY?: (n: number) => string;
}

const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const Y_TICKS = 4;
const MAX_X_LABELS = 6;

/**
 * Multiple lines sharing the x labels of series[0], with a wrapping legend
 * (color dot + name). Width is measured via onLayout.
 */
export function MultiLineChart({
  series,
  height = 180,
  formatY = defaultFormatY,
}: MultiLineChartProps) {
  const { width, onLayout } = useMeasuredWidth();

  const xLabels = series[0]?.points.map((p) => p.x) ?? [];
  const hasData =
    series.length > 0 &&
    xLabels.length > 0 &&
    series.some((s) => s.points.some((p) => Number.isFinite(p.y)));

  if (!hasData) {
    return (
      <View onLayout={onLayout}>
        <ChartEmpty height={height} />
      </View>
    );
  }

  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <Body
          series={series}
          xLabels={xLabels}
          width={width}
          height={height}
          formatY={formatY}
        />
      ) : (
        <View style={{ height }} />
      )}
      <View style={styles.legend}>
        {series.map((s) => (
          <View key={s.name} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: s.color }]} />
            <Text variant="tiny" color={colors.mutedForeground}>
              {s.name}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Body({
  series,
  xLabels,
  width,
  height,
  formatY,
}: {
  series: MultiLineChartProps["series"];
  xLabels: string[];
  width: number;
  height: number;
  formatY: (n: number) => string;
}) {
  const plotW = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
  const plotH = Math.max(1, height - PAD_TOP - PAD_BOTTOM);
  const n = xLabels.length;

  const allYs = series.flatMap((s) =>
    s.points.map((p) => (Number.isFinite(p.y) ? p.y : 0))
  );
  const rawMin = Math.min(...allYs, 0);
  const rawMax = Math.max(...allYs, 0);
  const span = rawMax - rawMin || Math.abs(rawMax) || 1;
  const step = niceNum(span / Y_TICKS, true);
  const axisMin = Math.floor(rawMin / step) * step;
  const axisMax = Math.ceil(rawMax / step) * step || step;
  const axisSpan = axisMax - axisMin || 1;

  const xFor = (i: number) =>
    n === 1 ? PAD_LEFT + plotW / 2 : PAD_LEFT + (i / (n - 1)) * plotW;
  const yFor = (v: number) =>
    PAD_TOP + plotH - ((v - axisMin) / axisSpan) * plotH;

  const ticks: number[] = [];
  for (let v = axisMin; v <= axisMax + 1e-9; v += step) ticks.push(v);

  const xIdx = thinnedIndices(n, MAX_X_LABELS);

  return (
    <Svg width={width} height={height}>
      {ticks.map((v, i) => {
        const y = yFor(v);
        return (
          <G key={`grid-${i}`}>
            <Line
              x1={PAD_LEFT}
              y1={y}
              x2={width - PAD_RIGHT}
              y2={y}
              stroke={colors.border}
              strokeWidth={1}
            />
            <SvgText
              x={PAD_LEFT - 6}
              y={y + 3}
              fill={colors.subtleForeground}
              fontSize={9}
              fontFamily={fonts.sans}
              textAnchor="end"
            >
              {formatY(v)}
            </SvgText>
          </G>
        );
      })}

      {series.map((s) => {
        // Clip to the shared x axis length so a longer series doesn't run off.
        const pts = s.points
          .slice(0, n)
          .map(
            (p, i) => `${xFor(i)},${yFor(Number.isFinite(p.y) ? p.y : 0)}`
          )
          .join(" ");
        return (
          <Polyline
            key={s.name}
            points={pts}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}

      {xIdx.map((i) => (
        <SvgText
          key={`x-${i}`}
          x={xFor(i)}
          y={height - 8}
          fill={colors.subtleForeground}
          fontSize={9}
          fontFamily={fonts.sans}
          textAnchor="middle"
        >
          {xLabels[i]}
        </SvgText>
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["3"],
    marginTop: spacing["2"],
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
