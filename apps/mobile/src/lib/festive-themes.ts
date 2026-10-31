/**
 * Mobile-local mirror of web's `lib/festive-themes.ts`.
 *
 * Mobile runs its own React Native bundle with no path alias to the web
 * /lib directory, so the palette and the resolution rules live here too.
 *
 * Keep IN SYNC with `lib/festive-themes.ts` — the windows, the ids and
 * the colours must be identical, or the website and the app dress up on
 * different days for the same festival. `tests/festive-themes.parity.test.ts`
 * pins them together.
 *
 * ── WHY THE WINDOWS ARE DUPLICATED AND NOT FETCHED ────────────────────
 * The server sends only the resolved theme ID (`/api/festive-theme`), so
 * at runtime the app does not need the windows at all. They are here so
 * the two files are one artefact that a parity test can compare — and
 * so a future offline/cached render can resolve the same answer the
 * server would. Sending colours over the wire instead would make the
 * server a second source of truth that could disagree with whatever
 * build is actually installed on the phone.
 */

export type FestiveThemeId = "diwali" | "christmas" | "holi";
export type FestiveThemeMode = "AUTO" | "ON" | "OFF";

export interface FestiveWindow {
  from: string;
  to: string;
}

export interface FestiveTheme {
  id: FestiveThemeId;
  label: string;
  blurb: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  motif: "diyas" | "snow" | "colour-splash";
  greeting: string;
  iconKey: string;
  windows: Record<string, FestiveWindow>;
}

export const FESTIVE_THEMES: Record<FestiveThemeId, FestiveTheme> = {
  diwali: {
    id: "diwali",
    label: "Diwali",
    blurb: "Warm amber and gold, with diyas along the edges.",
    accent: "#fbbf24",
    accentSoft: "#f97316",
    accentText: "#fcd34d",
    motif: "diyas",
    greeting: "Happy Diwali",
    iconKey: "diwali",
    windows: {
      "2026": { from: "2026-11-01", to: "2026-11-11" },
    },
  },
  christmas: {
    id: "christmas",
    label: "Christmas",
    blurb: "Cool red and pine green, with a light snowfall.",
    accent: "#f87171",
    accentSoft: "#34d399",
    accentText: "#fca5a5",
    motif: "snow",
    greeting: "Merry Christmas",
    iconKey: "christmas",
    windows: {
      "2026": { from: "2026-12-18", to: "2026-12-26" },
    },
  },
  holi: {
    id: "holi",
    label: "Holi",
    blurb: "Colour splashes across the backdrop.",
    accent: "#e879f9",
    accentSoft: "#38bdf8",
    accentText: "#f0abfc",
    motif: "colour-splash",
    greeting: "Happy Holi",
    iconKey: "holi",
    windows: {
      "2027": { from: "2027-03-20", to: "2027-03-23" },
    },
  },
};

export const FESTIVE_THEME_IDS = Object.keys(FESTIVE_THEMES) as FestiveThemeId[];

/** Which theme's window contains this IST calendar date, if any. */
export function themeForDay(dayKey: string): FestiveTheme | null {
  const year = dayKey.slice(0, 4);
  for (const id of FESTIVE_THEME_IDS) {
    const theme = FESTIVE_THEMES[id];
    const w = theme.windows[year];
    if (w && dayKey >= w.from && dayKey <= w.to) return theme;
  }
  return null;
}

/** The theme to render, given the admin's setting and today's IST date. */
export function resolveFestiveTheme(args: {
  mode: string | null | undefined;
  override?: string | null;
  dayKey: string;
}): FestiveTheme | null {
  if (args.mode === "OFF") return null;
  if (args.mode === "ON") {
    const forced = args.override as FestiveThemeId | null | undefined;
    if (forced && forced in FESTIVE_THEMES) return FESTIVE_THEMES[forced];
    return themeForDay(args.dayKey);
  }
  return themeForDay(args.dayKey);
}
