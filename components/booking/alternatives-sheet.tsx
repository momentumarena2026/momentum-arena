"use client";

import { useRouter } from "next/navigation";
import { X, ArrowRight, Bell, AlertCircle } from "lucide-react";
import {
  alternativeShortLabel,
  formatHourRangeCompact,
  summarizeBlockers,
} from "@/lib/court-config";
import type { SlotAvailability } from "@/lib/availability";

/**
 * Pop-up that explains a soft-blocked slot — what's specifically
 * taken on this court, AND which sibling courts are still
 * bookable at the exact same hour with a one-tap pivot.
 *
 * Rendered when the customer taps an amber-coloured tile in the
 * SlotGrid. Hidden when `slot` is null (controlled by parent).
 *
 * Pivot lands on the alternative court's slot-selection page with
 * the same date pre-loaded via the `?date=YYYY-MM-DD` query. The
 * receiving page's mount-time selectedDate initialiser reads the
 * param.
 *
 * Falls back to a "Notify me on this exact court" affordance when
 * the alternatives don't fit (e.g., the user really wanted the
 * full field — they can still join the waitlist for it).
 */
export function AlternativesSheet({
  slot,
  sport,
  selectedDate,
  onClose,
  onNotifyMe,
}: {
  slot: SlotAvailability | null;
  sport: string; // lowercase URL slug
  selectedDate: string; // YYYY-MM-DD
  onClose: () => void;
  onNotifyMe?: (hour: number) => void;
}) {
  const router = useRouter();

  if (!slot || !slot.blockedReason) return null;

  const { blockedBy, alternativesAtThisHour } = slot.blockedReason;
  const reasonTag = summarizeBlockers(blockedBy);

  function pivot(configId: string) {
    router.push(`/book/${sport}/${configId}?date=${selectedDate}`);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              {formatHourRangeCompact(slot.hour)}
            </p>
            <h3 className="mt-0.5 text-base font-semibold text-white">
              {reasonTag}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {alternativesAtThisHour.length > 0 ? (
          <>
            <p className="mb-2 text-xs text-zinc-400">
              Still bookable at this hour:
            </p>
            <ul className="space-y-2">
              {alternativesAtThisHour.map((alt) => (
                <li key={alt.configId}>
                  <button
                    type="button"
                    onClick={() => pivot(alt.configId)}
                    className="group flex w-full items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-left transition-all hover:border-emerald-400/50 hover:bg-emerald-500/15"
                  >
                    <div>
                      <p className="text-sm font-semibold text-emerald-300">
                        {alt.label}
                      </p>
                      <p className="text-[11px] text-emerald-300/70">
                        {alternativeShortLabel(alt)}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-emerald-300 transition-transform group-hover:translate-x-0.5" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="flex items-start gap-2 rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-xs text-zinc-400">
            <AlertCircle className="h-4 w-4 shrink-0 text-zinc-500" />
            <span>No alternative courts are free at this hour.</span>
          </div>
        )}

        {onNotifyMe && (
          <button
            type="button"
            onClick={() => {
              onNotifyMe(slot.hour);
              onClose();
            }}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-500/10"
          >
            <Bell className="h-3.5 w-3.5" />
            Notify me for this exact court
          </button>
        )}
      </div>
    </div>
  );
}
