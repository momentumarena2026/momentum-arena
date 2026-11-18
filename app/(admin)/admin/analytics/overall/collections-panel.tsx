import Link from "next/link";
import { Banknote, Landmark, HelpCircle, Wallet } from "lucide-react";
import type { CollectionsResult } from "@/actions/admin-collections";
import { CollectionsDayTable } from "./collections-day-table";

/**
 * Cash vs online, day by day — the till-and-bank tally.
 *
 * Reconciliation, not profit: what came in as notes, and what landed in
 * the account, on the day it actually changed hands. The P&L above books
 * a booking's income on the PLAY date; this books it the day the money
 * arrived. The two are supposed to differ.
 *
 * Newest day first, because the day being counted is today's or
 * yesterday's, and nobody should have to scroll to it.
 */
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function CollectionsPanel({
  data,
  chips,
  activeChip,
}: {
  data: CollectionsResult;
  chips: { label: string; href: string; key: string }[];
  activeChip: string | null;
}) {
  const { days, totals, bySource } = data;
  // Only ever shown when it is non-zero: an "Unattributed ₹0" column on
  // every screen would train the eye to ignore the one time it matters.
  const showUnattributed = totals.unattributed > 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Cash vs online — collections
          </h2>
          <p className="mt-0.5 text-sm text-zinc-400">
            Money the day it actually arrived, for tallying the till and the
            bank. Not the same basis as the P&amp;L above, which books income
            on the play date.
          </p>
        </div>
      </div>

      {/* Quick ranges + the exact dates behind them. */}
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              activeChip === c.key
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            }`}
          >
            {c.label}
          </Link>
        ))}
        <span className="ml-1 text-xs text-zinc-600">
          {data.from === data.to
            ? dayLabel(data.from)
            : `${dayLabel(data.from)} — ${dayLabel(data.to)}`}
        </span>
      </div>

      {/* Exact range, for anything the chips don't cover. */}
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="col-from"
            className="block text-[11px] font-medium text-zinc-500"
          >
            From
          </label>
          <input
            id="col-from"
            type="date"
            name="from"
            defaultValue={data.from}
            className="mt-1 rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm text-white"
          />
        </div>
        <div>
          <label
            htmlFor="col-to"
            className="block text-[11px] font-medium text-zinc-500"
          >
            To
          </label>
          <input
            id="col-to"
            type="date"
            name="to"
            defaultValue={data.to}
            className="mt-1 rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm text-white"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
        >
          Apply
        </button>
      </form>

      {/* Totals for the range — the two numbers being reconciled. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-amber-300/80">
            <Banknote className="h-3.5 w-3.5" />
            Cash in hand
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-amber-300">
            {inr(totals.cash)}
          </div>
        </div>
        <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-4">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-sky-300/80">
            <Landmark className="h-3.5 w-3.5" />
            Online / to account
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-sky-300">
            {inr(totals.online)}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            <Wallet className="h-3.5 w-3.5" />
            Collected in all
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-white">
            {inr(totals.total)}
          </div>
        </div>
      </div>

      {showUnattributed ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/90">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            {inr(totals.unattributed)} was collected with no payment method
            recorded, so it is counted in the total but belongs to neither
            column. It is listed separately below rather than guessed into one.
          </span>
        </p>
      ) : null}

      {/* Day by day — each row opens into where that day's money came
          from, which is the question a till check actually asks. */}
      <CollectionsDayTable
        days={days}
        totals={totals}
        showUnattributed={showUnattributed}
      />

      {/* Where it came from, so a figure that looks wrong can be traced. */}
      {bySource.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/60 text-[11px] uppercase tracking-wide text-zinc-500">
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Where it came from (whole range)
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Cash
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Online
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {bySource.map((s) => (
                <tr
                  key={s.source}
                  className="border-b border-zinc-800/60 last:border-0"
                >
                  <th
                    scope="row"
                    className="px-4 py-2 text-left font-medium text-zinc-300"
                  >
                    {s.source}
                  </th>
                  <td className="px-4 py-2 text-right text-amber-300/90">
                    {s.cash > 0 ? inr(s.cash) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right text-sky-300/90">
                    {s.online > 0 ? inr(s.online) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-white">
                    {inr(s.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data.splitRemainders > 0 ? (
        <p className="text-[11px] leading-relaxed text-zinc-600">
          Venue-side balances are dated from the collection recorded against
          the booking, not from when the advance was taken — that is where
          most counter cash comes from. {data.splitRemainders} bookings were
          collected over two visits; their whole balance is dated to the later
          one, because the per-visit amounts exist only inside the note text.
        </p>
      ) : null}
    </section>
  );
}
