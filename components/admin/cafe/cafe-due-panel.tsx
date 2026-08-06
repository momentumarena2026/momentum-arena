"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getCafeOrderDue,
  settleCafeOrderDue,
  type CafeDueSummary,
} from "@/actions/admin-cafe-due";

/**
 * Outstanding balance on a part-paid order, and the form to collect it.
 *
 * Renders nothing when the order is square, so it can sit unconditionally
 * on the order page without adding noise to the normal case.
 */

function inr(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CafeDuePanel({ orderId }: { orderId: string }) {
  const [due, setDue] = useState<CafeDueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [cash, setCash] = useState("");
  const [upi, setUpi] = useState("");
  const [receivedAt, setReceivedAt] = useState(today());
  const [note, setNote] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      setDue(await getCafeOrderDue(orderId));
    } catch (e) {
      // Never leave a spinner up on failure — see the organiser tab, where
      // exactly that hid a broken module for a whole release.
      setError(e instanceof Error ? e.message : "Could not load the balance");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await settleCafeOrderDue({
        orderId,
        cashAmount: Number(cash) || 0,
        upiAmount: Number(upi) || 0,
        receivedAt,
        note: note.trim() || undefined,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setCash("");
      setUpi("");
      setNote("");
      setOpen(false);
      await refresh();
    });
  }

  if (loading || !due) return null;
  // Settled orders say nothing at all. The panel exists to chase money.
  if (due.dueAmount <= 0.01 && due.settlements.length === 0) return null;

  const settled = due.dueAmount <= 0.01;
  const entered = (Number(cash) || 0) + (Number(upi) || 0);

  return (
    <div
      className={`rounded-xl border p-4 ${
        settled
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-amber-500/40 bg-amber-500/10"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-white">
          {settled ? "Balance cleared" : "Pending payment"}
        </p>
        <p
          className={`text-2xl font-bold ${settled ? "text-emerald-400" : "text-amber-300"}`}
        >
          {settled ? inr(0) : inr(due.dueAmount)}
        </p>
      </div>
      <p className="mt-1 text-xs text-zinc-400">
        Order {inr(due.totalAmount)} · {inr(due.collectedAtCounter)} at the counter
        {due.collectedLater > 0 && <> · {inr(due.collectedLater)} collected later</>}
      </p>

      {due.settlements.length > 0 && (
        <div className="mt-3 space-y-1">
          {due.settlements.map((s) => (
            <p key={s.id} className="text-xs text-zinc-400">
              {new Date(s.receivedAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
              })}{" "}
              — <span className="text-zinc-200">{inr(s.amount)}</span>
              {s.cashAmount > 0 && s.upiAmount > 0
                ? ` (${inr(s.cashAmount)} cash + ${inr(s.upiAmount)} UPI)`
                : s.cashAmount > 0
                  ? " cash"
                  : " UPI"}
              {s.note ? ` · ${s.note}` : ""}
            </p>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
          {error}
        </p>
      )}

      {!settled &&
        (open ? (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Cash ₹
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm text-white"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  UPI ₹
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={upi}
                  onChange={(e) => setUpi(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm text-white"
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Received on
              </span>
              <input
                type="date"
                value={receivedAt}
                onChange={(e) => setReceivedAt(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm text-white"
              />
            </label>
            <input
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm text-white placeholder-zinc-500"
            />
            {/* The date decides which day's takings this lands in, so it is
                worth stating — back-dating yesterday's cash is a normal
                thing to do here and must not silently book to today. */}
            <p className="text-[11px] text-zinc-500">
              {entered > 0
                ? `${inr(entered)} of ${inr(due.dueAmount)} · counts as revenue on the received date`
                : "Counts as revenue on the received date, not today"}
            </p>
            <div className="flex gap-2">
              <button
                onClick={submit}
                disabled={pending || entered <= 0}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending ? "Saving…" : "Record payment"}
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setCash(String(due.dueAmount));
                  setUpi("");
                }}
                className="ml-auto rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-400"
              >
                Full in cash
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="mt-3 rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-zinc-950"
          >
            Collect {inr(due.dueAmount)}
          </button>
        ))}
    </div>
  );
}
