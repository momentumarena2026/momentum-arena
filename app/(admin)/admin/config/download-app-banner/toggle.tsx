"use client";

import { useState, useTransition } from "react";
import { setDownloadAppBannerEnabled } from "@/actions/admin-download-app-banner";

export function DownloadAppBannerToggle({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const flip = () => {
    const next = !enabled;
    setEnabled(next); // optimistic
    setError(null);
    start(async () => {
      try {
        await setDownloadAppBannerEnabled(next);
      } catch {
        // Roll back rather than leave the switch lying about the DB.
        setEnabled(!next);
        setError("Couldn't save — try again.");
      }
    });
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={flip}
        disabled={pending}
        aria-pressed={enabled}
        className="flex w-full items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left transition-colors hover:border-zinc-700 disabled:opacity-60"
      >
        <span>
          <span className="block text-sm font-semibold text-white">
            Show download-app prompts
          </span>
          <span className="block text-xs text-zinc-400">
            {enabled
              ? "Visitors see the sticky strip, header icon and footer section."
              : "All three are hidden across the website."}
          </span>
        </span>
        <span
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            enabled ? "bg-emerald-500" : "bg-zinc-700"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </span>
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
