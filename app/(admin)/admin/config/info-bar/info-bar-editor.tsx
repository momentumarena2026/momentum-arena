"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Megaphone } from "lucide-react";
import { setInfoBar } from "@/actions/admin-arena-settings";

/** Information Bar control — on/off + custom copy, with a live preview
 *  styled exactly like the strip the home page renders. */
export function InfoBarEditor({
  initialEnabled,
  initialText,
  defaultText,
}: {
  initialEnabled: boolean;
  initialText: string | null;
  defaultText: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [text, setText] = useState(initialText ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty = enabled !== initialEnabled || text !== (initialText ?? "");
  const shown = text.trim() || defaultText;

  async function handleSave() {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      const result = await setInfoBar({ enabled, text: text.trim() || null });
      if (result.ok) {
        setSavedAt(new Date());
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      // A dev-server recompile can rotate action ids mid-session; a plain
      // reload re-binds. Never strand the button disabled.
      setError("Couldn't save — reload the page and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-emerald-400" />
          <span className="font-medium text-white">Show the bar</span>
        </div>
        <button
          onClick={() => setEnabled((v) => !v)}
          className={`relative h-6 w-11 rounded-full transition-colors ${enabled ? "bg-emerald-500" : "bg-zinc-700"}`}
          aria-pressed={enabled}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${enabled ? "left-[22px]" : "left-0.5"}`}
          />
        </button>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-400">
          Text (empty = default offer)
        </label>
        <textarea
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none"
          rows={2}
          maxLength={200}
          placeholder={defaultText}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="mt-1 text-[11px] text-zinc-500">{text.length}/200</p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-zinc-400">Preview</p>
        {enabled ? (
          <div className="rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-2 text-center">
            <p className="text-xs font-semibold text-white sm:text-sm">{shown}</p>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-zinc-700 px-4 py-2 text-center text-xs text-zinc-600">
            Hidden — the home page shows no bar.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
        {savedAt && !dirty && (
          <span className="text-xs text-emerald-400">Saved ✓</span>
        )}
      </div>
    </div>
  );
}
