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
    // DESKTOP ONLY, and that is a real constraint rather than a
    // preference. On a phone the bottom of the web viewport is taken by
    // the fixed 73px bottom nav, so a row of lamps has nowhere to
    // stand: high enough to clear the nav and they sit on the Camps and
    // Tournaments buttons, obscuring the labels; low enough to miss the
    // buttons and the nav draws over them. A decoration covering a
    // control is worse than no decoration, so on phones the garland and
    // the glows carry the festival and the lamps sit this one out.
    //
    // The APP keeps its row, because its tab bar is a genuine ledge
    // with clear space above it.
    return (
      <div
        aria-hidden="true"
        // 60%, not 80%. Even on desktop this is a FIXED row over a
        // SCROLLING page, so sooner or later it sits on top of
        // something — there is no bottom ledge here the way the app has
        // a tab bar. At this weight it reads as lamplight along the
        // bottom edge and a label underneath stays legible, which is
        // the difference between decoration and obstruction.
        className="pointer-events-none fixed inset-x-0 bottom-1 z-[46] hidden justify-around px-3 opacity-60 md:flex"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className="festive-diya"
            style={{ animationDelay: `${i * 0.7}s` }}
          >
            <Diya size={i % 2 === 0 ? 28 : 22} />
          </span>
        ))}
      </div>
    );
  }

  return null;
}
