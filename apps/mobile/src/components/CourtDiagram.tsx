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

/**
 * Pickleball court schematic. Mirrors the web's
 * `SharedCourtDiagram` in `components/booking/court-diagram.tsx`:
 *   - 26×50 ft outer surface (zinc-700) — the actual concrete area
 *   - 20×44 ft regulation playable area in BLUE (centered, 3 ft buffer)
 *   - Non-volley zone ("kitchen") shown as darker blue strip 7 ft on
 *     each side of the net, full 20 ft wide
 *   - USAPA-spec centerlines (kitchen line → baseline only, NOT through
 *     the kitchen)
 *   - Net drawn last, extending slightly past the sidelines like real
 *     net posts
 *
 * Kept in the same file as `CourtDiagram` so the slot/sport screens
 * import both from one place. Mobile-local copy of the web component —
 * if the geometry ever changes, update both. (See web's component for
 * the design rationale and dimension labelling.)
 */
const PB_SURF_W = 26;
const PB_SURF_H = 50;
const PB_PLAY_W = 20;
const PB_PLAY_H = 44;
const PB_OFF_X = (PB_SURF_W - PB_PLAY_W) / 2; // 3 ft buffer
const PB_OFF_Y = (PB_SURF_H - PB_PLAY_H) / 2;
const PB_NET_Y = PB_OFF_Y + PB_PLAY_H / 2;
const PB_KITCHEN = 7;
const PB_PAD = 3;

const PB_COLORS = {
  playableFill: "#3b82f6", // blue-500
  playableLine: "#60a5fa", // blue-400
  kitchen: "#1d4ed8", // blue-700
  marking: "#e5e7eb", // zinc-200
  surfaceFill: "#3f3f46", // zinc-700
  surfaceLine: "#52525b", // zinc-600
  cardBg: "#1a1a1a",
  cardBorder: "#333",
  net: "#ffffff",
} as const;

export function SharedCourtDiagram({ sport: _sport }: { sport: "PICKLEBALL" }) {
  const vbWidth = PB_SURF_W + PB_PAD * 2;
  const vbHeight = PB_SURF_H + PB_PAD * 2;
  // Capped at 90px to match the web's max-width; the slot/sport screens
  // need this compact since the pickleball court is ~1:2 tall.
  const renderW = 90;
  const renderH = (renderW * vbHeight) / vbWidth;

  return (
    <View style={[styles.wrap, { width: renderW, height: renderH }]}>
      <Svg
        width={renderW}
        height={renderH}
        viewBox={`0 0 ${vbWidth} ${vbHeight}`}
      >
        {/* Card background */}
        <Rect
          x={0}
          y={0}
          width={vbWidth}
          height={vbHeight}
          rx={2}
          fill={PB_COLORS.cardBg}
          stroke={PB_COLORS.cardBorder}
          strokeWidth={0.5}
        />

        {/* Outer surface (26 × 50) — concrete around the playable area */}
        <Rect
          x={PB_PAD}
          y={PB_PAD}
          width={PB_SURF_W}
          height={PB_SURF_H}
          rx={1.5}
          fill={PB_COLORS.surfaceFill}
          stroke={PB_COLORS.surfaceLine}
          strokeWidth={0.4}
        />

        {/* Playable area (20 × 44) — blue, centered */}
        <Rect
          x={PB_PAD + PB_OFF_X}
          y={PB_PAD + PB_OFF_Y}
          width={PB_PLAY_W}
          height={PB_PLAY_H}
          fill={PB_COLORS.playableFill}
          fillOpacity={0.55}
          stroke={PB_COLORS.playableLine}
          strokeWidth={0.6}
        />

        {/* Kitchen / non-volley zone — darker blue overlay 7 ft each side of net */}
        <Rect
          x={PB_PAD + PB_OFF_X}
          y={PB_PAD + PB_NET_Y - PB_KITCHEN}
          width={PB_PLAY_W}
          height={PB_KITCHEN * 2}
          fill={PB_COLORS.kitchen}
          fillOpacity={0.45}
        />

        {/* Centerlines — top half + bottom half (skip the kitchen) */}
        <Line
          x1={PB_PAD + PB_OFF_X + PB_PLAY_W / 2}
          y1={PB_PAD + PB_OFF_Y}
          x2={PB_PAD + PB_OFF_X + PB_PLAY_W / 2}
          y2={PB_PAD + PB_NET_Y - PB_KITCHEN}
          stroke={PB_COLORS.marking}
          strokeWidth={0.4}
          opacity={0.85}
        />
        <Line
          x1={PB_PAD + PB_OFF_X + PB_PLAY_W / 2}
          y1={PB_PAD + PB_NET_Y + PB_KITCHEN}
          x2={PB_PAD + PB_OFF_X + PB_PLAY_W / 2}
          y2={PB_PAD + PB_OFF_Y + PB_PLAY_H}
          stroke={PB_COLORS.marking}
          strokeWidth={0.4}
          opacity={0.85}
        />

        {/* Kitchen lines (7 ft each side of net, full width) */}
        <Line
          x1={PB_PAD + PB_OFF_X}
          y1={PB_PAD + PB_NET_Y - PB_KITCHEN}
          x2={PB_PAD + PB_OFF_X + PB_PLAY_W}
          y2={PB_PAD + PB_NET_Y - PB_KITCHEN}
          stroke={PB_COLORS.marking}
          strokeWidth={0.4}
          opacity={0.85}
        />
        <Line
          x1={PB_PAD + PB_OFF_X}
          y1={PB_PAD + PB_NET_Y + PB_KITCHEN}
          x2={PB_PAD + PB_OFF_X + PB_PLAY_W}
          y2={PB_PAD + PB_NET_Y + PB_KITCHEN}
          stroke={PB_COLORS.marking}
          strokeWidth={0.4}
          opacity={0.85}
        />

        {/* Net — drawn last so it sits above court paint. Extends past
            the sidelines to read as net posts. */}
        <Line
          x1={PB_PAD + PB_OFF_X - 1}
          y1={PB_PAD + PB_NET_Y}
          x2={PB_PAD + PB_OFF_X + PB_PLAY_W + 1}
          y2={PB_PAD + PB_NET_Y}
          stroke={PB_COLORS.net}
          strokeWidth={0.9}
          opacity={0.95}
        />
      </Svg>
    </View>
  );
}
