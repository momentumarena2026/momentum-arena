"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BellOff,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  RotateCcw,
  Users,
} from "lucide-react";
import {
  dryRunDailyPush,
  resetDailyPushDefaults,
  saveDailyPushSettings,
  type DailyPushAdminView,
} from "@/actions/admin-daily-push";
import { settingsRefusal, type DailyPushLimits } from "@/lib/daily-push-rules";
import type { DailyPushRun } from "@/lib/daily-push";

/**
 * The daily push dashboard.
 *
 * Two things here are not decoration. The refusal banner runs the SAME
 * validator the server does (lib/daily-push-rules.ts#settingsRefusal), so
 * an incoherent combination is named while the admin is still looking at
 * the two fields that disagree rather than after a failed save. And the
 * dry run is the only verification anybody gets before this reaches real
 * phones — there is no staging device fleet, so without it "test it"
 * means "send it to customers".
 */

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function DailyPushClient({ view }: { view: DailyPushAdminView }) {
  const [s, setS] = useState<DailyPushLimits>(view.settings);
  const [saving, startSave] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [run, setRun] = useState<DailyPushRun | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Live, not on submit: the point is to catch "send hour is inside quiet
  // hours" while both fields are on screen.
  const refusal = settingsRefusal(s);

  const save = () => {
    setResult(null);
    startSave(async () => {
      const r = await saveDailyPushSettings(s);
      setResult(
        r.ok
          ? { ok: true, message: "Saved." }
          : { ok: false, message: r.error },
      );
    });
  };

  const preview = async () => {
    setPreviewing(true);
    setRun(null);
    try {
      setRun(await dryRunDailyPush());
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : "The dry run failed.",
      });
    } finally {
      setPreviewing(false);
    }
  };

  const reset = () => {
    startSave(async () => {
      const r = await resetDailyPushDefaults();
      if (r.ok) window.location.reload();
      else setResult({ ok: false, message: r.error });
    });
  };

  return (
    <div className="space-y-6">
      {/* ── State of play ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Reachable"
          value={view.reachable.toLocaleString()}
          hint="customers with a device"
          icon={<Users className="h-3.5 w-3.5 text-emerald-400" />}
        />
        <Stat
          label="Opted out"
          value={view.optedOut.toLocaleString()}
          hint={
            view.reachable > 0
              ? `${Math.round((view.optedOut / view.reachable) * 100)}% of them`
              : "—"
          }
          icon={<BellOff className="h-3.5 w-3.5 text-amber-300" />}
        />
        <Stat
          label="Sent (7d)"
          value={view.lastWeekByRule
            .reduce((n, r) => n + r.count, 0)
            .toLocaleString()}
          hint="across all rules"
          icon={<CheckCircle2 className="h-3.5 w-3.5 text-blue-400" />}
        />
        <Stat
          label="Last sent"
          value={
            view.lastSentAt
              ? new Date(view.lastSentAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                })
              : "Never"
          }
          hint={view.lastSentAt ? "most recent run" : "nothing has gone out"}
          icon={<Clock className="h-3.5 w-3.5 text-purple-300" />}
        />
      </div>

      {/* ── The switch ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <Toggle
          label="Send the daily push"
          hint={
            s.enabled
              ? `Runs every day at ${hourLabel(s.sendHourIST)} IST.`
              : "Off. Nothing is sent, and the cron returns immediately."
          }
          value={s.enabled}
          onChange={(v) => setS({ ...s, enabled: v })}
        />
        <div className="grid sm:grid-cols-3 gap-3 pt-1">
          <Select
            label="Send at (IST)"
            value={s.sendHourIST}
            options={HOURS}
            format={hourLabel}
            onChange={(v) => setS({ ...s, sendHourIST: v })}
          />
          <Select
            label="Quiet from"
            value={s.quietFromHour}
            options={HOURS}
            format={hourLabel}
            onChange={(v) => setS({ ...s, quietFromHour: v })}
          />
          <Select
            label="Quiet until"
            value={s.quietToHour}
            options={HOURS}
            format={hourLabel}
            onChange={(v) => setS({ ...s, quietToHour: v })}
          />
        </div>
        <p className="text-[11px] text-zinc-600">
          Quiet hours win over the send time. A run that wakes inside the window
          sends nothing and does not queue for morning — by morning the message is
          about last night.
        </p>
      </section>

      {/* ── Who gets left alone ───────────────────────────────────── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white">Who gets left alone</h2>
        <Number
          label="Most daily pushes one person can get in a week"
          value={s.maxPerUserPerWeek}
          min={0}
          max={7}
          onChange={(v) => setS({ ...s, maxPerUserPerWeek: v })}
          hint="Counted per person, enforced in code. Zero mutes the module without switching it off."
        />
        <Toggle
          label="Skip anyone playing today or tomorrow"
          hint="They already booked. What they need is their reminder, which goes out separately."
          value={s.skipIfBookedSoon}
          onChange={(v) => setS({ ...s, skipIfBookedSoon: v })}
        />
        <Toggle
          label="Skip anyone who already heard from us today"
          hint="Counts targeted pushes only — booking confirmations, reminders, rewards. A broadcast to the whole fleet has no single recipient, so it is invisible to this check."
          value={s.skipIfPushedToday}
          onChange={(v) => setS({ ...s, skipIfPushedToday: v })}
        />
        <p className="text-[11px] text-zinc-600">
          Anyone who has switched the daily push off in the app is skipped
          regardless of everything above. {view.optedOut} {view.optedOut === 1 ? "person has" : "people have"} done so.
        </p>
      </section>

      {/* ── The rules ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">The rules, in order</h2>
          <p className="mt-0.5 text-[11px] text-zinc-600">
            First one that is true for a person wins. Someone who is lapsed{" "}
            <em>and</em> has a pass running out hears about the pass — the money
            is the more urgent fact.
          </p>
        </div>

        <Rule
          n={1}
          title="Pass about to expire"
          sent={view.lastWeekByRule.find((r) => r.rule === "PASS_EXPIRY")?.count ?? 0}
          enabled={s.passExpiry.enabled}
          onToggle={(v) => setS({ ...s, passExpiry: { ...s.passExpiry, enabled: v } })}
          note="The only rule where saying nothing costs the customer money rather than costing the arena a booking."
        >
          <Number
            label="Warn this many days before it lapses"
            value={s.passExpiry.days}
            min={0}
            max={60}
            onChange={(v) => setS({ ...s, passExpiry: { ...s.passExpiry, days: v } })}
          />
        </Rule>

        <Rule
          n={2}
          title="Installed but never booked"
          sent={view.lastWeekByRule.find((r) => r.rule === "NEVER_BOOKED")?.count ?? 0}
          enabled={s.neverBooked.enabled}
          onToggle={(v) => setS({ ...s, neverBooked: { ...s.neverBooked, enabled: v } })}
          note="A stranger. Keep the copy gentle — this is the group most likely to read a nudge as spam."
        >
          <Number
            label="Only after they have had the app this many days"
            value={s.neverBooked.days}
            min={0}
            max={365}
            onChange={(v) => setS({ ...s, neverBooked: { ...s.neverBooked, days: v } })}
          />
        </Rule>

        <Rule
          n={3}
          title="Booked before, gone quiet"
          sent={view.lastWeekByRule.find((r) => r.rule === "LAPSED")?.count ?? 0}
          enabled={s.lapsed.enabled}
          onToggle={(v) => setS({ ...s, lapsed: { ...s.lapsed, enabled: v } })}
          note="Win-back. The audience shrinks on its own as it works."
        >
          <Number
            label="Quiet for this many days"
            value={s.lapsed.days}
            min={1}
            max={365}
            onChange={(v) => setS({ ...s, lapsed: { ...s.lapsed, days: v } })}
          />
        </Rule>

        <Rule
          n={4}
          title="Free slots tonight"
          sent={view.lastWeekByRule.find((r) => r.rule === "FREE_SLOTS")?.count ?? 0}
          enabled={s.freeSlots.enabled}
          onToggle={(v) => setS({ ...s, freeSlots: { ...s.freeSlots, enabled: v } })}
          note="The fallback for everyone no rule above matched. Only fires when the evening genuinely has slots — a full night says nothing rather than inventing availability."
        >
          <div className="grid sm:grid-cols-2 gap-3">
            <Select
              label="Tonight starts at"
              value={s.freeSlots.fromHour}
              options={HOURS}
              format={hourLabel}
              onChange={(v) => setS({ ...s, freeSlots: { ...s.freeSlots, fromHour: v } })}
            />
            <Number
              label="Only if at least this many are free"
              value={s.freeSlots.minOpen}
              min={1}
              max={50}
              onChange={(v) => setS({ ...s, freeSlots: { ...s.freeSlots, minOpen: v } })}
            />
          </div>
        </Rule>

        <p className="text-[11px] text-zinc-600">
          The wording of each message lives with the rest of the automated copy on{" "}
          <Link href="/admin/push/templates" className="text-emerald-400 hover:underline">
            Automated messages
          </Link>
          .
        </p>
      </section>

      {/* ── Refusal / result ──────────────────────────────────────── */}
      {refusal && (
        <Banner tone="warn">
          {refusal} Fix that before saving — these settings would never send.
        </Banner>
      )}
      {result && !refusal && (
        <Banner tone={result.ok ? "ok" : "warn"}>{result.message}</Banner>
      )}

      {/* ── Actions ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={save}
          disabled={saving || !!refusal}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </button>
        <button
          onClick={preview}
          disabled={previewing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 transition-colors"
        >
          {previewing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
          Dry run
        </button>
        <button
          onClick={reset}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Restore defaults
        </button>
        <span className="text-[11px] text-zinc-600">
          A dry run sends nothing. It evaluates every rule against the real
          audience and shows you the result.
        </span>
      </div>

      {run && <DryRun run={run} />}
    </div>
  );
}

// ── Dry run ────────────────────────────────────────────────────────────

function DryRun({ run }: { run: DailyPushRun }) {
  const reasons = Object.entries(run.skipped).sort((a, b) => b[1] - a[1]);

  return (
    <section className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            What tonight&apos;s run would do
          </h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Evaluated against {run.considered} reachable{" "}
            {run.considered === 1 ? "customer" : "customers"}. Nothing was sent.
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-blue-500/15 px-2 py-1 text-[10px] font-semibold text-blue-300">
          DRY RUN
        </span>
      </div>

      {run.refusal ? (
        <Banner tone="warn">{run.refusal}</Banner>
      ) : (
        <>
          <p className="text-[11px] text-zinc-500">
            Tonight the arena has{" "}
            <span className="text-zinc-300">{run.venue.freeSlotsTonight}</span> free{" "}
            {run.venue.freeSlotsTonight === 1 ? "slot" : "slots"}
            {run.venue.sports.length > 0 && (
              <> across {run.venue.sports.map((x) => x.toLowerCase()).join(", ")}</>
            )}
            .
          </p>

          {run.buckets.length === 0 ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-6 text-center text-sm text-zinc-500">
              Nobody would be sent to.
            </p>
          ) : (
            <div className="space-y-3">
              {run.buckets.map((b) => (
                <div
                  key={b.rule}
                  className="rounded-lg border border-zinc-800 bg-zinc-950 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-emerald-300">
                      {b.label}
                    </span>
                    <span className="shrink-0 text-xs text-zinc-400">
                      {b.count} {b.count === 1 ? "person" : "people"}
                    </span>
                  </div>
                  {b.title && (
                    <div className="mt-2 rounded-md bg-black/40 px-3 py-2">
                      <p className="text-sm font-semibold text-white">{b.title}</p>
                      <p className="mt-0.5 text-xs text-zinc-400">{b.body}</p>
                    </div>
                  )}
                  {b.rule === "PASS_EXPIRY" && (
                    <p className="mt-1.5 text-[10px] text-zinc-600">
                      Sent one at a time — the real message names each person&apos;s
                      own pass, balance and expiry date.
                    </p>
                  )}
                  {b.sample.length > 0 && (
                    <p className="mt-1.5 text-[10px] text-zinc-600">
                      e.g. {b.sample.join(", ")}
                      {b.count > b.sample.length && ` +${b.count - b.sample.length} more`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {reasons.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <p className="text-xs font-semibold text-zinc-400">
                Everyone else, and why
              </p>
              <ul className="mt-2 space-y-1">
                {reasons.map(([reason, n]) => (
                  <li
                    key={reason}
                    className="flex items-center justify-between gap-3 text-[11px]"
                  >
                    <span className="text-zinc-500">{reason}</span>
                    <span className="shrink-0 tabular-nums text-zinc-400">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Small pieces ───────────────────────────────────────────────────────

function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-zinc-500">{label}</span>
        {icon}
      </div>
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-[10px] text-zinc-600">{hint}</p>
    </div>
  );
}

function Rule({
  n,
  title,
  note,
  sent,
  enabled,
  onToggle,
  children,
}: {
  n: number;
  title: string;
  note: string;
  sent: number;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-3 space-y-3 transition-colors ${
        enabled ? "border-zinc-800 bg-zinc-950" : "border-zinc-900 bg-zinc-950/40"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
            enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800 text-zinc-600"
          }`}
        >
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p
                className={`text-sm font-semibold ${
                  enabled ? "text-white" : "text-zinc-500"
                }`}
              >
                {title}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-600">{note}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[10px] text-zinc-600">{sent} sent (7d)</span>
              <Switch value={enabled} onChange={onToggle} />
            </div>
          </div>
          {enabled && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-white">{label}</p>
        <p className="mt-0.5 text-[11px] text-zinc-600">{hint}</p>
      </div>
      <Switch value={value} onChange={onChange} />
    </div>
  );
}

function Switch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        value ? "bg-emerald-600" : "bg-zinc-700"
      }`}
    >
      {/* `left-0` is not cosmetic. Without a horizontal anchor the knob
          falls back to its static position, which put the OFF knob flush
          against the right edge and pushed the ON knob outside the track
          entirely — so this switch rendered "off" as the universal
          picture of "on", on the one control that decides whether the
          arena starts pushing every customer daily. Anchor first, then
          translate from it. */}
      <span
        className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
          value ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Number({
  label,
  value,
  min,
  max,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-zinc-500">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          // NaN from an emptied box must not become 0 and silently mute a
          // rule; hold the previous value until they type a real number.
          if (!isNaN(n)) onChange(n);
        }}
        className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
      />
      {hint && <span className="mt-1 block text-[10px] text-zinc-600">{hint}</span>}
    </label>
  );
}

function Select({
  label,
  value,
  options,
  format,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-zinc-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {format(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Banner({ tone, children }: { tone: "ok" | "warn"; children: React.ReactNode }) {
  const ok = tone === "ok";
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-amber-500/30 bg-amber-500/10 text-amber-300"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      ) : (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <span>{children}</span>
    </div>
  );
}
