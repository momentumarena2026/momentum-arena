/**
 * A sport's visual identity, app side. Mirrors lib/sport-theme.ts on the
 * web — same colours, same emoji, same fallback photos — so a camp card
 * looks like itself on both platforms. Keep the two in sync.
 *
 * Images are remote (served by the web app) rather than bundled: adding
 * three photos to the binary for a fallback isn't worth the download
 * size, and they're cached after first paint.
 */

export interface SportTheme {
  label: string;
  emoji: string;
  /** Fallback banner path, relative to the API origin. */
  imagePath: string;
  /** Accent — chips, rules, the capacity bar. */
  hex: string;
  /** Translucent fill behind a chip. */
  chipBg: string;
  chipBorder: string;
}

const THEMES: Record<string, SportTheme> = {
  CRICKET: {
    label: "Cricket",
    emoji: "🏏",
    imagePath: "/cricket.png",
    hex: "#10b981",
    chipBg: "rgba(16,185,129,0.12)",
    chipBorder: "rgba(16,185,129,0.35)",
  },
  FOOTBALL: {
    label: "Football",
    emoji: "⚽",
    imagePath: "/football.jpeg",
    hex: "#38bdf8",
    chipBg: "rgba(56,189,248,0.12)",
    chipBorder: "rgba(56,189,248,0.35)",
  },
  PICKLEBALL: {
    label: "Pickleball",
    emoji: "🎾",
    imagePath: "/pickleball.png",
    hex: "#facc15",
    chipBg: "rgba(250,204,21,0.12)",
    chipBorder: "rgba(250,204,21,0.35)",
  },
};

/** Never throws — an unknown sport falls back to cricket rather than
 *  rendering an unstyled card. */
export function sportTheme(sport: string): SportTheme {
  return THEMES[(sport || "").toUpperCase()] ?? THEMES.CRICKET;
}
