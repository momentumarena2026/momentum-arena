"use client";

import { useState, useTransition } from "react";
import { setCafeOpen } from "@/actions/cafe-settings";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

/**
 * Header-level toggle on /admin/cafe-menu that flips
 * CafeSettings.isOpen. Live status (the customer-facing /cafe
 * surface and the mobile Cafe tab) reads this on every render so
 * the change reflects within a refresh.
 *
 * Optimistic flip: we update the local state immediately so the
 * pill switches colour the moment the admin taps; if the server
 * rejects (e.g. auth lapsed) we roll back and surface the
 * error inline.
 */
export function CafeOpenToggle({ initialOpen }: { initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !open;
    // Optimistic — flip first so the pill feels instant; revert
    // below if the server-side action throws.
    setOpen(next);
    setError(null);
    startTransition(async () => {
      try {
        await setCafeOpen(next);
      } catch (err) {
        setOpen(!next);
        setError(err instanceof Error ? err.message : "Couldn't update");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={open}
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50 ${
          open
            ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
            : "border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/15"
        }`}
        title={
          open
            ? "Cafe is OPEN — customers can place orders. Tap to close."
            : "Cafe is CLOSED — customers see the closed page. Tap to open."
        }
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : open ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : (
          <XCircle className="h-3.5 w-3.5" />
        )}
        {open ? "Open for orders" : "Closed"}
      </button>
      {error ? <p className="text-[10px] text-red-400">{error}</p> : null}
    </div>
  );
}
