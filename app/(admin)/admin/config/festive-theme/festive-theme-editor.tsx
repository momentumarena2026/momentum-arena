"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { setFestiveTheme } from "@/actions/admin-arena-settings";
import type { FestiveThemeId, FestiveThemeMode } from "@/lib/festive-themes";

interface ThemeOption {
  id: FestiveThemeId;
  label: string;
  blurb: string;
  accent: string;
  accentSoft: string;
  window: { from: string; to: string } | null;
}

const MODES: { value: FestiveThemeMode; label: string; help: string }[] = [
  {
    value: "AUTO",
    label: "Auto",
    help: "Follow the calendar — each theme appears inside its own dates and goes away after.",
  },
  {
    value: "ON",
    label: "Force on",
    help: "Show a theme now, whatever the date. Useful to look at one before its window opens.",
  },
  {
    value: "OFF",
    label: "Off",
    help: "No theme anywhere, even during a festival. The kill switch.",
  },
];

function pretty(day: string): string {
  return new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

/**
 * Festive theme control.
 *
 * The preview is a real swatch of the two glow colours rather than a
 * word, because "Diwali" tells an admin nothing about what the site is
 * about to look like. It is deliberately NOT a full-page preview: the
 * backdrop is a layer, so the honest preview is the site itself, and
 * Force on exists so they can go and look at it.
 */
export function FestiveThemeEditor({
  initialMode,
  initialOverride,
  today,
  calendarThemeId,
  themes,
}: {
  initialMode: FestiveThemeMode;
  initialOverride: FestiveThemeId | null;
  today: string;
  calendarThemeId: FestiveThemeId | null;
  themes: ThemeOption[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<FestiveThemeMode>(initialMode);
  const [override, setOverride] = useState<FestiveThemeId | null>(initialOverride);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty = mode !== initialMode || override !== initialOverride;

  // What the customer would see if this were saved right now. Mirrors
  // resolveFestiveTheme — kept in the same shape so the two are easy to
  // compare, since a preview that disagrees with the renderer is worse
  // than no preview.
  const effective: FestiveThemeId | null =
    mode === "OFF" ? null : mode === "ON" ? (override ?? calendarThemeId) : calendarThemeId;
  const effectiveTheme = themes.find((t) => t.id === effective) ?? null;

  async function handleSave() {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      const result = await setFestiveTheme({ mode, override });
      if (result.ok) {
        setSavedAt(new Date());
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      // A dev-server recompile can rotate action ids mid-session; a
      // plain reload re-binds. Never strand the button disabled.
      setError("Couldn't save — reload the page and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-emerald-400" />
        <span className="font-medium text-white">How the theme is chosen</span>
      </div>

      <div className="space-y-2">
        {MODES.map((m) => (
          <label
            key={m.value}
            className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
              mode === m.value
                ? "border-emerald-500/60 bg-emerald-500/5"
                : "border-zinc-800 hover:border-zinc-700"
            }`}
          >
            <input
              type="radio"
              name="festive-mode"
              className="mt-1 accent-emerald-500"
              checked={mode === m.value}
              onChange={() => setMode(m.value)}
            />
            <span>
              <span className="block text-sm font-medium text-white">{m.label}</span>
              <span className="block text-xs text-zinc-400">{m.help}</span>
            </span>
          </label>
        ))}
      </div>

      {mode === "ON" && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400">Which theme</p>
          {themes.map((t) => (
            <label
              key={t.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                override === t.id
                  ? "border-emerald-500/60 bg-emerald-500/5"
                  : "border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <input
                type="radio"
                name="festive-theme"
                className="accent-emerald-500"
                checked={override === t.id}
                onChange={() => setOverride(t.id)}
              />
              <span
                aria-hidden="true"
                className="h-6 w-6 shrink-0 rounded-full"
                style={{
                  background: `linear-gradient(135deg, ${t.accent}, ${t.accentSoft})`,
                }}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-white">{t.label}</span>
                <span className="block text-xs text-zinc-400">{t.blurb}</span>
                <span className="block text-xs text-zinc-500">
                  {t.window
                    ? `Runs ${pretty(t.window.from)} – ${pretty(t.window.to)}`
                    : "No dates set for this year"}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      {/* What is actually live. Stated plainly because the three modes
          interact with the calendar, and "Auto" alone does not tell an
          admin whether anything is showing today. */}
      <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
        <p className="text-xs text-zinc-400">
          Today is {pretty(today)}. With these settings the site and the app
          would show:
        </p>
        <p className="mt-1 flex items-center gap-2 text-sm font-medium text-white">
          {effectiveTheme ? (
            <>
              <span
                aria-hidden="true"
                className="h-4 w-4 rounded-full"
                style={{
                  background: `linear-gradient(135deg, ${effectiveTheme.accent}, ${effectiveTheme.accentSoft})`,
                }}
              />
              {effectiveTheme.label}
            </>
          ) : (
            <span className="text-zinc-300">No theme — the ordinary site</span>
          )}
        </p>
      </div>

      {/* The app caveat. An admin who saves this and then opens their
          phone has to know the two surfaces do not move at the same
          speed, or they report it as broken — which is exactly what
          happened with the Information Bar. */}
      <p className="text-xs text-zinc-500">
        The website changes immediately. The app picks it up within about
        five minutes, or straight away if it is reopened.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </button>
        {savedAt && !dirty && (
          <span className="text-xs text-zinc-500">
            Saved {savedAt.toLocaleTimeString("en-IN")}
          </span>
        )}
      </div>
    </div>
  );
}
