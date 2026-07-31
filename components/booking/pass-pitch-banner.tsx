import Link from "next/link";
import { Ticket, ArrowRight } from "lucide-react";
import type { PassPitch } from "@/lib/passes";
import { formatPrice } from "@/lib/pricing";

/**
 * "Play more, pay less" — the cheapest-hour pass pitch, shown on the
 * slot-selection page BEFORE the customer commits to the regular rate
 * (deliberately not at checkout, where a detour risks dropping the
 * payment). Data comes from the sport's admin-designated anchor plans
 * (PassPlan.upsellTimeType): morning = OFF_PEAK, night = PEAK.
 */
export function PassPitchBanner({ pitch }: { pitch: PassPitch }) {
  const sportTitle =
    pitch.sport.charAt(0) + pitch.sport.slice(1).toLowerCase();
  const name = pitch.planName ?? `${sportTitle} passes`;
  const m = pitch.morning;
  const n = pitch.night;

  return (
    <Link
      href="/passes"
      className="group relative block overflow-hidden rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-600/25 via-emerald-900/20 to-transparent p-4 shadow-[0_0_24px_rgba(16,185,129,0.15)] transition-all hover:border-emerald-400/60 hover:shadow-[0_0_32px_rgba(16,185,129,0.25)] sm:p-5"
    >
      <div className="flex items-start gap-3.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/30">
          <Ticket className="h-5.5 w-5.5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-snug text-white sm:text-lg">
            Play more, pay less with our {name}!
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">
            {m && n ? (
              <>
                Enjoy morning court hours at just{" "}
                <span className="font-bold text-emerald-400">
                  {formatPrice(m.withPass)}
                </span>{" "}
                and night sessions at{" "}
                <span className="font-bold text-emerald-400">
                  {formatPrice(n.withPass)}
                </span>
                . Save <span className="font-semibold text-white">{formatPrice(m.save)}</span>{" "}
                on morning bookings and{" "}
                <span className="font-semibold text-white">{formatPrice(n.save)}</span> on
                night bookings compared with regular rates.
              </>
            ) : m ? (
              <>
                Enjoy morning court hours at just{" "}
                <span className="font-bold text-emerald-400">
                  {formatPrice(m.withPass)}
                </span>{" "}
                — save <span className="font-semibold text-white">{formatPrice(m.save)}</span>{" "}
                per booking compared with regular rates.
              </>
            ) : n ? (
              <>
                Enjoy night sessions at just{" "}
                <span className="font-bold text-emerald-400">
                  {formatPrice(n.withPass)}
                </span>{" "}
                — save <span className="font-semibold text-white">{formatPrice(n.save)}</span>{" "}
                per booking compared with regular rates.
              </>
            ) : null}
          </p>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-emerald-950 transition-colors group-hover:bg-emerald-400">
            See passes and start playing for less
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}
