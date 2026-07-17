"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CloudRain, Loader2 } from "lucide-react";
import { setRainBanner, type RainBannerMode } from "@/actions/admin-arena-settings";

/**
 * "Rain doesn't slow us down" banner control. Lives on /admin/pricing
 * beside the arena hours (both are ArenaSettings). Sets the display mode
 * and optional custom copy for the homepage + booking-page banner.
 *
 *   AUTO — show only when it's raining / forecast rain in Mathura
 *   ON   — always show (e.g. during monsoon week)
 *   OFF  — never show
 */
const MODES: { value: RainBannerMode; label: string; hint: string }[] = [
  { value: "AUTO", label: "Auto (weather)", hint: "Shows only when it's raining in Mathura" },
  { value: "ON", label: "Always on", hint: "Force the banner on regardless of weather" },
  { value: "OFF", label: "Off", hint: "Never show the banner" },
];

export function RainBannerEditor({
  initialMode,
  initialText,
}: {
  initialMode: RainBannerMode;
  initialText: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<RainBannerMode>(initialMode);
  const [text, setText] = useState(initialText ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty = mode !== initialMode || text !== (initialText ?? "");

  async function handleSave() {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    const result = await setRainBanner({ mode, text: text.trim() || null });
    setSaving(false);
    if (result.ok) {
      setSavedAt(new Date());
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <CloudRain className="h-4 w-4 text-sky-400" />
          &ldquo;Rain doesn&apos;t slow us down&rdquo; banner
        </h2>
        <p className="mt-1 text-xs text-zinc-400 max-w-xl">
          A weather-aware strip on the homepage + booking page promoting your
          quick-drain, all-weather turf. On <span className="font-semibold">Auto</span>{" "}
          it appears only when it&apos;s actually raining (or rain&apos;s
          forecast) in Mathura — turning rainy evenings into booking prompts.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setMode(m.value)}
            className={`rounded-lg border p-3 text-left transition-colors ${
              mode === m.value
                ? "border-sky-500/50 bg-sky-500/10"
                : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
            }`}
          >
            <span
              className={`block text-sm font-semibold ${
                mode === m.value ? "text-sky-300" : "text-zinc-200"
              }`}
            >
              {m.label}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
              {m.hint}
            </span>
          </button>
        ))}
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          Banner message (optional)
        </span>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder="Designed for quick drainage and uninterrupted play — book your slot."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
        />
        <span className="mt-1 block text-[11px] text-zinc-500">
          Leave blank to use the default. The title auto-adjusts (e.g. &ldquo;It&apos;s
          raining in Mathura right now&rdquo; on Auto).
        </span>
      </label>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {savedAt && !dirty ? (
        <p className="text-xs text-emerald-400">
          Saved at {savedAt.toLocaleTimeString("en-IN")}.
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save banner
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={() => {
              setMode(initialMode);
              setText(initialText ?? "");
              setError(null);
            }}
            className="text-xs text-zinc-400 hover:text-zinc-200"
          >
            Reset
          </button>
        ) : null}
      </div>
    </section>
  );
}
