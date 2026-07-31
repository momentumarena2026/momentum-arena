import Link from "next/link";
import { Ticket, ArrowRight } from "lucide-react";
import type { PassUpsell } from "@/lib/passes";
import { formatPrice } from "@/lib/pricing";

/**
 * The "tiny thought" at checkout: the customer has picked their slot
 * and is about to pay full price — this strip shows that the very same
 * hour costs less from the sport's designated cheapest-hour pass
 * (PassPlan.upsellTimeType, set by the admin per sport for peak and
 * off-peak). Rendered ONLY when the customer holds no usable pass;
 * pass owners see PassCheckoutOption in this slot instead.
 */
export function PassUpsellNudge({
  upsell,
  slotMinutes,
}: {
  upsell: PassUpsell;
  slotMinutes: number;
}) {
  const unit = slotMinutes === 60 ? "hour" : `${slotMinutes}-min slot`;
  return (
    <Link
      href="/passes"
      className="group flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 transition-colors hover:bg-emerald-500/15"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
        <Ticket className="h-4.5 w-4.5 text-emerald-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">
          Get this same {unit} {formatPrice(upsell.savePerSlot)} cheaper
        </p>
        <p className="mt-0.5 text-xs text-zinc-400">
          With the {upsell.planName} this {unit} costs{" "}
          <span className="font-semibold text-emerald-400">
            {formatPrice(upsell.slotPriceWithPass)}
          </span>{" "}
          instead of {formatPrice(upsell.slotPriceNow)}
          {upsell.matchedSlots > 1 && (
            <> — {formatPrice(upsell.saveTotal)} off this whole booking</>
          )}
        </p>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-400">
        See passes
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
