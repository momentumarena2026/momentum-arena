"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCafeOpen } from "@/actions/cafe-settings";
import { Loader2 } from "lucide-react";

/**
 * Header-level switch on /admin/cafe-menu that flips
 * CafeSettings.isOpen. Renders as a real toggle switch (label on
 * the left, slider on the right) — NOT a chip/pill — so the
 * interaction reads as a binary switch the way the rest of the
 * admin surface does (the per-item availability slider lower on
 * the same page uses the same visual).
 *
 * The slider is fully optimistic: it flips immediately on tap, the
 * server action runs in a transition, and if the action returns
 * `{ ok: false, error }` we roll back and surface the error
 * inline. The action itself NEVER throws — it always returns a
 * serialisable result — so React's server-action error boundary
 * (which would surface as the "Server Components render" digest
 * error) can never be reached from this path.
 */
export function CafeOpenToggle({ initialOpen }: { initialOpen: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (pending) return;
    const next = !open;
    setOpen(next);
    setError(null);
    startTransition(async () => {
      const result = await setCafeOpen(next);
      if (!result.ok) {
        setOpen(!next);
        setError(result.error);
        return;
      }
      // Pull the new server-rendered state back so any sibling
      // server components (page header copy, etc) stay in sync
      // with the row we just updated.
      router.refresh();
    });
  }

  const label = open ? "Open for orders" : "Closed";
  const sublabel = open
    ? "Customers can place orders from /cafe."
    : "Customers see the closed page. Admin walk-ins still work.";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div
            className={`text-sm font-semibold ${
              open ? "text-emerald-300" : "text-zinc-400"
            }`}
          >
            {label}
          </div>
          <div className="text-[11px] text-zinc-500 max-w-[14rem]">
            {sublabel}
          </div>
        </div>
        {/* Toggle switch. Big enough to be unambiguous as a
            switch (h-7 w-12 vs the small per-item h-5 w-9), with a
            white knob that slides across. Click area is the entire
            track. */}
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          role="switch"
          aria-checked={open}
          aria-label={open ? "Close cafe" : "Open cafe"}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60 ${
            open
              ? "border-emerald-500/40 bg-emerald-600"
              : "border-zinc-700 bg-zinc-700"
          }`}
        >
          <span
            className={`inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow-sm transition-transform ${
              open ? "translate-x-6" : "translate-x-1"
            }`}
          >
            {pending ? (
              <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
            ) : null}
          </span>
        </button>
      </div>
      {error ? (
        <p className="text-[11px] text-red-400 max-w-[18rem] text-right">
          {error}
        </p>
      ) : null}
    </div>
  );
}
