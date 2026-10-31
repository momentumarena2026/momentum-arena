import { FESTIVE_THEMES, type FestiveThemeId } from "@/lib/festive-themes";
import { garlandUnit } from "./festive-art";

/**
 * The garland that hangs from the bottom edge of the site header, and
 * the festival wish underneath it.
 *
 * ── WHY IT LIVES IN THE HEADER AND NOT IN THE FIXED OVERLAY ───────────
 * A toran hangs from something. Rendered in the viewport-wide festive
 * overlay it would float over whatever happened to be scrolled under
 * it, which looks like a bug rather than decoration — and on a long
 * page it would sit across body text permanently.
 *
 * Hanging it from `SiteHeader`'s own sticky container means it is
 * attached to the thing it is decorating, moves with it, and occupies
 * the 40-odd pixels directly below the nav bar where there is never
 * anything to cover. `absolute top-full` keeps it out of the header's
 * own layout, so the nav does not grow by a pixel and nothing reflows
 * when a festival starts.
 *
 * `pointer-events-none`, like every other part of this feature.
 *
 * The count scales with nothing — 28 units across whatever width, which
 * reads as a dense garland on a phone and a generous one on a desktop.
 * Spacing is a percentage, so it never wraps or overflows.
 */
export function FestiveGarland({ theme }: { theme: FestiveThemeId | null }) {
  if (!theme) return null;
  const t = FESTIVE_THEMES[theme];
  const COUNT = 28;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-full z-10 select-none"
    >
      {/* The string itself. A gradient rather than a flat rule so it
          reads as thread catching the light rather than a border. */}
      <div
        className="h-px w-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${t.accent}, ${t.accentSoft}, ${t.accent}, transparent)`,
          opacity: 0.55,
        }}
      />
      <div className="relative h-10">
        {Array.from({ length: COUNT }).map((_, i) => (
          <span
            key={i}
            className="festive-hang absolute top-0 -translate-x-1/2"
            style={{
              left: `${((i + 0.5) / COUNT) * 100}%`,
              // Alternating drop lengths, so the garland scallops
              // instead of sitting in a straight line.
              paddingTop: i % 2 === 0 ? 0 : 7,
              animationDelay: `${(i % 7) * 0.45}s`,
            }}
          >
            {garlandUnit(theme, i)}
          </span>
        ))}
      </div>
      {/* The wish. Centred under the garland, small, and in the theme's
          text-safe accent — the one checked against the black canvas. */}
      <div className="flex justify-center">
        <span
          className="festive-greeting rounded-full px-3 py-0.5 text-[11px] font-medium tracking-wide"
          style={{
            color: t.accentText,
            backgroundColor: "rgba(0,0,0,0.55)",
            boxShadow: `0 0 18px -4px ${t.accent}`,
          }}
        >
          {t.greeting}
        </span>
      </div>
    </div>
  );
}
