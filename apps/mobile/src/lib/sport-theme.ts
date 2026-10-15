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
  /** Fallback banner path, relative to the API origin. Points at the
   *  resized WebP in /public/opt — the app fetches the raw file (no
   *  next/image in front of it), and the originals are 1-2MB each. */
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
    imagePath: "/opt/cricket.webp",
    hex: "#10b981",
    chipBg: "rgba(16,185,129,0.12)",
    chipBorder: "rgba(16,185,129,0.35)",
  },
  FOOTBALL: {
    label: "Football",
    emoji: "⚽",
    imagePath: "/opt/football.webp",
    hex: "#38bdf8",
    chipBg: "rgba(56,189,248,0.12)",
    chipBorder: "rgba(56,189,248,0.35)",
  },
  PICKLEBALL: {
    label: "Pickleball",
    emoji: "🎾",
    imagePath: "/opt/pickleball.webp",
    hex: "#facc15",
    chipBg: "rgba(250,204,21,0.12)",
    chipBorder: "rgba(250,204,21,0.35)",
  },
  TABLE_TENNIS: {
    label: "Table Tennis",
    emoji: "🏓",
    imagePath: "/opt/table-tennis.webp",
    hex: "#fb7185",
    chipBg: "rgba(251,113,133,0.12)",
    chipBorder: "rgba(251,113,133,0.35)",
  },
};

/**
 * Every sport the app knows about, in display order.
 *
 * The app has no Prisma client, so it cannot do `Object.values(Sport)`
 * the way lib/court-config.ts does on the web. This list is therefore
 * the app's canonical one and CAN drift from the enum — which is
 * exactly what happened before it existed: nine screens each had the
 * three sports typed out, and adding a fourth meant finding all nine.
 * One list is still one place to forget, but it is one instead of nine.
 */
export type KnownSport = "CRICKET" | "FOOTBALL" | "PICKLEBALL" | "TABLE_TENNIS";
export const ALL_SPORTS: KnownSport[] = [
  "CRICKET",
  "FOOTBALL",
  "PICKLEBALL",
  "TABLE_TENNIS",
];

/** Never throws — an unknown sport falls back to cricket rather than
 *  rendering an unstyled card. */
export function sportTheme(sport: string): SportTheme {
  return THEMES[(sport || "").toUpperCase()] ?? THEMES.CRICKET;
}
