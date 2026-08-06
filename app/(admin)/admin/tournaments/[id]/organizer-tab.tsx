"use client";

import { useEffect, useState, useTransition } from "react";
import { IndianRupee, Plus, Trash2 } from "lucide-react";
import {
  getOrganizerLedger,
  recordOrganizerPayment,
  deleteOrganizerPayment,
  type OrganizerLedger,
} from "@/actions/admin-tournament-organizer";
import {
  ORGANIZER_PAYMENT_METHODS,
  ORGANIZER_METHOD_LABEL as METHOD_LABEL,
} from "@/lib/tournament-organizer";

/**
 * The money tab for a third-party tournament.
 *
 * Only rendered when host === THIRD_PARTY — our own tournaments take money
 * from teams instead, which the Teams tab already shows.
 */

function inr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

function today() {
  // Date-only, local. The venue settles by day; a timestamp would imply a
  // precision the paperwork doesn't have.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function OrganizerTab({
  tournamentId,
  organizerName,
  organizerPhone,
  organizerEmail,
  organizerNote,
}: {
  tournamentId: string;
  organizerName: string | null;
  organizerPhone: string | null;
  organizerEmail: string | null;
  organizerNote: string | null;
}) {
  const [ledger, setLedger] = useState<OrganizerLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("CASH");
  const [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState(today());
  const [note, setNote] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const l = await getOrganizerLedger(tournamentId);
      setLedger(l);
    } catch (e) {
      // Without this the tab sat on "Loading…" forever whenever the action
      // threw — the failure mode that hid a broken "use server" export.
      // Say something instead of hanging.
      setError(e instanceof Error ? e.message : "Could not load payments");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter an amount greater than zero");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await recordOrganizerPayment({
        tournamentId,
        amount: Math.round(amt),
        method: method as (typeof ORGANIZER_PAYMENT_METHODS)[number],
        reference: reference.trim() || undefined,
        receivedAt,
        note: note.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAmount("");
      setReference("");
      setNote("");
      setReceivedAt(today());
      setAdding(false);
      await refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteOrganizerPayment(id);
      if (!res.ok) setError(res.error);
      await refresh();
    });
  }

  if (loading) return <p className="py-8 text-sm text-zinc-500">Loading…</p>;
  if (error && !ledger) {
    return (
      <p className="my-6 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
        {error}
      </p>
    );
  }
  if (!ledger) {
    return (
      <p className="py-8 text-sm text-zinc-500">
        Organiser payments apply to third-party tournaments only.
      </p>
    );
  }

  const settled = ledger.outstanding === 0 && ledger.quotedAmount > 0;

  return (
    <div className="space-y-5 py-4">
      {/* Who we're dealing with */}
      {(organizerName || organizerPhone || organizerEmail) && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Organiser</p>
          <p className="mt-1 font-semibold text-white">{organizerName || "—"}</p>
          <p className="text-sm text-zinc-400">
            {[organizerPhone, organizerEmail].filter(Boolean).join(" · ") || "No contact on file"}
          </p>
          {organizerNote && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-400">{organizerNote}</p>
          )}
        </div>
      )}

      {/* Quote vs received */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Quoted</p>
          <p className="mt-1 text-2xl font-bold text-white">{inr(ledger.quotedAmount)}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Received</p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">{inr(ledger.receivedAmount)}</p>
        </div>
        <div
          className={`rounded-xl border p-4 ${
            settled
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-amber-500/30 bg-amber-500/5"
          }`}
        >
          <p className="text-xs uppercase tracking-wide text-zinc-500">Outstanding</p>
          <p className={`mt-1 text-2xl font-bold ${settled ? "text-emerald-400" : "text-amber-400"}`}>
            {settled ? "Settled" : inr(ledger.outstanding)}
          </p>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* Record a receipt */}
      {adding ? (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p className="font-semibold text-white">Record a payment</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Amount (₹)</span>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Method</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
              >
                {ORGANIZER_PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABEL[m] ?? m}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Received on</span>
              <input
                type="date"
                value={receivedAt}
                onChange={(e) => setReceivedAt(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Reference (UTR / cheque no.)</span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Note (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
            />
          </label>
          {/* The received date drives which month this lands in for
              analytics and the CA report — worth saying out loud, because
              entering last week's cash today would otherwise silently book
              it to today. */}
          <p className="text-xs text-zinc-500">
            Revenue is counted on the received date, not the date you enter it.
          </p>
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={pending}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save payment"}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> Record payment
        </button>
      )}

      {/* Receipts */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-white">
          Payments received ({ledger.payments.length})
        </p>
        {ledger.payments.length === 0 ? (
          <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-500">
            Nothing received yet.
          </p>
        ) : (
          ledger.payments.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1 font-semibold text-white">
                  <IndianRupee className="h-3.5 w-3.5" />
                  {p.amount.toLocaleString("en-IN")}
                  <span className="ml-1 text-xs font-normal text-zinc-400">
                    {METHOD_LABEL[p.method] ?? p.method}
                  </span>
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {new Date(p.receivedAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  {p.reference ? ` · ${p.reference}` : ""}
                  {p.note ? ` · ${p.note}` : ""}
                </p>
              </div>
              {/* Delete, not edit: correcting an amount in place would move
                  money between accounting months if the date changed with
                  it. Remove the wrong row, enter the right one. */}
              <button
                onClick={() => remove(p.id)}
                disabled={pending}
                title="Delete this receipt"
                className="shrink-0 rounded-lg border border-zinc-700 p-2 text-zinc-400 hover:border-red-500/40 hover:text-red-400 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
