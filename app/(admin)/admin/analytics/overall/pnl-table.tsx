"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { getProfitAndLoss } from "@/actions/admin-pnl";
// Types come from the plain module, never from the "use server" file —
// see the note in lib/pnl-math.ts.
import type { PnlGranularity, PnlResult } from "@/lib/pnl-math";

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/** Rupees the way an owner reads them: 12,34,567 → "12.35L". */
function compact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${sign}${(abs / 100000).toFixed(2)}L`;
  return `${sign}${inr(abs)}`;
}

type RowKind = "income" | "expense" | "total" | "profit" | "pct";

function cellClass(kind: RowKind, value: number | null): string {
  if (kind === "profit") {
    if (value === null) return "text-zinc-500";
    return value < 0 ? "text-red-400" : "text-emerald-400";
  }
  if (kind === "total") return "text-white";
  return "text-zinc-300";
}

export function PnlTable({ initial }: { initial: PnlResult }) {
  const [granularity, setGranularity] = useState<PnlGranularity>("month");
  const [data, setData] = useState<PnlResult>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showIncome, setShowIncome] = useState(true);
  const [showExpenses, setShowExpenses] = useState(true);

  function switchTo(g: PnlGranularity) {
    if (g === granularity) return;
    setGranularity(g);
    setError(null);
    startTransition(async () => {
      const res = await getProfitAndLoss(g);
      if (res.success) setData(res.data);
      else setError(res.error);
    });
  }

  const { periods, columns, expenseCategories, funding } = data;

  if (periods.length === 0) {
    return (
      <p className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">
        No income or running expenses recorded yet. The statement appears as
        soon as the first month has activity.
      </p>
    );
  }

  // Sticky first column + horizontally scrolling period columns. The row
  // label has to stay visible or a 14-month table is unreadable.
  const label = "sticky left-0 z-10 bg-zinc-900 py-2.5 pr-4 text-left";
  const num = "whitespace-nowrap px-3 py-2.5 text-right tabular-nums";

  const Row = ({
    name,
    values,
    kind,
    indent = false,
    suffix = "",
    bold = false,
    onToggle,
    open,
    flags,
  }: {
    name: string;
    values: (number | null)[];
    kind: RowKind;
    indent?: boolean;
    suffix?: string;
    bold?: boolean;
    onToggle?: () => void;
    open?: boolean;
    /** Per-column "this figure has no expenses behind it" marker. */
    flags?: boolean[];
  }) => (
    <tr className={bold ? "border-t border-zinc-700" : "border-t border-zinc-800/50"}>
      <th
        scope="row"
        className={`${label} text-sm font-normal ${
          bold ? "font-semibold text-white" : indent ? "pl-6 text-zinc-400" : "text-zinc-300"
        }`}
      >
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-1 hover:text-emerald-400"
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {name}
          </button>
        ) : (
          name
        )}
      </th>
      {values.map((v, i) => {
        // A flagged column is greyed rather than coloured: an unearned
        // 100% margin should not read as a good month.
        const flagged = flags?.[i] ?? false;
        return (
          <td
            key={i}
            className={`${num} text-sm ${bold ? "font-semibold" : ""} ${
              flagged ? "text-zinc-500" : cellClass(kind, v)
            }`}
            title={
              flagged
                ? "No running expenses entered for this period yet — margin is provisional"
                : undefined
            }
          >
            {v === null ? "—" : `${compact(v)}${suffix}`}
            {flagged && <span className="ml-0.5 text-amber-500">*</span>}
          </td>
        );
      })}
    </tr>
  );

  return (
    <div className="space-y-6">
      {/* Granularity toggle — monthly is the default view */}
      <div className="flex items-center gap-3">
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          {(["month", "year"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => switchTo(g)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                granularity === g
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {g === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
        {pending && <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-lg font-bold text-white">Profit &amp; Loss</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Cash basis, figures in rupees. Income is money received; expenses are
          the running monthly spend. Build-out months carry no expense line by
          design — every cost then was capitalised into the ₹50L capex, which
          sits in Funding below rather than in this statement, so revenue earned
          during the build is operating profit in full.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-700">
                <th className={`${label} text-xs font-medium uppercase tracking-wider text-zinc-500`}>
                  &nbsp;
                </th>
                {periods.map((p) => (
                  <th
                    key={p.key}
                    className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-500"
                  >
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row
                name="Income"
                kind="total"
                bold
                values={columns.map((c) => c.totalIncome)}
                onToggle={() => setShowIncome((v) => !v)}
                open={showIncome}
              />
              {showIncome && (
                <>
                  <Row name="Bookings" kind="income" indent values={columns.map((c) => c.bookings)} />
                  <Row name="Passes" kind="income" indent values={columns.map((c) => c.passes)} />
                  <Row name="Tournaments" kind="income" indent values={columns.map((c) => c.tournaments)} />
                  <Row name="Camps" kind="income" indent values={columns.map((c) => c.camps)} />
                  <Row name="Cafe" kind="income" indent values={columns.map((c) => c.cafe)} />
                </>
              )}

              <Row
                name="Expenses"
                kind="total"
                bold
                values={columns.map((c) => c.totalExpenses)}
                onToggle={() => setShowExpenses((v) => !v)}
                open={showExpenses}
              />
              {showExpenses &&
                expenseCategories.map((cat) => (
                  <Row
                    key={cat}
                    name={cat}
                    kind="expense"
                    indent
                    values={columns.map((c) => c.expenseByCategory[cat] ?? 0)}
                  />
                ))}

              <Row
                name="Operating Profit"
                kind="profit"
                bold
                values={columns.map((c) => c.operatingProfit)}
                flags={columns.map((c) => c.expensesUntracked)}
              />
              <Row
                name="OPM %"
                kind="pct"
                suffix="%"
                values={columns.map((c) => c.opmPct)}
                flags={columns.map((c) => c.expensesUntracked)}
              />
              <Row
                name={`Interest${funding.loanTotal > 0 ? ` @ ${funding.loans[0]?.ratePct ?? 0}%` : ""}`}
                kind="expense"
                values={columns.map((c) => c.interest)}
              />
              <Row
                name="Net Profit"
                kind="profit"
                bold
                values={columns.map((c) => c.netProfit)}
                flags={columns.map((c) => c.expensesUntracked)}
              />
            </tbody>
          </table>
        </div>

        {columns.some((c) => c.expensesUntracked) && (
          <p className="mt-3 text-xs text-zinc-500">
            <span className="text-amber-500">*</span> Income but no running
            expenses recorded, in a period after expense tracking began — most
            likely a month nobody has entered yet, so treat the margin as
            provisional.
          </p>
        )}
      </div>

      <FundingBlock funding={funding} />
    </div>
  );
}

function FundingBlock({ funding }: { funding: PnlResult["funding"] }) {
  const {
    equity,
    equityTotal,
    loans,
    loanTotal,
    fundingTotal,
    capexRecorded,
    fundingGap,
    cumulativeNetProfit,
    paybackRemaining,
  } = funding;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-sm font-semibold text-white">Funding &amp; capex</h2>
        <p className="mt-0.5 mb-3 text-xs text-zinc-500">
          Where the build-out money came from. Not an operating cost — it never
          enters the statement above.
        </p>
        <dl className="space-y-2 text-sm">
          {equity.map((e) => (
            <div key={e.name} className="flex justify-between gap-4">
              <dt className="text-zinc-400">{e.name} — equity</dt>
              <dd className="tabular-nums text-zinc-200">₹{inr(e.amount)}</dd>
            </div>
          ))}
          {loans.map((l) => (
            <div key={`${l.name}-${l.amount}`} className="flex justify-between gap-4">
              <dt className="text-zinc-400">
                {l.name} — loan @ {l.ratePct}% p.a.
                <span className="ml-1 text-xs text-zinc-600">from {l.from}</span>
              </dt>
              <dd className="tabular-nums text-zinc-200">₹{inr(l.amount)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t border-zinc-800 pt-2">
            <dt className="font-medium text-zinc-300">Total funding</dt>
            <dd className="tabular-nums font-semibold text-white">₹{inr(fundingTotal)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-400">Capex recorded (build-out expenses)</dt>
            <dd className="tabular-nums text-zinc-200">₹{inr(capexRecorded)}</dd>
          </div>
          {fundingGap !== 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-amber-400">
                Unreconciled
                <span className="ml-1 text-xs text-zinc-500">
                  funding {fundingGap > 0 ? "exceeds" : "short of"} recorded spend
                </span>
              </dt>
              <dd className="tabular-nums text-amber-400">₹{inr(Math.abs(fundingGap))}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-sm font-semibold text-white">Payback</h2>
        <p className="mt-0.5 mb-3 text-xs text-zinc-500">
          Net profit earned to date against the capex, after loan interest.
        </p>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-400">Cumulative net profit</dt>
            <dd
              className={`tabular-nums font-semibold ${
                cumulativeNetProfit < 0 ? "text-red-400" : "text-emerald-400"
              }`}
            >
              ₹{inr(cumulativeNetProfit)}
            </dd>
          </div>
          {paybackRemaining !== null && (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-400">Capex still to earn back</dt>
                <dd className="tabular-nums text-zinc-200">₹{inr(paybackRemaining)}</dd>
              </div>
              <div className="pt-2">
                <div className="mb-1 flex justify-between text-xs text-zinc-500">
                  <span>
                    {capexRecorded > 0
                      ? `${Math.max(0, Math.round((cumulativeNetProfit / capexRecorded) * 100))}% recovered`
                      : "—"}
                  </span>
                  <span>₹{inr(capexRecorded)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-emerald-500/70"
                    style={{
                      width: `${
                        capexRecorded > 0
                          ? Math.min(
                              100,
                              Math.max(0, (cumulativeNetProfit / capexRecorded) * 100),
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
