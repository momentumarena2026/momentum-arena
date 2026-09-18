"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Swords, Settings2 } from "lucide-react";
import {
  saveChallengeSettings,
  adminWithdrawChallenge,
  type ChallengeSettingsInput,
} from "@/actions/admin-challenges";

/**
 * The venue's control room for the challenge board.
 *
 * Two halves, deliberately. The settings are what the board IS — and they
 * are all here rather than in code because the board is new and none of
 * these numbers are known to be right yet. The list is what the board is
 * DOING, which is the only way to see whether the thing works at all
 * before push and payments exist.
 */

type Settings = {
  enabled: boolean;
  sports: string[];
  minPlayers: number;
  maxPlayers: number;
  maxWindows: number;
  maxCountersPerSide: number;
  ttlDays: number;
  advancePct: number;
  paymentWindowMins: number;
  pushAudience: string;
  pushDailyCap: number;
  boardTitle: string | null;
  boardSubtitle: string | null;
  emptyText: string | null;
  homeCardEnabled: boolean;
  homeCardTitle: string | null;
  homeCardSubtitle: string | null;
  homeCardBadge: string;
};

type EventRow = {
  id: string;
  type: string;
  detail: string | null;
  createdAt: string;
  challengeId: string | null;
  user: { name: string | null; phone: string | null } | null;
};

type Row = {
  id: string;
  sport: string;
  teamName: string | null;
  playerCount: number;
  status: string;
  notes: string | null;
  expiresAt: string;
  createdAt: string;
  withdrawReason: string | null;
  createdBy: { name: string | null; phone: string | null } | null;
  acceptedBy: { name: string | null; phone: string | null } | null;
  windows: {
    id: string;
    date: string;
    startHour: number;
    endHour: number;
    proposedBy: string;
    status: string;
  }[];
  bookingId: string | null;
  payments: { side: string; amount: number; paidAt: string | null; refundedAt: string | null }[];
};

const SPORTS = ["CRICKET", "FOOTBALL", "PICKLEBALL"];

const STATUS_TONE: Record<string, string> = {
  OPEN: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  COUNTERED: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  AGREED: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  PART_PAID: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  CONFIRMED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  SLOT_LOST: "border-red-500/40 bg-red-500/10 text-red-300",
  EXPIRED: "border-zinc-700 bg-zinc-900 text-zinc-500",
  WITHDRAWN: "border-zinc-700 bg-zinc-900 text-zinc-500",
};

const hr = (h: number) => {
  const x = h % 24;
  return x === 0 ? "12am" : x < 12 ? `${x}am` : x === 12 ? "12pm" : `${x - 12}pm`;
};

export function ChallengesAdmin({
  initial,
}: {
  initial: {
    settings: Settings;
    challenges: Row[];
    counts: Record<string, number>;
    events: EventRow[];
    eventCounts: Record<string, number>;
    refusals: { reason: string; count: number }[];
    funnel: Record<string, number>;
  };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"board" | "activity" | "settings">("board");
  const [s, setS] = useState<Settings>(initial.settings);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = (patch: ChallengeSettingsInput) => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await saveChallengeSettings(patch).catch(() => ({
        ok: false as const,
        error: "Couldn't reach the server.",
      }));
      if (!res.ok) setErr(res.error);
      else {
        setMsg("Saved.");
        router.refresh();
      }
    });
  };

  const field = "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50";
  const label = "mb-1 block text-xs uppercase tracking-wide text-zinc-500";
  const hint = "mt-1 text-xs text-zinc-600 leading-relaxed";

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <Swords className="h-5 w-5 text-emerald-400" />
        <h1 className="text-xl font-bold text-white">Challenge board</h1>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs ${
            s.enabled
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-zinc-700 bg-zinc-900 text-zinc-500"
          }`}
        >
          {s.enabled ? "Live in the app" : "Off"}
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        A captain posts a match they can&apos;t fill; another takes it. App only —
        there is no customer web page for this.
      </p>

      <div className="mt-4 flex gap-2">
        {(["board", "activity", "settings"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              tab === t
                ? "border-emerald-500/40 bg-emerald-600/10 text-emerald-300"
                : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"
            }`}
          >
            {t === "board"
              ? `Challenges (${initial.challenges.length})`
              : t === "activity"
                ? `Activity (${initial.events.length})`
                : "Settings"}
          </button>
        ))}
      </div>

      {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
      {msg && <p className="mt-3 text-sm text-emerald-400">{msg}</p>}

      {tab === "activity" ? (
        <div className="mt-5 space-y-5">
          {/* The funnel answers the question an empty board cannot: did
              nobody find it, did they find it and leave, or did they try
              and get turned away. Each step is a count of people-actions
              over the last 30 days. */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="text-sm font-semibold text-white">Last 30 days</h2>
            <p className="mb-3 text-xs text-zinc-500">
              Where people stop. A board with no posts looks the same whether
              nobody looked or everybody was refused — this is what tells them apart.
            </p>
            <div className="space-y-1.5">
              {[
                ["Saw the home card", "cardShown"],
                ["Tapped the home card", "cardTapped"],
                ["Opened the board", "boardViewed"],
                ["Opened a challenge", "detailViewed"],
                ["Opened the post form", "postOpened"],
                ["Posted a challenge", "posted"],
                ["Counter-offered", "countered"],
                ["Agreed a match", "accepted"],
              ].map(([label, key]) => {
                const v = initial.funnel[key] ?? 0;
                // Scale every bar against the widest step, which is normally
                // the impression — the one number every later step is a
                // fraction of.
                const top = Math.max(
                  initial.funnel.cardShown ?? 0,
                  initial.funnel.cardTapped ?? 0,
                  initial.funnel.boardViewed ?? 0,
                  1,
                );
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-44 shrink-0 text-xs text-zinc-400">{label}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-zinc-950">
                      <div
                        className="h-full bg-emerald-600/40"
                        style={{ width: `${Math.min(100, (v / top) * 100)}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-300">
                      {v}
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center gap-3 border-t border-zinc-800 pt-2">
                <span className="w-44 shrink-0 text-xs text-amber-400">Turned away</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-zinc-950">
                  <div
                    className="h-full bg-amber-500/40"
                    style={{
                      width: `${Math.min(100, ((initial.funnel.refused ?? 0) / Math.max(initial.funnel.boardViewed ?? 0, 1)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-amber-400">
                  {initial.funnel.refused ?? 0}
                </span>
              </div>
            </div>
          </div>

          {initial.refusals.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
              <h2 className="text-sm font-semibold text-amber-200">Why people were refused</h2>
              <p className="mb-3 text-xs text-amber-200/60">
                The exact words they saw. If one of these dominates, it is usually a
                setting on the Settings tab rather than a bug.
              </p>
              <div className="space-y-1.5">
                {initial.refusals.map((r) => (
                  <div key={r.reason} className="flex justify-between gap-4 text-sm">
                    <span className="min-w-0 text-zinc-300">{r.reason}</span>
                    <span className="shrink-0 font-mono tabular-nums text-amber-300">
                      {r.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-zinc-800 bg-zinc-900">
            <div className="border-b border-zinc-800 px-5 py-4">
              <h2 className="text-sm font-semibold text-white">Everything that happened</h2>
              <p className="text-xs text-zinc-500">
                Newest first, last 300. Every tap that reaches the server.
              </p>
            </div>
            {initial.events.length === 0 ? (
              <p className="px-5 py-6 text-sm text-zinc-500">
                Nothing yet. Switch the board on and the trail starts here.
              </p>
            ) : (
              <div className="max-h-[32rem] overflow-y-auto">
                {initial.events.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-start gap-3 border-b border-zinc-800/60 px-5 py-2.5 text-sm last:border-b-0"
                  >
                    <span className="w-32 shrink-0 font-mono text-[11px] text-zinc-600">
                      {new Date(e.createdAt).toLocaleString("en-IN", {
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: "Asia/Kolkata",
                      })}
                    </span>
                    <span
                      className={`w-36 shrink-0 font-mono text-[11px] ${
                        e.type === "REFUSED"
                          ? "text-amber-400"
                          : e.type === "EXPIRED" || e.type === "WITHDRAWN"
                            ? "text-rose-400"
                            : e.type === "POSTED" || e.type === "ACCEPTED"
                              ? "text-emerald-400"
                              : "text-zinc-500"
                      }`}
                    >
                      {e.type.toLowerCase().replace(/_/g, " ")}
                    </span>
                    <span className="w-40 shrink-0 truncate text-xs text-zinc-400">
                      {e.user?.name || e.user?.phone || "—"}
                    </span>
                    <span className="min-w-0 flex-1 text-xs text-zinc-500">{e.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : tab === "settings" ? (
        <div className="mt-5 space-y-5">
          <Panel
            title="Master switch"
            desc="Off hides the board in the app and refuses new challenges. Anything already agreed is untouched."
          >
            <button
              onClick={() => {
                setS({ ...s, enabled: !s.enabled });
                save({ enabled: !s.enabled });
              }}
              disabled={pending}
              className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm font-medium ${
                s.enabled
                  ? "border-emerald-500/40 bg-emerald-600/10 text-emerald-300"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400"
              }`}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {s.enabled ? "Board is ON — tap to switch off" : "Board is OFF — tap to switch on"}
            </button>
          </Panel>

          <Panel title="Which sports" desc="Nothing selected means every sport the arena runs.">
            <div className="flex flex-wrap gap-2">
              {SPORTS.map((sp) => {
                const on = s.sports.includes(sp);
                return (
                  <button
                    key={sp}
                    disabled={pending}
                    onClick={() => {
                      const next = on ? s.sports.filter((x) => x !== sp) : [...s.sports, sp];
                      setS({ ...s, sports: next });
                      save({ sports: next });
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                      on
                        ? "border-emerald-500/40 bg-emerald-600/10 text-emerald-300"
                        : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    }`}
                  >
                    {sp[0] + sp.slice(1).toLowerCase()}
                  </button>
                );
              })}
            </div>
          </Panel>

          <Panel title="Posting" desc="What a captain may put up.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Num label="Minimum players" value={s.minPlayers} onSave={(v) => { setS({ ...s, minPlayers: v }); save({ minPlayers: v }); }} hint="Below this, a challenge can't be posted." />
              <Num label="Maximum players" value={s.maxPlayers} onSave={(v) => { setS({ ...s, maxPlayers: v }); save({ maxPlayers: v }); }} hint="Sanity ceiling on the squad size claimed." />
              <Num label="Times per challenge" value={s.maxWindows} onSave={(v) => { setS({ ...s, maxWindows: v }); save({ maxWindows: v }); }} hint="More windows means more matches made. One is allowed but mostly expires." />
              <Num label="Counter-offers per side" value={s.maxCountersPerSide} onSave={(v) => { setS({ ...s, maxCountersPerSide: v }); save({ maxCountersPerSide: v }); }} hint="Zero turns haggling off entirely — accept a time or leave it." />
              <Num label="Days a challenge lives" value={s.ttlDays} onSave={(v) => { setS({ ...s, ttlDays: v }); save({ ttlDays: v }); }} hint="It dies at this, or at its last offered time, whichever comes first." />
            </div>
          </Panel>

          <Panel
            title="Money"
            desc="Stored now, used when payments land. Both captains pay half the advance each."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Num label="Advance %" value={s.advancePct} onSave={(v) => { setS({ ...s, advancePct: v }); save({ advancePct: v }); }} hint="50 on a ₹2,000 slot = ₹500 from each side, ₹1,000 at the venue." />
              <Num label="Payment window (minutes)" value={s.paymentWindowMins} onSave={(v) => { setS({ ...s, paymentWindowMins: v }); save({ paymentWindowMins: v }); }} hint="How long they have to pay after agreeing, before it lapses." />
            </div>
          </Panel>

          <Panel title="Push" desc="Stored now, used when notifications land.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label}>Who hears about a new challenge</label>
                <select
                  className={field}
                  value={s.pushAudience}
                  disabled={pending}
                  onChange={(e) => {
                    setS({ ...s, pushAudience: e.target.value });
                    save({ pushAudience: e.target.value });
                  }}
                >
                  <option value="ALL">Everyone on the app</option>
                  <option value="SPORT">Everyone who plays that sport</option>
                  <option value="RECENT">Played in the last 90 days</option>
                </select>
                <p className={hint}>
                  Reach is what a cold board needs. Narrow it once there are enough
                  challenges that people start muting you.
                </p>
              </div>
              <Num label="Broadcasts per day" value={s.pushDailyCap} onSave={(v) => { setS({ ...s, pushDailyCap: v }); save({ pushDailyCap: v }); }} hint="Past this, challenges still post — they just go up quietly. Messages to the two people in a challenge never count against it." />
            </div>
          </Panel>

          <Panel
            title="Home screen card"
            desc="How people find this at all. Switchable separately from the board, so you can run challenges quietly and promote them once there is something to arrive to."
          >
            <div className="space-y-3">
              <button
                onClick={() => {
                  setS({ ...s, homeCardEnabled: !s.homeCardEnabled });
                  save({ homeCardEnabled: !s.homeCardEnabled });
                }}
                disabled={pending}
                className={`rounded-lg border px-4 py-2.5 text-sm font-medium ${
                  s.homeCardEnabled
                    ? "border-emerald-500/40 bg-emerald-600/10 text-emerald-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-400"
                }`}
              >
                {s.homeCardEnabled
                  ? "Showing on the home screen — tap to hide"
                  : "Hidden from the home screen — tap to show"}
              </button>
              <div>
                <label className={label}>Badge</label>
                <select
                  className={field}
                  value={s.homeCardBadge}
                  disabled={pending}
                  onChange={(e) => {
                    setS({ ...s, homeCardBadge: e.target.value });
                    save({ homeCardBadge: e.target.value });
                  }}
                >
                  <option value="NEW">NEW</option>
                  <option value="BETA">BETA</option>
                  <option value="NONE">No badge</option>
                </select>
                <p className={hint}>
                  NEW invites a tap. BETA warns. Drop the badge once it stops being
                  news, or it becomes wallpaper.
                </p>
              </div>
              <Txt label="Card title" value={s.homeCardTitle} onSave={(v) => { setS({ ...s, homeCardTitle: v }); save({ homeCardTitle: v }); }} />
              <Txt label="Card subtitle" value={s.homeCardSubtitle} onSave={(v) => { setS({ ...s, homeCardSubtitle: v }); save({ homeCardSubtitle: v }); }} />
            </div>
          </Panel>

          <Panel title="Wording" desc="What the board says in the app. Blank uses the built-in copy.">
            <div className="space-y-3">
              <Txt label="Board title" value={s.boardTitle} onSave={(v) => { setS({ ...s, boardTitle: v }); save({ boardTitle: v }); }} />
              <Txt label="Board subtitle" value={s.boardSubtitle} onSave={(v) => { setS({ ...s, boardSubtitle: v }); save({ boardSubtitle: v }); }} />
              <Txt label="Empty board message" value={s.emptyText} onSave={(v) => { setS({ ...s, emptyText: v }); save({ emptyText: v }); }} />
            </div>
          </Panel>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            {Object.entries(initial.counts).map(([k, v]) => (
              <span
                key={k}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${STATUS_TONE[k] ?? "border-zinc-700 text-zinc-400"}`}
              >
                {k.replace("_", " ").toLowerCase()} {v}
              </span>
            ))}
            {initial.challenges.length === 0 && (
              <p className="text-sm text-zinc-500">
                Nothing posted yet. Switch the board on and it&apos;ll show up here.
              </p>
            )}
          </div>

          {/* The consequence of "block the court on the first payment". One
              captain's money is in, the hour is off the board, and the other
              half may never arrive — so the venue has a real decision to
              make on each of these: chase it, take the balance at the gate,
              or cancel the booking and refund. Nothing here resolves itself,
              deliberately: auto-cancelling would release a court the venue
              may already have promised on the phone. */}
          {(() => {
            const stranded = initial.challenges.filter(
              (c) => c.status === "PART_PAID" && c.payments.some((p) => p.paidAt && !p.refundedAt),
            );
            if (stranded.length === 0) return null;
            return (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
                <p className="text-sm font-medium text-amber-300">
                  Half paid — the court is blocked and someone still owes
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  One side has paid and the hour is held. Chase the other half, take it at
                  the gate, or cancel the booking and refund what was paid.
                </p>
                <div className="mt-3 space-y-2">
                  {stranded.map((c) => {
                    const held = c.payments
                      .filter((p) => p.paidAt && !p.refundedAt)
                      .reduce((sum, p) => sum + p.amount, 0);
                    const owing = c.payments.find((p) => !p.paidAt);
                    const win = c.windows.find((w) => w.status === "ACCEPTED");
                    const owes =
                      owing?.side === "CHALLENGER" ? c.createdBy : c.acceptedBy;
                    return (
                      <div
                        key={c.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-300"
                      >
                        <span className="font-medium text-zinc-100">
                          {c.teamName || c.createdBy?.name || "A team"}
                        </span>
                        {win && (
                          <span className="text-zinc-400">
                            {new Date(win.date).toISOString().slice(0, 10)} {hr(win.startHour)}–
                            {hr(win.endHour)}
                          </span>
                        )}
                        <span className="text-emerald-300">₹{held} held</span>
                        {owes && (
                          <span className="text-amber-300">
                            {owes.name ?? "the other captain"} owes
                            {owes.phone ? ` · ${owes.phone}` : ""}
                          </span>
                        )}
                        {c.bookingId && (
                          <a
                            href={`/admin/bookings/${c.bookingId}`}
                            className="rounded border border-sky-500/40 px-2 py-0.5 text-sky-300 hover:bg-sky-500/10"
                          >
                            open booking
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {initial.challenges.map((c) => (
            <div key={c.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">
                      {c.teamName || c.createdBy?.name || "A team"}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[c.status] ?? ""}`}
                    >
                      {c.status.replace("_", " ").toLowerCase()}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {c.sport[0] + c.sport.slice(1).toLowerCase()} · {c.playerCount} players
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {c.createdBy?.name || "—"} {c.createdBy?.phone || ""}
                    {c.acceptedBy && ` · taken by ${c.acceptedBy.name || c.acceptedBy.phone}`}
                  </p>
                  {c.notes && <p className="mt-1 text-sm text-zinc-400">{c.notes}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.windows.map((w) => (
                      <span
                        key={w.id}
                        className={`rounded border px-2 py-0.5 text-[11px] ${
                          w.status === "ACCEPTED"
                            ? "border-emerald-500/40 text-emerald-300"
                            : w.status === "OFFERED"
                              ? "border-zinc-700 text-zinc-400"
                              : "border-zinc-800 text-zinc-600 line-through"
                        }`}
                      >
                        {new Date(w.date).toISOString().slice(0, 10)} {hr(w.startHour)}–{hr(w.endHour)}
                        <span className="ml-1 text-zinc-600">
                          {w.proposedBy === "CHALLENGER" ? "them" : "reply"}
                        </span>
                      </span>
                    ))}
                  </div>
                  {c.payments.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      {(["CHALLENGER", "ACCEPTOR"] as const).map((sideKey) => {
                        const pay = c.payments.find((x) => x.side === sideKey);
                        const who = sideKey === "CHALLENGER" ? "poster" : "taker";
                        if (!pay) {
                          return (
                            <span key={sideKey} className="rounded border border-zinc-800 px-2 py-0.5 text-zinc-600">
                              {who}: nothing yet
                            </span>
                          );
                        }
                        return (
                          <span
                            key={sideKey}
                            className={`rounded border px-2 py-0.5 ${
                              pay.refundedAt
                                ? "border-zinc-700 text-zinc-500 line-through"
                                : pay.paidAt
                                  ? "border-emerald-500/40 text-emerald-300"
                                  : "border-amber-500/40 text-amber-300"
                            }`}
                          >
                            {who}: ₹{pay.amount} {pay.refundedAt ? "refunded" : pay.paidAt ? "paid" : "started, unpaid"}
                          </span>
                        );
                      })}
                      {c.bookingId && (
                        <a
                          href={`/admin/bookings/${c.bookingId}`}
                          className="rounded border border-sky-500/40 px-2 py-0.5 text-sky-300 hover:bg-sky-500/10"
                        >
                          court blocked → booking
                        </a>
                      )}
                    </div>
                  )}
                  {c.withdrawReason && (
                    <p className="mt-2 text-xs text-amber-400">Taken down: {c.withdrawReason}</p>
                  )}
                </div>
                {!["CONFIRMED", "WITHDRAWN", "EXPIRED"].includes(c.status) && (
                  <button
                    disabled={pending}
                    onClick={() => {
                      const reason = window.prompt(
                        "Why are you taking this down? The poster sees this.",
                      );
                      if (!reason) return;
                      start(async () => {
                        const res = await adminWithdrawChallenge(c.id, reason).catch(() => ({
                          ok: false as const,
                          error: "Couldn't reach the server.",
                        }));
                        if (!res.ok) setErr(res.error);
                        else router.refresh();
                      });
                    }}
                    className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-red-500/40 hover:text-red-400"
                  >
                    Take down
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-3 flex items-start gap-2">
        <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" />
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <p className="text-xs text-zinc-500">{desc}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

/** A number that saves when you leave the field, not on every keystroke. */
function Num({
  label,
  value,
  onSave,
  hint,
}: {
  label: string;
  value: number;
  onSave: (v: number) => void;
  hint?: string;
}) {
  const [v, setV] = useState(String(value));
  return (
    <div>
      <label className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">{label}</label>
      <input
        inputMode="numeric"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = parseInt(v.replace(/[^\d]/g, ""), 10);
          if (Number.isInteger(n) && n !== value) onSave(n);
          else setV(String(value));
        }}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
      />
      {hint && <p className="mt-1 text-xs leading-relaxed text-zinc-600">{hint}</p>}
    </div>
  );
}

function Txt({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string | null;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(value ?? "");
  return (
    <div>
      <label className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">{label}</label>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (v !== (value ?? "")) onSave(v);
        }}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
      />
    </div>
  );
}
