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

// Shared court diagram for Pickleball
export function SharedCourtDiagram({ sport: _sport }: { sport: "PICKLEBALL" }) {
  const color = "#eab308";
  // Pickleball: 20 x 44 ft
  const w = 20;
  const h = 44;
  const pad = 4;

  return (
    <svg
      viewBox={`0 0 ${w + pad * 2} ${h + pad * 2 + 8}`}
      className="w-full"
      style={{ maxWidth: 140 }}
    >
      <rect
        x="0"
        y="0"
        width={w + pad * 2}
        height={h + pad * 2}
        rx="2"
        fill="#1a1a1a"
        stroke="#333"
        strokeWidth="0.5"
      />
      <rect
        x={pad}
        y={pad}
        width={w}
        height={h}
        rx="1"
        fill={color}
        opacity="0.2"
        stroke={color}
        strokeWidth="0.5"
      />
      {/* Center line */}
      <line x1={pad} y1={h / 2 + pad} x2={w + pad} y2={h / 2 + pad} stroke={color} strokeWidth="0.5" opacity="0.5" />
      {/* Net */}
      <line x1={pad} y1={h / 2 + pad} x2={w + pad} y2={h / 2 + pad} stroke="#fff" strokeWidth="1" opacity="0.4" />
      <text x={w / 2 + pad} y={h + pad * 2 + 5} textAnchor="middle" fill="#666" fontSize="4">
        20 x 44 ft
      </text>
    </svg>
  );
}
