import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { Coffee, Clock, ArrowRight, IndianRupee } from "lucide-react";

/**
 * Customer-facing "Cafe is closed" page. Renders when
 * CafeSettings.isOpen is false. Used by both the web `/cafe`
 * route and (via its content; copied into the RN screen) the
 * mobile Cafe tab so the surfaces stay in lockstep visually.
 *
 * Goals: warmth, not apology — a closed cafe shouldn't read as
 * an error. Plus a clear nudge toward sport bookings since that's
 * the venue's other primary revenue surface and the customer is
 * already on the home domain.
 */
export function CafeClosedPage() {
  return (
    <div className="relative mx-auto max-w-2xl space-y-6 p-4">
      <BackButton
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white"
        label="Back"
      />

      {/* Hero card — amber-cream palette to suggest warmth even
          while closed, plus a soft layered glow so the page
          doesn't read as a flat error state. */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-orange-500/5 p-8 sm:p-12">
        {/* Decorative glow blobs — purely aesthetic, hidden from
            assistive tech. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-amber-500/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -left-12 h-56 w-56 rounded-full bg-orange-500/15 blur-3xl"
        />

        <div className="relative text-center">
          <div className="mx-auto mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/15 shadow-inner">
            <Coffee className="h-8 w-8 text-amber-300" />
          </div>

          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            The Cafe is taking a breather
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-zinc-300 sm:text-base">
            We&apos;re not accepting online orders right now. Pop back in a
            bit — fresh batches are on the way.
          </p>

          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-zinc-900/60 px-4 py-1.5 text-xs font-medium text-amber-200">
            <Clock className="h-3.5 w-3.5" />
            Currently closed
          </div>
        </div>
      </div>

      {/* Cross-sell — point the visitor at the sports booking
          flow so the trip to the venue still feels productive. */}
      <Link
        href="/book"
        className="group block rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 transition-all hover:border-emerald-500/50 hover:bg-emerald-500/10"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10">
            <IndianRupee className="h-5 w-5 text-emerald-300" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-300">
              Book a court while you wait
            </p>
            <p className="mt-0.5 text-xs text-zinc-400">
              Cricket, football and pickleball turfs are open — reserve a
              slot in under a minute.
            </p>
          </div>
          <ArrowRight className="mt-1.5 h-4 w-4 shrink-0 text-emerald-300 transition-transform group-hover:translate-x-0.5" />
        </div>
      </Link>

      <p className="text-center text-[11px] text-zinc-600">
        Already at the venue? Walk up to the cafe counter — staff can take
        your order in person.
      </p>
    </div>
  );
}
