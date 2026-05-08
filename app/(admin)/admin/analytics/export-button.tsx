"use client";

import { useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";

/**
 * Month-wise revenue + sales download. Renders a compact picker
 * (month select + year input) and a button that hits
 * /api/admin/export/monthly. Browser downloads the .xlsx via a
 * synthesised <a download> click — same trick the existing
 * invoice download flow uses.
 */
export function ExportButton() {
  const now = new Date();
  // Default to LAST month — admins usually want the just-closed
  // month's books, not the in-progress current one.
  const defaultMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const defaultYear =
    now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  const [month, setMonth] = useState(defaultMonth);
  const [year, setYear] = useState(defaultYear);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDownload() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/export/monthly?year=${year}&month=${month}`,
        );
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          setError(j?.error || `Download failed (${res.status})`);
          return;
        }
        const blob = await res.blob();
        // Pull filename from Content-Disposition or fall back.
        const cd = res.headers.get("Content-Disposition") ?? "";
        const fileFromHeader =
          /filename="([^"]+)"/.exec(cd)?.[1] ??
          `momentum-arena_${year}-${String(month).padStart(2, "0")}_revenue.xlsx`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileFromHeader;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Network error — try again.",
        );
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="block text-[10px] font-medium uppercase text-zinc-500">
          Month
        </label>
        <select
          value={month}
          onChange={(e) => setMonth(parseInt(e.target.value, 10))}
          disabled={pending}
          className="mt-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        >
          {MONTHS.map((m, i) => (
            <option key={i} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-medium uppercase text-zinc-500">
          Year
        </label>
        <input
          type="number"
          min={2024}
          max={now.getFullYear() + 1}
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value, 10))}
          disabled={pending}
          className="mt-1 w-20 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
      </div>
      <button
        onClick={handleDownload}
        disabled={pending}
        className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {pending ? "Generating…" : "Export Excel"}
      </button>
      {error && (
        <p className="basis-full text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
