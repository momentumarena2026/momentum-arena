import Link from "next/link";
import {
  CalendarClock,
  CalendarDays,
  Clock,
  IndianRupee,
  Ticket,
  Users,
} from "lucide-react";
import type { getSoldPassDetail } from "@/actions/admin-passes";

type Pass = NonNullable<Awaited<ReturnType<typeof getSoldPassDetail>>>;

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
/** Hours, trimmed: 90 min reads "1.5h", 120 reads "2h". */
const hrs = (m: number) => `${(m / 60).toFixed(1).replace(/\.0$/, "")}h`;
const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const dayTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "border-emerald-500/40 text-emerald-400",
  UPCOMING: "border-amber-500/40 text-amber-400",
  EXPIRED: "border-zinc-700 text-zinc-400",
  EXHAUSTED: "border-zinc-700 text-zinc-400",
  CANCELLED: "border-red-500/40 text-red-400",
};

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

/**
 * Admin view of a single sold pass.
 *
 * Deliberately read-only. Extend / Adjust / Edit start date / Cancel all
 * already live on the Sold Passes list and mutate through their own gated
 * actions; duplicating them here would mean two places to keep correct on a
 * money path. This page answers "what happened to this pass", which the list
 * could never show: when it was bought, how it was paid for, what has been
 * consumed, and every booking that drew on it.
 */
export function PassDetailAdmin({ pass }: { pass: Pass }) {
  const consumedPct =
    pass.totalMinutes > 0
      ? Math.min(100, Math.round((pass.consumedMinutes / pass.totalMinutes) * 100))
      : 0;
  // Redemptions that were given back (an eligible cancellation) are still
  // shown — a hole in the history is worse than a struck-through row.
  const live = pass.bookings.filter((b) => !b.restored);
  const restored = pass.bookings.filter((b) => b.restored);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-white">{pass.name}</h1>
          <span
            className={`rounded-full border px-2.5 py-1 text-xs ${
              STATUS_STYLE[pass.status] || "border-zinc-700 text-zinc-400"
            }`}
          >
            {pass.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          {pass.owner.name ?? "—"} · {pass.owner.phone ?? "—"} · {pass.sport} ·{" "}
          {pass.courtLabel}
          {pass.bandsSummary ? ` · ${pass.bandsSummary}` : ""}
        </p>
      </div>

      {/* The four numbers an admin is actually looking for */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Clock}
          label="Hours remaining"
          value={hrs(pass.remainingMinutes)}
          sub={`of ${hrs(pass.totalMinutes)} bought`}
        />
        <Stat
          icon={Ticket}
          label="Hours consumed"
          value={hrs(pass.consumedMinutes)}
          sub={`${consumedPct}% used · ${live.length} booking${live.length === 1 ? "" : "s"}`}
        />
        <Stat
          icon={IndianRupee}
          label="Paid"
          value={inr(pass.price)}
          sub={pass.methodLabel}
        />
        <Stat
          icon={CalendarClock}
          label="Expires"
          value={day(pass.expiresAt)}
          sub={`${pass.validityDays} day validity`}
        />
      </div>

      {/* Consumption bar — the fastest read of "how much is left". */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="mb-2 flex justify-between text-xs text-zinc-400">
          <span>{hrs(pass.consumedMinutes)} used</span>
          <span>{hrs(pass.remainingMinutes)} left</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500/70"
            style={{ width: `${consumedPct}%` }}
          />
        </div>
      </div>

      {/* Lifecycle + purchase trail */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <CalendarDays className="h-4 w-4 text-zinc-500" /> Timeline
          </h2>
          <dl className="space-y-2 text-sm">
            {[
              ["Purchased", dayTime(pass.purchasedAt)],
              ["Starts", day(pass.startsAt)],
              ["Expires", day(pass.expiresAt)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="text-zinc-200">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <IndianRupee className="h-4 w-4 text-zinc-500" /> Payment
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Method</dt>
              <dd className="text-zinc-200">{pass.methodLabel}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Amount</dt>
              <dd className="text-zinc-200">{inr(pass.price)}</dd>
            </div>
            {pass.issuedByUsername && (
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Issued by</dt>
                <dd className="text-zinc-200">{pass.issuedByUsername}</dd>
              </div>
            )}
            {/* Gateway references — what a refund or a dispute is traced by. */}
            {[
              ["Razorpay payment", pass.admin.razorpayPaymentId],
              ["PhonePe txn", pass.admin.phonePeMerchantTxnId],
              ["Reference", pass.admin.offlineRef],
            ]
              .filter(([, v]) => !!v)
              .map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-4">
                  <dt className="text-zinc-500">{k}</dt>
                  <dd className="break-all text-right font-mono text-xs text-zinc-300">
                    {v}
                  </dd>
                </div>
              ))}
          </dl>
        </div>
      </div>

      {/* Shared members */}
      {pass.members.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Users className="h-4 w-4 text-zinc-500" /> Shared with{" "}
            {pass.members.length} of {pass.maxMembers}
          </h2>
          <ul className="space-y-1.5 text-sm">
            {pass.members.map((m) => (
              <li key={m.userId} className="flex justify-between gap-4">
                <span className="text-zinc-200">{m.name ?? "—"}</span>
                <span className="text-zinc-500">
                  {m.phone ?? "—"} · added {day(m.addedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Every booking this pass paid for */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="mb-1 text-sm font-semibold text-white">
          Bookings on this pass
        </h2>
        <p className="mb-4 text-xs text-zinc-500">
          Every redemption — when it was played, who booked it, and the hours it
          drew.
        </p>

        {pass.bookings.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
            No bookings have used this pass yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Play date</th>
                  <th className="py-2 pr-4 font-medium">Time</th>
                  <th className="py-2 pr-4 font-medium">Booked by</th>
                  <th className="py-2 pr-4 font-medium">Hours</th>
                  <th className="py-2 pr-4 font-medium">Value</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...live, ...restored].map((b) => (
                  <tr
                    key={b.bookingId}
                    className={`border-b border-zinc-800/60 last:border-0 ${
                      b.restored ? "opacity-50" : ""
                    }`}
                  >
                    <td className="py-2.5 pr-4 text-zinc-200">{day(b.date)}</td>
                    <td className="py-2.5 pr-4 text-zinc-400">{b.timeLabel}</td>
                    <td className="py-2.5 pr-4 text-zinc-400">
                      {b.bookedBy ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-zinc-200">
                      {hrs(b.minutes)}
                    </td>
                    <td className="py-2.5 pr-4 text-zinc-400">{inr(b.value)}</td>
                    <td className="py-2.5">
                      {b.restored ? (
                        <span className="text-amber-400">Hours returned</span>
                      ) : (
                        <Link
                          href={`/admin/bookings/${b.bookingId}`}
                          className="text-emerald-400 hover:underline"
                        >
                          {b.bookingStatus}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {restored.length > 0 && (
          <p className="mt-3 text-xs text-zinc-500">
            Dimmed rows were cancelled and their hours returned to the balance —
            kept here so the history has no gaps.
          </p>
        )}
      </div>
    </div>
  );
}
