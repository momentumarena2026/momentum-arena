import { getFestiveThemeConfig } from "@/actions/admin-arena-settings";
import {
  FESTIVE_THEME_IDS,
  FESTIVE_THEMES,
  themeForDay,
} from "@/lib/festive-themes";
import { istDateKey } from "@/lib/ist";
import { FestiveThemeEditor } from "./festive-theme-editor";

/**
 * Web & App Config → Festive Theme. The seasonal skin on the website
 * and the app — Diwali, Christmas, Holi.
 */
export default async function AdminFestiveThemePage() {
  const config = await getFestiveThemeConfig();
  const today = istDateKey(new Date());
  const calendarTheme = themeForDay(today);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Festive Theme</h1>
        <p className="mt-1 text-zinc-400">
          The seasonal skin on the website and the app — a tinted backdrop
          behind the normal site. Nothing moves and no copy changes; it is a
          layer, so turning it off puts everything back instantly.
        </p>
      </div>
      <FestiveThemeEditor
        initialMode={config.mode}
        initialOverride={config.override}
        today={today}
        calendarThemeId={calendarTheme?.id ?? null}
        themes={FESTIVE_THEME_IDS.map((id) => {
          const t = FESTIVE_THEMES[id];
          return {
            id: t.id,
            label: t.label,
            blurb: t.blurb,
            accent: t.accent,
            accentSoft: t.accentSoft,
            // Only the window for the current IST year is shown — a list
            // of every year a theme has ever had is noise to an admin
            // deciding what is on today.
            window: t.windows[today.slice(0, 4)] ?? null,
          };
        })}
      />
    </div>
  );
}
