"use client";

import { CourtZone } from "@prisma/client";

interface CourtDiagramProps {
  highlightedZones: CourtZone[];
  size?: "sm" | "md" | "lg";
}

const zonePositions: Record<string, { x: number; width: number; label: string }> = {
  LEATHER_1: { x: 0, width: 12.5, label: "LP1" },
  BOX_A: { x: 12.5, width: 37.5, label: "Lane A" },
  BOX_B: { x: 50, width: 37.5, label: "Lane B" },
  LEATHER_2: { x: 87.5, width: 12.5, label: "LP2" },
};

export function CourtDiagram({ highlightedZones, size = "md" }: CourtDiagramProps) {
  const heights = { sm: 60, md: 100, lg: 140 };
  const h = heights[size];

  return (
    <svg
      viewBox={`0 0 200 ${h}`}
      className="w-full"
      style={{ maxWidth: size === "sm" ? 160 : size === "md" ? 240 : 320 }}
    >
      {/* Background */}
      <rect x="0" y="0" width="200" height={h} rx="4" fill="#1a1a1a" stroke="#333" strokeWidth="1" />

      {/* Zones */}
      {Object.entries(zonePositions).map(([zone, pos]) => {
        const isHighlighted = highlightedZones.includes(zone as CourtZone);
        return (
          <g key={zone}>
            <rect
              x={pos.x * 2}
              y="4"
              width={pos.width * 2}
              height={h - 8}
              rx="2"
              fill={isHighlighted ? "#10b981" : "#2a2a2a"}
              opacity={isHighlighted ? 0.4 : 0.3}
              stroke={isHighlighted ? "#10b981" : "#444"}
              strokeWidth="1"
            />
            {size !== "sm" && (
              <text
                x={pos.x * 2 + pos.width}
                y={h / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={isHighlighted ? "#10b981" : "#666"}
                fontSize={size === "lg" ? "10" : "8"}
                fontWeight={isHighlighted ? "bold" : "normal"}
              >
                {pos.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Net lines */}
      {[25, 100, 175].map((x) => (
        <line
          key={x}
          x1={x}
          y1="4"
          x2={x}
          y2={h - 4}
          stroke="#555"
          strokeWidth="1"
          strokeDasharray="3,3"
        />
      ))}

      {/* Dimension labels for lg */}
      {size === "lg" && (
        <>
          <text x="100" y={h - 2} textAnchor="middle" fill="#666" fontSize="7">
            80 ft
          </text>
        </>
      )}
    </svg>
  );
}

// Shared court diagram for Pickleball/Badminton
export function SharedCourtDiagram({ sport }: { sport: "PICKLEBALL" | "BADMINTON" }) {
  const color = sport === "PICKLEBALL" ? "#eab308" : "#a855f7";

  return (
    <svg viewBox="0 0 120 80" className="w-full" style={{ maxWidth: 200 }}>
      <rect x="0" y="0" width="120" height="80" rx="4" fill="#1a1a1a" stroke="#333" strokeWidth="1" />
      <rect x="10" y="10" width="100" height="60" rx="2" fill={color} opacity="0.2" stroke={color} strokeWidth="1" />
      {/* Center line */}
      <line x1="60" y1="10" x2="60" y2="70" stroke={color} strokeWidth="1" opacity="0.5" />
      {/* Net */}
      <line x1="10" y1="40" x2="110" y2="40" stroke="#fff" strokeWidth="1.5" opacity="0.4" />
      <text x="60" y="76" textAnchor="middle" fill="#666" fontSize="7">
        {sport === "PICKLEBALL" ? "20 x 44 ft" : "20 x 44 ft"}
      </text>
    </svg>
  );
}
