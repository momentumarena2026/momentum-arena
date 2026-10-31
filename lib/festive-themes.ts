/**
 * Festive themes — the seasonal skin the website and the app wear
 * during a festival, and the one place that decides which (if any) is
 * running today.
 *
 * ── WHAT A FESTIVE THEME IS, AND DELIBERATELY IS NOT ──────────────────
 * It is a LAYER over the normal product: a tinted backdrop, a warmer
 * accent, a motif. It is not a redesign, and nothing about navigation,
 * copy or layout changes underneath it. That boundary is the whole
 * reason this is cheap to switch on and safe to switch off mid-festival
 * — which is the thing an admin actually needs at 9pm when something
 * looks wrong.
 *
 * It also means the base palette stays authoritative. A theme supplies
 * GLOWS and an ACCENT; it never replaces `--background` or
 * `--foreground`, so body text keeps the contrast it was designed with.
 * Every accent below was checked against the black canvas for the same
 * 4.5:1 AA floor that `apps/mobile/src/theme/colors.ts` documents for
 * `subtleForeground` — see `contrastOnBlack` and its test.
 *
 * ── WHY THE WINDOWS ARE TYPED OUT AND NOT COMPUTED ────────────────────
 * Diwali and Holi are lunar: they move every year, and no arithmetic in
 * this repo should pretend otherwise. `lib/navratri-2026.ts` and
 * `lib/diwali-2026.ts` already set the precedent — dates are verified
 * against published panchang and written down, per year. Christmas is
 * fixed, and is written down the same way so the shape is uniform.
 *
 * A year with no entry simply has no theme. That is the correct failure:
 * a missing window shows the ordinary site, where a guessed one would
 * put diyas on the wrong fortnight.
 *
 * ── THE SEAM WITH APP ICONS ───────────────────────────────────────────
 * `iconKey` names the alternate app icon this theme would use. It is
 * NOT live: alternate icons must be compiled into the binary (iOS
 * `CFBundleAlternateIcons`, Android `activity-alias`), so only a NATIVE
 * store build can add one — an OTA cannot. The key is declared here so
 * the theme and its icon are named together in one place when a build
 * does carry them. See `docs/FESTIVE-THEMES.md`.
 */

export type FestiveThemeId = "diwali" | "christmas" | "holi";

/** AUTO follows the calendar; ON forces one on; OFF shows the plain site. */
export type FestiveThemeMode = "AUTO" | "ON" | "OFF";

export interface FestiveWindow {
  /** IST calendar dates, inclusive. */
  from: string;
  to: string;
}

export interface FestiveTheme {
  id: FestiveThemeId;
  /** Shown to admins and used in aria labels. */
  label: string;
  /** One line an admin can read to know what they are turning on. */
  blurb: string;
  /**
   * The accent the theme tints with — buttons keep the product's own
   * primary, so this drives glows, borders and the motif only.
   */
  accent: string;
  /** Second glow colour; the two are blended across the backdrop. */
  accentSoft: string;
  /** Text-safe version of the accent for labels ON THE BLACK canvas. */
  accentText: string;
  /** Motif drawn in the backdrop. Rendered differently per platform. */
  motif: "diyas" | "snow" | "colour-splash";
  /** Greeting used by themed surfaces that want one. Never auto-shown. */
  greeting: string;
  /**
   * Alternate app-icon key. Inert until a NATIVE build carries the
   * asset — see the note at the top of this file.
   */
  iconKey: string;
  /** Dated windows by year. Absent year = theme simply does not run. */
  windows: Record<string, FestiveWindow>;
}

/**
 * The themes.
 *
 * Windows open a few days BEFORE the festival and close a day or two
 * after, which is the pattern seasonal retail follows and the venue's
 * own campaigns already assume — the Diwali Bumper's push run opens on
 * 31 Oct for an offer that starts on 1 Nov.
 */
export const FESTIVE_THEMES: Record<FestiveThemeId, FestiveTheme> = {
  diwali: {
    id: "diwali",
    label: "Diwali",
    blurb: "Warm amber and gold, with diyas along the edges.",
    // Amber-400. On pure black this measures ~10.4:1, comfortably clear
    // of the 4.5:1 AA floor, so it is safe for small labels too.
    accent: "#fbbf24",
    accentSoft: "#f97316",
    accentText: "#fcd34d",
    motif: "diyas",
    greeting: "Happy Diwali",
    iconKey: "diwali",
    windows: {
      // Diwali 2026 is Sun 8 Nov (Lakshmi Puja), with the five days
      // running Dhanteras Fri 6 Nov → Bhai Dooj Wed 11 Nov. Verified
      // against published panchang, not recalled — same discipline as
      // lib/diwali-2026.ts, whose offer window this deliberately
      // matches so the skin and the discount start together.
      "2026": { from: "2026-11-01", to: "2026-11-11" },
    },
  },
  christmas: {
    id: "christmas",
    label: "Christmas",
    blurb: "Cool red and pine green, with a light snowfall.",
    // Red-400 (~7.0:1 on black). Deliberately not red-600, which is
    // both too close to the destructive colour and too dark to label.
    accent: "#f87171",
    accentSoft: "#34d399",
    accentText: "#fca5a5",
    motif: "snow",
    greeting: "Merry Christmas",
    iconKey: "christmas",
    windows: {
      // Fixed date, written down rather than computed so every theme
      // reads the same way and a year is never silently assumed.
      "2026": { from: "2026-12-18", to: "2026-12-26" },
    },
  },
  holi: {
    id: "holi",
    label: "Holi",
    blurb: "Colour splashes across the backdrop.",
    // Fuchsia-400 (~6.4:1 on black).
    accent: "#e879f9",
    accentSoft: "#38bdf8",
    accentText: "#f0abfc",
    motif: "colour-splash",
    greeting: "Happy Holi",
    iconKey: "holi",
    windows: {
      // Holi 2027: Dhulandi falls on Mon 22 Mar 2027 (Holika Dahan the
      // evening before). LUNAR — this moves every year and must be
      // re-verified, never extrapolated. Left as the only 2027 entry so
      // the next session sees the shape.
      "2027": { from: "2027-03-20", to: "2027-03-23" },
    },
  },
};

export const FESTIVE_THEME_IDS = Object.keys(FESTIVE_THEMES) as FestiveThemeId[];

/**
 * Which theme's window contains this IST calendar date, if any.
 *
 * `dayKey` is a bare `YYYY-MM-DD` in IST — the caller is responsible for
 * that conversion, because doing it here would mean this module had to
 * know about timezones and it is imported by the app bundle too. Web
 * passes `istDateKey(new Date())`; the app passes `getTodayIST()`.
 *
 * String comparison is correct and intentional: ISO dates sort
 * lexicographically, so no Date is constructed and the IST-vs-UTC trap
 * (gotchas 19 and 21) cannot reach this function at all.
 */
export function themeForDay(dayKey: string): FestiveTheme | null {
  const year = dayKey.slice(0, 4);
  for (const id of FESTIVE_THEME_IDS) {
    const theme = FESTIVE_THEMES[id];
    const w = theme.windows[year];
    if (w && dayKey >= w.from && dayKey <= w.to) return theme;
  }
  return null;
}

/**
 * The theme to render, given the admin's setting and today's IST date.
 *
 * The three modes mirror the rain banner's AUTO / ON / OFF, which the
 * venue already understands, and for the same reason: a calendar-driven
 * surface still needs a hand on it.
 *
 *   OFF   nothing, whatever the calendar says. The kill switch.
 *   ON    `override` if it names a real theme, otherwise whatever the
 *         calendar would have given. "ON with no choice" meaning "the
 *         current one" is what makes the admin's Preview button
 *         honest — they can force a theme early to look at it.
 *   AUTO  purely the calendar.
 *
 * Unknown mode strings resolve as AUTO rather than throwing: this is
 * read on the home page of a live venue, and a bad settings row must
 * degrade to the normal site, never to a 500.
 */
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

/**
 * Relative luminance per WCAG 2.1, for a `#rrggbb` string.
 *
 * Here so the palette above can be ASSERTED rather than eyeballed. A
 * festive accent is exactly the kind of colour that gets picked for
 * looking right in a mock and then fails on a phone in daylight, and
 * this codebase has already paid that once — see the note on
 * `subtleForeground` in the app's colour file.
 */
export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const channel = (i: number) => {
    const v = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** Contrast ratio of a colour against the product's black canvas. */
export function contrastOnBlack(hex: string): number {
  return (relativeLuminance(hex) + 0.05) / 0.05;
}
