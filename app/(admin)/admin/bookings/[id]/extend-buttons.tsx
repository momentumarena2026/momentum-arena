"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  X,
  Clock,
} from "lucide-react";
import { extendBookingByThirtyMin } from "@/actions/admin-booking";

type Direction = "before" | "after";

/**
 * Two compact buttons under "Manage this booking" that let an admin
 * grow the booking window by 30 min — either by giving the court 30
 * min early (move start back) or by extending the end (stay 30 min
 * later). The everyday "they want to keep playing till 9:30" case.
 *
 * Why a separate control instead of folding into the full Edit modal:
 * the existing modal forces the admin to re-pick every hour from a
 * grid. For the common "+30 either side" case that's enough friction
 * that staff give up and just don't record the extension at all — so
 * the slot calendar drifts from venue reality and adjacent slots
 * silently get double-booked. One tap + a price input fixes the
 * recording, the conflict-check on the server-side prevents the
 * double-book.
 *
 * Pricing: the suggested price (half the adjacent slot's hourly rate
 * for hourly bookings; same as the slot for bowling's already-30-min
 * slots) is computed server-side and passed in as a prop. The admin
 * can override to 0 (free / goodwill) or any positive integer.
 */
export function ExtendBookingControls({
  bookingId,
  bookingStatus,
  suggestedBeforePrice,
  suggestedAfterPrice,
  pass,
}: {
  bookingId: string;
  bookingStatus: string;
  suggestedBeforePrice: number;
  suggestedAfterPrice: number;
  /** Eligible pass for a pass-paid extension (≥30 min, this court),
   *  or null when none / guest booking. */
  pass?: { id: string; name: string; remainingMinutes: number } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Direction | null>(null);
  const [price, setPrice] = useState("");
  const [usePass, setUsePass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Extensions only make sense for live bookings. Cancelled / completed /
  // refunded bookings hide the control entirely (cleaner than disabling).
  if (!["CONFIRMED", "PENDING"].includes(bookingStatus)) {
    return null;
  }

  function openDialog(dir: Direction) {
    setOpen(dir);
    setPrice(
      String(dir === "before" ? suggestedBeforePrice : suggestedAfterPrice),
    );
    setUsePass(false);
    setError(null);
  }

  function closeDialog() {
    if (pending) return;
    setOpen(null);
    setError(null);
  }

  function submit() {
    if (!open) return;
    // Pass path: no price — 30 min is debited from the pass server-side.
    if (usePass && pass) {
      startTransition(async () => {
        const res = await extendBookingByThirtyMin(
          bookingId,
          open,
          0,
          pass.id,
        );
        if (!res.success) {
          setError(res.error);
          return;
        }
        setOpen(null);
        router.refresh();
      });
      return;
    }
    const parsed = Number.parseInt(price, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      setError("Price must be a non-negative whole number");
      return;
    }
    startTransition(async () => {
      const res = await extendBookingByThirtyMin(bookingId, open, parsed);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setOpen(null);
      router.refresh();
    });
  }

  const dialogTitle =
    open === "before"
      ? "Give court 30 min early"
      : open === "after"
        ? "Extend 30 min after end"
        : "";

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-zinc-400" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Extend by 30 min
        </h2>
      </div>
      <p className="text-xs text-zinc-500 -mt-1">
        For walk-in early starts or late stays. Conflicts with adjacent
        bookings are hard-blocked.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => openDialog("before")}
          disabled={pending}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
        >
          <ChevronLeft className="h-4 w-4" />
          +30 min earlier
        </button>
        <button
          type="button"
          onClick={() => openDialog("after")}
          disabled={pending}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
        >
          +30 min later
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div
          // Lightweight modal — backdrop click closes; ESC handled via
          // the keydown bubble.
          role="dialog"
          aria-modal="true"
          onKeyDown={(e) => {
            if (e.key === "Escape") closeDialog();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={closeDialog}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-950 p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">
                {dialogTitle}
              </h3>
              <button
                type="button"
                onClick={closeDialog}
                disabled={pending}
                className="text-zinc-500 hover:text-zinc-200 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Pass-paid option — only when the customer holds an
                eligible pass for this court with ≥30 min left. Selecting
                it debits 30 min from the pass instead of charging. */}
            {pass && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <input
                  type="checkbox"
                  checked={usePass}
                  onChange={(e) => setUsePass(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-emerald-500"
                />
                <span className="text-xs">
                  <span className="font-semibold text-white">
                    Pay with pass — {pass.name}
                  </span>
                  <span className="block text-zinc-400">
                    Deducts 30 min ·{" "}
                    {(pass.remainingMinutes / 60)
                      .toFixed(1)
                      .replace(/\.0$/, "")}
                    h left → will show{" "}
                    {((pass.remainingMinutes - 30) / 60)
                      .toFixed(1)
                      .replace(/\.0$/, "")}
                    h after
                  </span>
                </span>
              </label>
            )}

            <div className={`space-y-1.5 ${usePass ? "opacity-40" : ""}`}>
              <label className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
                {usePass ? "Charge (covered by pass)" : "Charge for the extra 30 min (₹)"}
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={usePass ? "0" : price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={usePass}
                autoFocus={!usePass}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 disabled:cursor-not-allowed"
                placeholder="0"
              />
              <p className="text-[11px] text-zinc-500">
                Pre-filled with half the adjacent slot&apos;s rate. Set 0 for a
                free / courtesy extension; any other number is added to the
                booking total and shown as a remainder for venue collection.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-200">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={closeDialog}
                disabled={pending}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {pending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Extending…
                  </>
                ) : (
                  "Apply"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
