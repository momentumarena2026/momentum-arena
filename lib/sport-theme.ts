/**
 * One place for a sport's visual identity.
 *
 * The homepage sports grid already had these colours and photos inline;
 * camps (and anything else that shows a sport) needs the same palette or
 * the site starts disagreeing with itself about what "cricket" looks
 * like. Keep this in sync with apps/mobile/src/lib/sport-theme.ts.
 */

export type SportKey = "CRICKET" | "FOOTBALL" | "PICKLEBALL";

export interface SportTheme {
  label: string;
  emoji: string;
  /** Fallback photo when no custom banner has been uploaded. */
  image: string;
  /** Tailwind text colour for the sport chip. */
  text: string;
  /** Chip border + fill. */
  chip: string;
  /** Gradient laid over the banner so white text stays readable. */
  gradient: string;
  /** Hover ring on the card. */
  ring: string;
  /** Bare hex, for anything that can't use a Tailwind class. */
  hex: string;
}

const THEMES: Record<SportKey, SportTheme> = {
  CRICKET: {
    label: "Cricket",
    emoji: "🏏",
    image: "/cricket.png",
    text: "text-emerald-300",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    gradient: "from-emerald-950/95 via-emerald-950/70 to-zinc-950/40",
    ring: "hover:border-emerald-400/60 hover:shadow-emerald-500/20",
    hex: "#10b981",
  },
  FOOTBALL: {
    label: "Football",
    emoji: "⚽",
    image: "/football.jpeg",
    text: "text-sky-300",
    chip: "border-sky-500/30 bg-sky-500/10 text-sky-300",
    gradient: "from-sky-950/95 via-sky-950/70 to-zinc-950/40",
    ring: "hover:border-sky-400/60 hover:shadow-sky-500/20",
    hex: "#38bdf8",
  },
  PICKLEBALL: {
    label: "Pickleball",
    emoji: "🎾",
    image: "/pickleball.png",
    text: "text-yellow-300",
    chip: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
    gradient: "from-yellow-950/95 via-yellow-950/70 to-zinc-950/40",
    ring: "hover:border-yellow-400/60 hover:shadow-yellow-500/20",
    hex: "#facc15",
  },
};

/** Never throws — an unknown sport falls back to the cricket palette
 *  rather than rendering an unstyled card. */
export function sportTheme(sport: string): SportTheme {
  return THEMES[(sport || "").toUpperCase() as SportKey] ?? THEMES.CRICKET;
}
