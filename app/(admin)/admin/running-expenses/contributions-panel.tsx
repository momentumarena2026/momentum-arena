import { Users, ArrowLeftRight, Building2 } from "lucide-react";
import { formatExpenseAmount } from "@/lib/expenses";
import type { ExpenseContributions } from "@/actions/admin-expenses";

/**
 * Who fronted the money, and what the venture owes each of them.
 *
 * The venture reimburses whoever paid out of their own pocket, monthly.
 * That figure used to be arrived at by filtering the list to one person,
 * reading the rows off the screen and adding them up — once per person,
 * every month.
 *
 * Two readings, because the question gets asked both ways:
 *
 *  - Per person across whatever is filtered, at the top: "what do we owe
 *    Anand for this range".
 *  - Per month below, one row per month and one column per person, so
 *    the amount to transfer for any month is read off directly without
 *    touching a filter. Newest month first — that is the one being
 *    settled.
 *
 * Spend the venture paid from its own account is shown SEPARATELY and
 * never inside a "to transfer" figure: it is already settled, and
 * including it would propose paying the company back to itself. It is
 * still displayed, because "this month cost 66k, of which 46k is owed to
 * Nakul" is the useful sentence — and because showing it is what makes a
 * mis-labelled payer visible instead of silently wrong.
 *
 * Every number here is aggregated server-side over EVERY matching row,
 * not the 50 the table happens to be showing. At 154 running entries the
 * list is already four pages deep, so a total added up from the visible
 * rows would be short while looking entirely plausible.
 */
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ContributionsPanel({
  data,
  filtered,
}: {
  data: ExpenseContributions;
  /** True when a filter is narrowing the set, so the heading can say so. */
  filtered: boolean;
}) {
  if (data.entryCount === 0) return null;

  const {
    people,
    byPerson,
    venture,
    ventureTotal,
    reimbursableTotal,
    months,
    grandTotal,
  } = data;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">
            Paid out of pocket — to reimburse
            {filtered ? (
              <span className="ml-1.5 font-normal text-zinc-500">
                (matching the filters below)
              </span>
            ) : null}
          </h2>
        </div>
        <div className="text-xs text-zinc-400">
          <span className="font-semibold text-emerald-400">
            {formatExpenseAmount(reimbursableTotal)}
          </span>{" "}
          owed, of {formatExpenseAmount(grandTotal)} spent across{" "}
          {data.entryCount.toLocaleString("en-IN")}{" "}
          {data.entryCount === 1 ? "entry" : "entries"}
        </div>
      </header>

      {/* ── Per person, over everything currently shown ─────────── */}
      {byPerson.length > 0 ? (
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {byPerson.map((p) => (
            <div
              key={p.person}
              className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-zinc-100">
                  {p.person}
                </span>
                <span className="flex-shrink-0 text-[10px] uppercase tracking-wide text-zinc-600">
                  {p.count} {p.count === 1 ? "entry" : "entries"}
                </span>
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-400">
                {formatExpenseAmount(p.amount)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-zinc-500">
          Nothing here was paid out of pocket — every entry was paid by the
          venture directly, so there is nothing to transfer.
        </p>
      )}

      {/* ── Venture's own spend, kept out of the owed figure ─────── */}
      {venture.length > 0 ? (
        <div className="border-t border-zinc-800 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <Building2 className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
            <span className="text-zinc-400">
              Paid directly by{" "}
              {venture.map((v) => v.person).join(", ")} —{" "}
              <span className="font-semibold tabular-nums text-zinc-300">
                {formatExpenseAmount(ventureTotal)}
              </span>
            </span>
            <span className="text-zinc-600">
              already settled, owed to nobody and excluded from the figures
              above.
            </span>
          </div>
        </div>
      ) : null}

      {/* ── Per month, per person — the reimbursement table ──────── */}
      {months.length > 0 && people.length > 0 ? (
        <div className="border-t border-zinc-800">
          <div className="flex items-center gap-2 px-4 pb-2 pt-3">
            <ArrowLeftRight className="h-3.5 w-3.5 text-zinc-500" />
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              To transfer, by month
            </h3>
          </div>
          {/* Its own scroller: more contributors must not make the whole
              page scroll sideways. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-y border-zinc-800 bg-zinc-950/40 text-[11px] uppercase tracking-wide text-zinc-500">
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Month
                  </th>
                  {people.map((person) => (
                    <th
                      key={person}
                      scope="col"
                      className="px-4 py-2 text-right font-medium"
                    >
                      {person}
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="px-4 py-2 text-right font-semibold text-emerald-400/80"
                  >
                    To transfer
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-right font-medium text-zinc-600"
                  >
                    Month spend
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {months.map((m) => (
                  <tr
                    key={m.month}
                    className="border-b border-zinc-800/60 last:border-0"
                  >
                    <th
                      scope="row"
                      className="whitespace-nowrap px-4 py-2 text-left font-medium text-zinc-300"
                    >
                      {monthLabel(m.month)}
                    </th>
                    {people.map((person) => {
                      const amount = m.byPerson[person] ?? 0;
                      return (
                        <td
                          key={person}
                          className={`px-4 py-2 text-right ${
                            amount > 0 ? "text-zinc-200" : "text-zinc-700"
                          }`}
                        >
                          {/* An em dash, not ₹0 — paying nothing and
                              paying zero are different statements. */}
                          {amount > 0 ? formatExpenseAmount(amount) : "—"}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right font-semibold text-emerald-400">
                      {formatExpenseAmount(m.reimbursable)}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-500">
                      {formatExpenseAmount(m.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
