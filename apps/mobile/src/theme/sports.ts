/**
 * One colour per sport, used consistently wherever a sport is shown —
 * home cards, slot grids, booking rows, passes, receipts.
 *
 * This is the app's only *categorical* colour system, and it exists for
 * a different reason than the emerald accent. Emerald means "act on
 * this"; a sport colour means "this is cricket". Keeping the two jobs
 * apart is what stops either from becoming decoration: if the accent
 * appeared on a football card, it would stop meaning "tap me".
 *
 * Values were already in use inline on the Home screen — this lifts
 * them out so a booking row and a home card can't drift apart.
 */
export type SportSlug = "CRICKET" | "FOOTBALL" | "PICKLEBALL" | "BOWLING";

export interface SportPalette {
  /** Line work, icons, the card's edge. */
  border: string;
  /** Image scrim / card wash. Alpha on purpose — it sits over photos. */
  tint: string;
  /** Flat fill for chips and icon tiles on the black canvas. */
  soft: string;
}

export const SPORT_COLORS: Record<SportSlug, SportPalette> = {
  // Emerald doubles as the brand accent here, which is fine: cricket is
  // the flagship sport and the association is deliberate.
  CRICKET: {
    border: "#10b981",
    tint: "rgba(16, 185, 129, 0.55)",
    soft: "rgba(16, 185, 129, 0.12)",
  },
  FOOTBALL: {
    border: "#3b82f6",
    tint: "rgba(59, 130, 246, 0.55)",
    soft: "rgba(59, 130, 246, 0.12)",
  },
  PICKLEBALL: {
    border: "#eab308",
    tint: "rgba(234, 179, 8, 0.55)",
    soft: "rgba(234, 179, 8, 0.12)",
  },
  // Bowling machine is a cricket facility, so it inherits cricket's hue
  // at lower intensity rather than introducing a fourth colour.
  BOWLING: {
    border: "#34d399",
    tint: "rgba(52, 211, 153, 0.45)",
    soft: "rgba(52, 211, 153, 0.10)",
  },
};

/** Falls back to cricket's palette for an unknown slug. */
export function sportPalette(slug: string): SportPalette {
  return SPORT_COLORS[slug as SportSlug] ?? SPORT_COLORS.CRICKET;
}
