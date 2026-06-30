import { View } from "react-native";
import Svg, {
  G,
  Line,
  Polyline,
  Text as SvgText,
} from "react-native-svg";
import { colors, fonts } from "../../theme";
import {
  ChartEmpty,
  defaultFormatY,
  niceNum,
  thinnedIndices,
  useMeasuredWidth,
} from "./chart-internals";

export interface LineChartProps {
  data: { x: string; y: number }[];
  height?: number;
  color?: string;
  formatY?: (n: number) => string;
}

const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const Y_TICKS = 4;
const MAX_X_LABELS = 6;

/**
 * Single-line chart with faint horizontal gridlines, a few y-axis tick
 * labels and a thinned set of x-axis labels. Width is measured via onLayout
 * so it fills its container.
 */
export function LineChart({
  data,
  height = 180,
  color = colors.emerald400,
  formatY = defaultFormatY,
}: LineChartProps) {
  const { width, onLayout } = useMeasuredWidth();

  const hasData =
    data.length > 0 && data.some((d) => Number.isFinite(d.y));

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
          data={data}
          width={width}
          height={height}
          color={color}
          formatY={formatY}
        />
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}

function Body({
  data,
  width,
  height,
  color,
  formatY,
}: {
  data: { x: string; y: number }[];
  width: number;
  height: number;
  color: string;
  formatY: (n: number) => string;
}) {
  const plotW = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
  const plotH = Math.max(1, height - PAD_TOP - PAD_BOTTOM);

  const ys = data.map((d) => (Number.isFinite(d.y) ? d.y : 0));
  const rawMin = Math.min(...ys, 0);
  const rawMax = Math.max(...ys, 0);
  // Build a "nice" axis. Guard the all-equal case so we never divide by zero.
  const span = rawMax - rawMin || Math.abs(rawMax) || 1;
  const step = niceNum(span / Y_TICKS, true);
  const axisMin = Math.floor(rawMin / step) * step;
  const axisMax = Math.ceil(rawMax / step) * step || step;
  const axisSpan = axisMax - axisMin || 1;

  const xFor = (i: number) =>
    data.length === 1
      ? PAD_LEFT + plotW / 2
      : PAD_LEFT + (i / (data.length - 1)) * plotW;
  const yFor = (v: number) =>
    PAD_TOP + plotH - ((v - axisMin) / axisSpan) * plotH;

  const points = data
    .map((d, i) => `${xFor(i)},${yFor(Number.isFinite(d.y) ? d.y : 0)}`)
    .join(" ");

  const ticks: number[] = [];
  for (let v = axisMin; v <= axisMax + 1e-9; v += step) ticks.push(v);

  const xIdx = thinnedIndices(data.length, MAX_X_LABELS);

  return (
    <Svg width={width} height={height}>
      {/* Gridlines + y labels */}
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

      {/* The line */}
      <Polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* x labels (thinned) */}
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
          {data[i].x}
        </SvgText>
      ))}
    </Svg>
  );
}
