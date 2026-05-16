"use client";

import { CourtZone } from "@prisma/client";

interface CourtDiagramProps {
  highlightedZones: CourtZone[];
  size?: "sm" | "md" | "lg";
}

// Court is 80ft wide x 90ft long
// Zone widths: LP1=10ft, Lane A=30ft, Lane B=30ft, LP2=10ft = 80ft total
const COURT_WIDTH = 80;
const COURT_HEIGHT = 90;

const zonePositions: Record<string, { x: number; width: number; label: string }> = {
  LEATHER_1: { x: 0, width: 10, label: "LP1" },
  BOX_A: { x: 10, width: 30, label: "Lane A" },
  BOX_B: { x: 40, width: 30, label: "Lane B" },
  LEATHER_2: { x: 70, width: 10, label: "LP2" },
};

export function CourtDiagram({ highlightedZones, size = "md" }: CourtDiagramProps) {
  const maxWidths = { sm: 120, md: 200, lg: 280 };
  const padding = 4;

  return (
    <svg
      viewBox={`0 0 ${COURT_WIDTH + padding * 2} ${COURT_HEIGHT + padding * 2 + (size === "lg" ? 10 : 0)}`}
      className="w-full"
      style={{ maxWidth: maxWidths[size] }}
    >
      {/* Background */}
      <rect
        x="0"
        y="0"
        width={COURT_WIDTH + padding * 2}
        height={COURT_HEIGHT + padding * 2}
        rx="3"
        fill="#1a1a1a"
        stroke="#333"
        strokeWidth="0.5"
      />

      {/* Zones */}
      {Object.entries(zonePositions).map(([zone, pos]) => {
        const isHighlighted = highlightedZones.includes(zone as CourtZone);
        return (
          <g key={zone}>
            <rect
              x={pos.x + padding}
              y={padding}
              width={pos.width}
              height={COURT_HEIGHT}
              rx="1"
              fill={isHighlighted ? "#10b981" : "#2a2a2a"}
              opacity={isHighlighted ? 0.4 : 0.3}
              stroke={isHighlighted ? "#10b981" : "#444"}
              strokeWidth="0.5"
            />
            {size !== "sm" && (
              <text
                x={pos.x + pos.width / 2 + padding}
                y={COURT_HEIGHT / 2 + padding}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={isHighlighted ? "#10b981" : "#666"}
                fontSize={size === "lg" ? "7" : "5.5"}
                fontWeight={isHighlighted ? "bold" : "normal"}
              >
                {pos.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Zone divider lines */}
      {[10, 40, 70].map((x) => (
        <line
          key={x}
          x1={x + padding}
          y1={padding}
          x2={x + padding}
          y2={COURT_HEIGHT + padding}
          stroke="#555"
          strokeWidth="0.5"
          strokeDasharray="2,2"
        />
      ))}

      {/* Dimension labels for lg */}
      {size === "lg" && (
        <>
          <text
            x={COURT_WIDTH / 2 + padding}
            y={COURT_HEIGHT + padding * 2 + 6}
            textAnchor="middle"
            fill="#666"
            fontSize="5"
          >
            80 ft
          </text>
          <text
            x={padding - 1}
            y={COURT_HEIGHT / 2 + padding}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#666"
            fontSize="5"
            transform={`rotate(-90, ${padding - 1}, ${COURT_HEIGHT / 2 + padding})`}
          >
            90 ft
          </text>
        </>
      )}
    </svg>
  );
}

// Shared court diagram for Pickleball.
//
// Geometry: the venue surface is 26 x 50 ft. The regulation playable
// markings live INSIDE that as a 20 x 44 ft rectangle, centered with
// a 3 ft buffer on every side. We paint the buffer in neutral gray
// (the surrounding concrete) and the playable area in blue so the
// difference reads at a glance — old version only drew the 20 x 44
// rectangle, which misrepresented what the customer actually books.
//
// Court markings inside the playable area follow USAPA spec:
//   - Net across the 20 ft width at the centerline (22 ft from each baseline)
//   - Non-volley zone (kitchen): 7 ft on each side of the net, full 20 ft wide
//   - Centerline: divides each service half (10 ft from each sideline),
//     drawn only between kitchen line and baseline (never through the kitchen)
export function SharedCourtDiagram({ sport: _sport }: { sport: "PICKLEBALL" }) {
  // Tailwind blue-500 — matches the "Pickleball" amber palette poorly,
  // but the user asked for blue specifically (and it reads as a court).
  const playableFill = "#3b82f6";
  const playableLine = "#60a5fa"; // blue-400 — slightly lighter for the rim
  const marking = "#e5e7eb"; // zinc-200 — court paint lines + net
  const surfaceFill = "#3f3f46"; // zinc-700 — the concrete around the court
  const surfaceLine = "#52525b"; // zinc-600

  // ── Dimensions (in feet — SVG units map 1:1) ─────────────────────
  // The dimension label used to live inside the SVG, but at the
  // narrow card widths we render at (90-ish px) the long
  // "26 × 50 ft · playable 20 × 44 ft" string overflowed the viewBox
  // and got clipped by the surrounding card. We drop the SVG-internal
  // label entirely now — the parent card already shows the dimensions
  // next to the diagram from CourtConfig (config.widthFt x lengthFt),
  // so the label was redundant. Also caps maxWidth at 90 so the card
  // doesn't tower at ~320px tall when the diagram is rendered next to
  // a short text block (real court aspect is ~1:2, so width caps the
  // height directly).
  const surfW = 26;
  const surfH = 50;
  const playW = 20;
  const playH = 44;
  const offX = (surfW - playW) / 2; // 3 ft buffer
  const offY = (surfH - playH) / 2; // 3 ft buffer
  const netY = offY + playH / 2; // 25 ft from top of surface
  const kitchenOffset = 7; // ft from net
  const pad = 3;

  return (
    <svg
      viewBox={`0 0 ${surfW + pad * 2} ${surfH + pad * 2}`}
      className="w-full"
      style={{ maxWidth: 90 }}
    >
      {/* Card background */}
      <rect
        x="0"
        y="0"
        width={surfW + pad * 2}
        height={surfH + pad * 2}
        rx="2"
        fill="#1a1a1a"
        stroke="#333"
        strokeWidth="0.5"
      />

      {/* Surface (26 x 50) — the concrete the court is painted on */}
      <rect
        x={pad}
        y={pad}
        width={surfW}
        height={surfH}
        rx="1.5"
        fill={surfaceFill}
        stroke={surfaceLine}
        strokeWidth="0.4"
      />

      {/* Playable area (20 x 44) — blue, centered inside the surface */}
      <rect
        x={pad + offX}
        y={pad + offY}
        width={playW}
        height={playH}
        fill={playableFill}
        fillOpacity="0.55"
        stroke={playableLine}
        strokeWidth="0.6"
      />

      {/* Kitchen / non-volley zone — slightly darker overlay on the
          7-ft strips on either side of the net. */}
      <rect
        x={pad + offX}
        y={pad + netY - kitchenOffset}
        width={playW}
        height={kitchenOffset * 2}
        fill="#1d4ed8" /* blue-700 */
        fillOpacity="0.45"
      />

      {/* Centerline — top half (baseline to kitchen line) */}
      <line
        x1={pad + offX + playW / 2}
        y1={pad + offY}
        x2={pad + offX + playW / 2}
        y2={pad + netY - kitchenOffset}
        stroke={marking}
        strokeWidth="0.4"
        opacity="0.85"
      />
      {/* Centerline — bottom half (kitchen line to baseline) */}
      <line
        x1={pad + offX + playW / 2}
        y1={pad + netY + kitchenOffset}
        x2={pad + offX + playW / 2}
        y2={pad + offY + playH}
        stroke={marking}
        strokeWidth="0.4"
        opacity="0.85"
      />

      {/* Kitchen lines (7 ft from net, both sides) */}
      <line
        x1={pad + offX}
        y1={pad + netY - kitchenOffset}
        x2={pad + offX + playW}
        y2={pad + netY - kitchenOffset}
        stroke={marking}
        strokeWidth="0.4"
        opacity="0.85"
      />
      <line
        x1={pad + offX}
        y1={pad + netY + kitchenOffset}
        x2={pad + offX + playW}
        y2={pad + netY + kitchenOffset}
        stroke={marking}
        strokeWidth="0.4"
        opacity="0.85"
      />

      {/* Net — drawn last so it sits above all court paint. Extends
          slightly past the sidelines like the real net posts do. */}
      <line
        x1={pad + offX - 1}
        y1={pad + netY}
        x2={pad + offX + playW + 1}
        y2={pad + netY}
        stroke="#ffffff"
        strokeWidth="0.9"
        opacity="0.95"
      />

    </svg>
  );
}
