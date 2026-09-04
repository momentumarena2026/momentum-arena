"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Pencil, Undo2, AlertTriangle } from "lucide-react";
import {
  approveBookingBotTerm,
  rejectBookingBotTerm,
  unapproveBookingBotTerm,
  type BotStats,
  type Disagreement,
  type PendingTerm,
} from "@/actions/admin-booking-bot";

/**
 * Deliberately plain. This is an internal review desk somebody visits for
 * a couple of minutes a week, and the only thing that matters is that the
 * decision is easy to make correctly: what the word was, what the model
 * thinks it means, the real messages it came from, and whether approving
 * it would actually do anything.
 */
export function BookingBotManager({
  terms,
  stats,
  disagreements,
}: {
  terms: PendingTerm[];
  stats: BotStats;
  disagreements: Disagreement[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const waiting = terms.filter((t) => !t.approved);
  const live = terms.filter((t) => t.approved);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else {
        setEditing(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-8">
      {error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {/* ── The number this whole loop exists to move ──────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Answered by our rules"
          value={`${stats.rulesOnlyPct}%`}
          hint={`${stats.viaRules} of ${stats.total} messages — no model call, no cost`}
          accent
        />
        <Stat
          label="Asked the model"
          value={String(stats.viaModel)}
          hint="only what the rules could not read"
        />
        <Stat
          label="Model answers refused"
          value={String(stats.rejected)}
          hint="failed validation, never shown to a customer"
        />
        <Stat
          label="Typical model reply"
          value={stats.avgLatencyMs != null ? `${stats.avgLatencyMs} ms` : "—"}
          hint={`${stats.confirmed} messages became real bookings`}
        />
      </section>

      {/* ── Waiting for review ─────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">
          Waiting for you{" "}
          <span className="text-zinc-500">({waiting.length})</span>
        </h2>
        <p className="max-w-3xl text-sm text-zinc-400">
          Approve a word only if the meaning is right. A wrong one makes the
          rules confidently wrong, and there is no model call left to blame it
          on. Rejecting is not permanent — if customers keep using the word it
          will come back.
        </p>

        {waiting.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-sm text-zinc-500">
            Nothing waiting. New words appear here as customers use them.
          </p>
        ) : (
          <ul className="space-y-2">
            {waiting.map((t) => (
              <li
                key={t.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <code className="rounded bg-zinc-800 px-2 py-1 text-sm text-white">
                    {t.term}
                  </code>
                  <span className="text-zinc-500">means</span>
                  {editing === t.id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="rounded border border-emerald-500/50 bg-zinc-950 px-2 py-1 text-sm text-white outline-none"
                    />
                  ) : (
                    <code className="rounded bg-emerald-500/10 px-2 py-1 text-sm text-emerald-300">
                      {t.canonical}
                    </code>
                  )}
                  <span className="text-xs text-zinc-500">
                    seen in {t.seenCount} message{t.seenCount === 1 ? "" : "s"}
                  </span>

                  {/* The honest caveat. A term rewrites a word INTO its
                      meaning, so it only helps if the parser understands
                      the meaning: "criket"→"cricket" pays off at once,
                      "shaam"→"evening" does not, because nothing resolves
                      "evening" to an hour yet. */}
                  {!t.effective ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300"
                      title="Approving this is safe but changes nothing yet — the rules don't understand this meaning, so the model will still be asked."
                    >
                      <AlertTriangle size={12} />
                      no effect yet
                    </span>
                  ) : null}

                  <div className="ml-auto flex items-center gap-2">
                    <button
                      disabled={pending}
                      onClick={() =>
                        editing === t.id
                          ? run(() => approveBookingBotTerm(t.id, draft))
                          : run(() => approveBookingBotTerm(t.id))
                      }
                      className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      <Check size={14} /> Approve
                    </button>
                    <button
                      disabled={pending}
                      onClick={() => {
                        setEditing(t.id);
                        setDraft(t.canonical);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      <Pencil size={14} /> Change meaning
                    </button>
                    <button
                      disabled={pending}
                      onClick={() => run(() => rejectBookingBotTerm(t.id))}
                      className="inline-flex items-center gap-1 rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      <X size={14} /> Discard
                    </button>
                  </div>
                </div>

                {t.examples.length > 0 ? (
                  <ul className="mt-3 space-y-1 border-l-2 border-zinc-800 pl-3">
                    {t.examples.map((ex, i) => (
                      <li key={i} className="text-xs text-zinc-500">
                        “{ex}”
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Live vocabulary ────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">
          In use <span className="text-zinc-500">({live.length})</span>
        </h2>
        <p className="max-w-3xl text-sm text-zinc-400">
          The rules resolve these with no model call. Withdrawing one takes
          effect within a minute.
        </p>
        {live.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-sm text-zinc-500">
            Nothing approved yet.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {live.map((t) => (
              <li
                key={t.id}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm"
              >
                <span className="text-white">{t.term}</span>
                <span className="text-zinc-600">→</span>
                <span className="text-emerald-300">{t.canonical}</span>
                <button
                  disabled={pending}
                  onClick={() => run(() => unapproveBookingBotTerm(t.id))}
                  title="Withdraw"
                  className="text-zinc-500 hover:text-white disabled:opacity-50"
                >
                  <Undo2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Disagreements ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Where the two disagreed</h2>
        <p className="max-w-3xl text-sm text-zinc-400">
          Messages our rules and the model both understood, differently. Our
          rules win whenever they read something explicitly, so the left column
          is what the customer saw — but a disagreement is worth a look either
          way, because sometimes it is the rules that are wrong.
        </p>
        {disagreements.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-sm text-zinc-500">
            No disagreements recorded.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Message</th>
                  <th className="px-4 py-2 font-medium">Our rules</th>
                  <th className="px-4 py-2 font-medium">The model</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {disagreements.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2 text-zinc-300">“{d.text}”</td>
                    <td className="px-4 py-2 font-mono text-xs text-emerald-300">
                      {d.rules}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-zinc-500">
                      {d.model}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${accent ? "text-emerald-400" : "text-white"}`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-zinc-500">{hint}</p>
    </div>
  );
}
