import { StyleSheet, View } from "react-native";
import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg";
import type { CourtZone } from "../lib/types";

/**
 * Small court schematic mirrored from the web (`components/booking/court-diagram.tsx`).
 * Shows a 80×90ft court with four lanes (LP1, Lane A, Lane B, LP2) and
 * highlights the zones the selected config covers.
 */

const COURT_WIDTH = 80;
const COURT_HEIGHT = 90;
const PAD = 4;

const ZONE_POSITIONS: Record<
  string,
  { x: number; width: number; label: string }
> = {
  LEATHER_1: { x: 0, width: 10, label: "LP1" },
  BOX_A: { x: 10, width: 30, label: "Lane A" },
  BOX_B: { x: 40, width: 30, label: "Lane B" },
  LEATHER_2: { x: 70, width: 10, label: "LP2" },
};

const SIZE_MAP = {
  sm: { maxWidth: 120, fontSize: 0, showLabels: false },
  md: { maxWidth: 200, fontSize: 5.5, showLabels: true },
  lg: { maxWidth: 280, fontSize: 7, showLabels: true },
} as const;

interface Props {
  highlightedZones: CourtZone[];
  size?: keyof typeof SIZE_MAP;
}

export function CourtDiagram({ highlightedZones, size = "md" }: Props) {
  const cfg = SIZE_MAP[size];
  const vbWidth = COURT_WIDTH + PAD * 2;
  const vbHeight = COURT_HEIGHT + PAD * 2;
  // Keep the rendered pixel size bounded; Svg auto-scales to fit.
  const renderW = cfg.maxWidth;
  const renderH = (cfg.maxWidth * vbHeight) / vbWidth;

  return (
    <View style={[styles.wrap, { width: renderW, height: renderH }]}>
      <Svg
        width={renderW}
        height={renderH}
        viewBox={`0 0 ${vbWidth} ${vbHeight}`}
      >
        {/* Background */}
        <Rect
          x={0}
          y={0}
          width={vbWidth}
          height={vbHeight}
          rx={3}
          fill="#1a1a1a"
          stroke="#333"
          strokeWidth={0.5}
        />

        {/* Zones */}
        {Object.entries(ZONE_POSITIONS).map(([zone, pos]) => {
          const isHighlighted = highlightedZones.includes(zone as CourtZone);
          return (
            <G key={zone}>
              <Rect
                x={pos.x + PAD}
                y={PAD}
                width={pos.width}
                height={COURT_HEIGHT}
                rx={1}
                fill={isHighlighted ? "#10b981" : "#2a2a2a"}
                fillOpacity={isHighlighted ? 0.4 : 0.3}
                stroke={isHighlighted ? "#10b981" : "#444"}
                strokeWidth={0.5}
              />
              {cfg.showLabels ? (
                <SvgText
                  x={pos.x + pos.width / 2 + PAD}
                  y={COURT_HEIGHT / 2 + PAD}
                  textAnchor="middle"
                  // react-native-svg supports alignmentBaseline; "middle" is
                  // the closest analogue to the web's dominantBaseline.
                  alignmentBaseline="middle"
                  fill={isHighlighted ? "#10b981" : "#666"}
                  fontSize={cfg.fontSize}
                  fontWeight={isHighlighted ? "bold" : "normal"}
                >
                  {pos.label}
                </SvgText>
              ) : null}
            </G>
          );
        })}

        {/* Zone divider lines */}
        {[10, 40, 70].map((x) => (
          <Line
            key={x}
            x1={x + PAD}
            y1={PAD}
            x2={x + PAD}
            y2={COURT_HEIGHT + PAD}
            stroke="#555"
            strokeWidth={0.5}
            strokeDasharray="2,2"
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "center",
  },
});
