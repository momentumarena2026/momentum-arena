/**
 * SVG illustration for the Bowling-Machine practice tile on
 * /book/cricket. Mirrors the visual language of CourtDiagram /
 * SharedCourtDiagram (dark background, emerald highlight) so the
 * three Cricket tiles read as a coherent set.
 *
 * Geometry: the bowling strip is 10×90 ft, drawn along the LEFT
 * edge of a 90×90 cricket field. That ratio is fixed at the brand
 * level even though /admin/sports/bowling-machine lets staff
 * physically place the machine on either side — the picture is
 * the brochure, not a live availability indicator.
 */
export function BowlingMachineDiagram({
  size = "md",
}: {
  size?: "sm" | "md";
}) {
  // 100-unit viewBox keeps the math obvious. 10/90 = ~11% wide
  // strip on the left of a 100×100 outer rect.
  const dim = size === "sm" ? 100 : 140;

  return (
    <svg
      viewBox="0 0 100 100"
      width={dim}
      height={dim}
      role="img"
      aria-label="Bowling machine practice strip — 10 by 90 feet on the left corner"
      className="rounded-md"
    >
      {/* Outer cricket pitch (faint) */}
      <rect
        x={2}
        y={2}
        width={96}
        height={96}
        rx={4}
        fill="#0a0a0a"
        stroke="#27272a"
        strokeWidth={1}
      />

      {/* Vertical halfway line — subtle, so the 10-ft strip pops */}
      <line
        x1={50}
        y1={4}
        x2={50}
        y2={96}
        stroke="#27272a"
        strokeWidth={0.6}
        strokeDasharray="2 3"
      />

      {/* Bowling strip — 10×90, anchored to the LEFT edge.
          Width 10/90 ≈ 11; we use ~12 in viewBox units to read
          better at small sizes. Emerald-tinted so it inherits the
          brand "primary action" colour. */}
      <rect
        x={5}
        y={5}
        width={12}
        height={90}
        rx={2}
        fill="#10b981"
        fillOpacity={0.22}
        stroke="#10b981"
        strokeWidth={1}
      />

      {/* Tiny ball-flight arrow inside the strip — communicates
          "machine practice" without text. Two short arcs landing at
          a fielding spot. */}
      <path
        d="M 11 80 Q 11 50 11 22"
        stroke="#34d399"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeDasharray="2 2"
        fill="none"
      />
      <circle cx={11} cy={20} r={1.6} fill="#34d399" />

      {/* 10×90 ft label, anchored to the strip top */}
      <text
        x={11}
        y={3.5}
        fontFamily="Arial, sans-serif"
        fontSize={3}
        fill="#34d399"
        textAnchor="middle"
        dominantBaseline="hanging"
      >
        10×90 ft
      </text>
    </svg>
  );
}
