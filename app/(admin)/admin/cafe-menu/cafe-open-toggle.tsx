"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
 *
 * Resilience note — `setCafeOpen` is wrapped in a server-side
 * try/catch that re-throws as a plain Error with a readable
 * message. We catch it here and render it as a small red caption;
 * without that pair the throw would bubble through React 19's
 * server-action error path and surface as the generic "Server
 * Components render" digest error the user has no way to act on.
 */
export function CafeOpenToggle({ initialOpen }: { initialOpen: boolean }) {
  const router = useRouter();
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
        // Pull the new server-rendered state back so the page-
        // level `isOpen` prop and any sibling components stay in
        // sync with the row we just updated. revalidatePath inside
        // the action handles the cache layer; this forces the
        // current route to re-fetch immediately rather than wait
        // for the next navigation.
        router.refresh();
      } catch (err) {
        setOpen(!next);
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Couldn't update — please try again.",
        );
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
