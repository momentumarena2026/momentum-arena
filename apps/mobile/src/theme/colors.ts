/**
 * Mirror of the web app's dark theme (app/globals.css :root).
 *
 * The web uses OKLCH values; those translate very closely to Tailwind's
 * zinc + emerald palette, so we reuse the standard Tailwind hex equivalents.
 */
export const colors = {
  // Surfaces
  background: "#000000",
  card: "#0a0a0a",
  cardElevated: "#121212",
  popover: "#0a0a0a",
  border: "#262626",
  borderStrong: "#3f3f46",
  muted: "#18181b",

  // Text
  foreground: "#fafafa",
  mutedForeground: "#a1a1aa",
  subtleForeground: "#71717a",

  // Accent — emerald (matches --primary: oklch(0.6 0.18 155))
  primary: "#10b981",
  primaryHover: "#059669",
  primaryPressed: "#047857",
  primaryForeground: "#052e16",
  primarySoft: "rgba(16, 185, 129, 0.12)",

  // Tailwind emerald — used by web for slot tiles + selected-date highlight.
  emerald400: "#34d399",
  emerald500: "#10b981",
  emerald500_05: "rgba(16, 185, 129, 0.05)",
  emerald500_10: "rgba(16, 185, 129, 0.10)",
  emerald500_20: "rgba(16, 185, 129, 0.20)",
  emerald500_30: "rgba(16, 185, 129, 0.30)",
  emerald400_50: "rgba(52, 211, 153, 0.50)",

  // Tailwind zinc — web's neutral greys for unavailable tiles, dividers,
  // secondary text. Mirror every zinc step the web uses.
  zinc300: "#d4d4d8",
  zinc400: "#a1a1aa",
  zinc500: "#71717a",
  zinc600: "#52525b",
  zinc700: "#3f3f46",
  zinc800: "#27272a",
  zinc800_50: "rgba(39, 39, 42, 0.50)",
  zinc900: "#18181b",

  // Weekend day-name tint on the date picker (web: text-yellow-400).
  yellow400: "#facc15",
  yellow500: "#eab308",

  // Semantic
  destructive: "#ef4444",
  destructiveSoft: "rgba(239, 68, 68, 0.12)",
  warning: "#f59e0b",
  warningSoft: "rgba(245, 158, 11, 0.12)",

  // Overlays
  overlay: "rgba(0, 0, 0, 0.6)",

  // White-ish transparents (for chips / dividers)
  divider: "rgba(255, 255, 255, 0.08)",
  inputBackground: "#0f0f12",
} as const;

export type ColorToken = keyof typeof colors;
