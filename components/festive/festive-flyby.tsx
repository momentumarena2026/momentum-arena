import { FESTIVE_THEMES, type FestiveThemeId } from "@/lib/festive-themes";
import { SantaSleigh, Diya } from "./festive-art";

/**
 * The one moving thing per festival: Santa's sleigh crossing for
 * Christmas, a row of lit diyas along the foot of the screen for
 * Diwali.
 *
 * ── WHY IT CROSSES AND DOES NOT LOOP CONSTANTLY ───────────────────────
 * Something that moves continuously in the corner of a booking flow is
 * a distraction and, on a page somebody is reading, an accessibility
 * problem. The sleigh crosses once every 45 seconds and is off-screen
 * the rest of the time, which is long enough to be a surprise rather
 * than wallpaper. `prefers-reduced-motion` parks it off-screen
 * entirely — see globals.css.
 *
 * The diyas do not travel; they sit along the bottom edge and breathe,
 * which is what an actual row of lamps does.
 */
export function FestiveFlyby({ theme }: { theme: FestiveThemeId | null }) {
  if (!theme) return null;
  const t = FESTIVE_THEMES[theme];

  if (theme === "christmas") {
    return (
      <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-24 z-[46] overflow-hidden">
        <div className="festive-sleigh">
          <SantaSleigh width={170} color={t.accent} />
        </div>
      </div>
    );
  }

  if (theme === "diwali") {
    // A row along the bottom edge, lifted clear of the fixed bottom nav
    // on phones so the lamps sit ON the ledge rather than behind it.
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[46] flex justify-around px-2 md:bottom-2"
      >
        {Array.from({ length: 7 }).map((_, i) => (
          <span
            key={i}
            className="festive-diya"
            style={{ animationDelay: `${i * 0.6}s` }}
          >
            <Diya size={i % 2 === 0 ? 34 : 27} />
          </span>
        ))}
      </div>
    );
  }

  return null;
}
