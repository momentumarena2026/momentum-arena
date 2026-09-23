"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Swords, Settings2 } from "lucide-react";
import {
  resolvePushes,
  PUSH_VARIABLES,
  LIFECYCLE_VARIABLES,
  LIFECYCLE_LABELS,
  DEFAULT_LIFECYCLE_PUSHES,
  OWNER_VARIABLES,
  DEFAULT_OWNER_REFUND_PUSH,
  type LifecyclePush,
  DEFAULT_WON_PUSH,
  DEFAULT_ADJACENT_PUSHES,
  DEFAULT_FALLBACK_PUSHES,
  POSTED_VARIABLES,
  DEFAULT_POSTED_PUSH,
} from "@/lib/challenge-push";
import { DEFAULT_WHEEL, wheelRefusal, resolveWheel } from "@/lib/challenge-rules";
import {
  saveChallengeSettings,
  adminWithdrawChallenge,
  markChallengePaymentRefunded,
  type ChallengeSettingsInput,
} from "@/actions/admin-challenges";
import { ChallengesGuide } from "./challenges-guide";

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
  pushRecentDays: number;
  postedPush: unknown;
  postedPushEnabled: boolean;
  boardTitle: string | null;
  boardSubtitle: string | null;
  emptyText: string | null;
  homeCardEnabled: boolean;
  homeCardTitle: string | null;
  homeCardSubtitle: string | null;
  homeCardBadge: string;
  minLeadMins: number;
  spinEnabled: boolean;
  spinSegments: unknown;
  spinAvgMinPct: number;
  spinAvgMaxPct: number;
  spinAdjacentWindowMins: number;
  spinFallbackWindowMins: number;
  spinFallbackDays: number;
  spinAdjacentOnly: boolean;
  spinSameSizeOnly: boolean;
  spinsPerPosterCap: number;
  spinsPerPosterPerDays: number;
  spinWonPush: unknown;
  ownerRefundPush: unknown;
  suggestedPush: unknown;
  suggestOkPush: unknown;
  suggestNoPush: unknown;
  agreedPush: unknown;
  payHalfPush: unknown;
  confirmedPush: unknown;
  slotLostPush: unknown;
  refundOwedPush: unknown;
  spinAdjacentPushes: unknown;
  spinFallbackPushes: unknown;
};

type PromoStats = {
  spins: number;
  offersMade: number;
  offersTaken: number;
  offersLapsed: number;
  adjacentMade: number;
  adjacentTaken: number;
  fallbackMade: number;
  fallbackTaken: number;
  discounted: number;
  collected: number;
  wheelMeanPct: number;
  realisedCostPct: number;
  byPct: { pct: number; count: number }[];
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
    /** Set once the poster agreed to a time somebody else suggested. */
    approvedAt: string | null;
  }[];
  bookingId: string | null;
  /** So the board can tell a live court from one that has been cancelled. */
  bookingStatus: string | null;
  payments: {
    side: string;
    amount: number;
    paidAt: string | null;
    placedAt: string | null;
    refundedAt: string | null;
    refundOwedAt: string | null;
    refundOwedReason: string | null;
    user: { name: string | null; phone: string | null } | null;
  }[];
};

/** The five lifecycle messages, as settings keys. Mirrors the server's list. */
const LIFECYCLE_KEYS = [
  "suggestedPush",
  "suggestOkPush",
  "suggestNoPush",
  "agreedPush",
  "payHalfPush",
  "confirmedPush",
  "slotLostPush",
  "refundOwedPush",
] as const;

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

/**
 * One line of the refunds queue, with the control that closes it out.
 *
 * The panel used to tell the venue to "mark it refunded on the payment" when
 * nothing in the product could do that. So the list only ever grew, its
 * total never fell, and — because the take-down guard counted flagged money
 * as still held — a challenge whose money was flagged could never be closed
 * either. The refund itself is made by hand in Razorpay or in cash; this
 * records the arena's own act, and says so, rather than pretending to move
 * money it does not move.
 */
function RefundRow({
  row,
}: {
  row: {
    id: string;
    source: "payment" | "order";
    side: string;
    amount: number;
    owedAt: string;
    reason: string | null;
    user: { name: string | null; phone: string | null } | null;
    challengeId: string;
    teamName: string | null;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-rose-500/20 bg-zinc-950/40 p-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-300">
        <span className="font-medium text-zinc-100">
          {row.user?.name ?? "A captain"}
          {row.user?.phone ? ` · ${row.user.phone}` : ""}
        </span>
        <span className="font-medium text-rose-300">₹{row.amount}</span>
        <span className="text-zinc-400">{row.side.toLowerCase()}</span>
        {row.teamName && <span className="text-zinc-500">{row.teamName}</span>}
        {row.source === "order" && (
          <span className="rounded border border-zinc-700 px-1.5 text-zinc-500">no live slot</span>
        )}
        <span className="text-zinc-600">
          {new Date(row.owedAt).toISOString().slice(0, 16).replace("T", " ")}
        </span>
        <button
          disabled={pending}
          onClick={() => {
            const note = window.prompt(
              `Mark ₹${row.amount} as refunded to ${row.user?.name ?? "this captain"}?\n\nRefund it in Razorpay (or in cash) FIRST — this only records that you did.\n\nReference or note (optional):`,
              "",
            );
            // A cancelled prompt returns null. An empty string is a
            // deliberate "no note", which is fine.
            if (note === null) return;
            setErr(null);
            start(async () => {
              const res = await markChallengePaymentRefunded(row.id, note, row.source).catch(() => ({
                ok: false as const,
                error: "Couldn't reach the server.",
              }));
              if (!res.ok) setErr(res.error);
              else router.refresh();
            });
          }}
          className="ml-auto rounded border border-emerald-500/40 px-2 py-0.5 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
        >
          {pending ? "…" : "mark refunded"}
        </button>
      </div>
      {row.reason && <p className="mt-1 text-xs text-zinc-500">{row.reason}</p>}
      {err && <p className="mt-1 text-xs text-rose-400">{err}</p>}
    </div>
  );
}

export function ChallengesAdmin({
  initial,
}: {
  initial: {
    settings: Settings;
    challenges: Row[];
    halfPaid: {
      id: string;
      status: string;
      teamName: string | null;
      bookingId: string | null;
      held: number;
      /** Of `held`, how much never reached a booking. Needs a person. */
      stuck: number;
      owes: { name: string | null; phone: string | null } | null;
      window: { date: string; startHour: number; endHour: number } | null;
    }[];
    refundsOwed: {
      id: string;
      /** Which table the debt lives in — a payment row, or the order ledger
       *  for captures no payment row can account for any more. */
      source: "payment" | "order";
      side: string;
      amount: number;
      owedAt: string;
      reason: string | null;
      user: { name: string | null; phone: string | null } | null;
      challengeId: string;
      teamName: string | null;
    }[];
    counts: Record<string, number>;
    events: EventRow[];
    eventCounts: Record<string, number>;
    refusals: { reason: string; count: number }[];
    funnel: Record<string, number>;
    promo: PromoStats;
  };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"board" | "activity" | "promo" | "settings" | "guide">("board");
  const [s, setS] = useState<Settings>(initial.settings);

  /**
   * Re-seed the form from the server whenever the page's data changes.
   *
   * `router.refresh()` re-renders the server component but cannot reach into
   * this state, so after a save the screen kept showing what was TYPED
   * rather than what was STORED. The server normalises — titles truncated to
   * 200 characters, sports deduped — so a venue typing a 238-character board
   * title was shown their full sentence while the app served a string cut
   * mid-word. And because the wheel banner derives from this state, saving a
   * custom wheel left the screen insisting the built-in one was live.
   */
  useEffect(() => {
    setS(initial.settings);
  }, [initial.settings]);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  /**
   * Save, and ROLL BACK what the screen shows if the server says no.
   *
   * Every control applies its value optimistically before calling this, so
   * a refused save used to leave the rejected number on screen for ever:
   * `router.refresh()` only runs on success, and the re-sync effect saw the
   * prop arrive already equal to the rejected value. Worse, derived UI —
   * the wheel's in-band banner, its Save button — was then computed from a
   * band the database had rejected. The snapshot is taken before the write
   * and restored on failure, so the form always shows what is stored.
   *
   * The server also normalises (titles truncated, sports deduped), so a
   * refresh follows a success too — "Saved." must not mean "and exactly
   * what you typed".
   */
  const save = (patch: ChallengeSettingsInput) => {
    setErr(null);
    setMsg(null);
    const before = s;
    start(async () => {
      const res = await saveChallengeSettings(patch).catch(() => ({
        ok: false as const,
        error: "Couldn't reach the server.",
      }));
      if (!res.ok) {
        setErr(res.error);
        setS(before);
      } else {
        setMsg("Saved.");
        router.refresh();
      }
    });
  };

  const field = "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50";
  const label = "mb-1 block text-xs uppercase tracking-wide text-zinc-500";
  const hint = "mt-1 text-xs text-zinc-600 leading-relaxed";

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 pb-24">
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

      {/* Five tabs did not fit a phone and the row did not wrap, so the last
          two were simply off-screen with no way to reach them. Scrolled
          rather than wrapped: wrapping costs three lines on a narrow screen
          and pushes the board itself below the fold. */}
      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {(["board", "activity", "promo", "settings", "guide"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm ${
              tab === t
                ? "border-emerald-500/40 bg-emerald-600/10 text-emerald-300"
                : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"
            }`}
          >
            {t === "board"
              ? `Challenges (${initial.challenges.length}${initial.challenges.length >= 200 ? "+" : ""})`
              : t === "activity"
                ? `Activity (${initial.events.length}${initial.events.length >= 300 ? "+" : ""})`
                : t === "promo"
                  ? `Prize wheel (${initial.promo.spins})`
                  : t === "settings"
                    ? "Settings"
                    : "How it works"}
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
                The exact words they saw — the module's own money bookkeeping is logged
                separately and does not appear here. If one of these dominates, it is usually a
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
      ) : tab === "promo" ? (
        <PromoTab initial={initial} s={s} setS={setS} save={save} pending={pending} />
      ) : tab === "guide" ? (
        <div className="mt-4">
          <ChallengesGuide
            segments={s.spinSegments as { pct: number; weight: number }[] | null}
            advancePct={s.advancePct}
          />
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
              <Num
                label="Notice needed before a slot (minutes)"
                value={s.minLeadMins}
                onSave={(v) => {
                  setS({ ...s, minLeadMins: v });
                  save({ minLeadMins: v });
                }}
                hint="No posting or accepting inside this, and the payment that buys the court is refused inside it too. The next-hour prize is exempt — same session, staff already there. (This used to live on the Prize wheel tab, which is not where anybody looked for it: it gates posting and paying, and a venue running the board with the wheel switched off never saw it.)"
              />
              <Num label="Days a challenge lives" value={s.ttlDays} onSave={(v) => { setS({ ...s, ttlDays: v }); save({ ttlDays: v }); }} hint="It dies at this, or at its last offered time, whichever comes first." />
            </div>
          </Panel>

          <Panel
            title="Money"
            desc="Stored now, used when payments land. Both captains pay half the advance each."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Num label="Advance %" value={s.advancePct} onSave={(v) => { setS({ ...s, advancePct: v }); save({ advancePct: v }); }} hint="50 on a ₹2,000 slot = ₹500 from each side, ₹1,000 at the venue. Zero switches challenge payments off entirely — nobody can take a challenge." />
              <Num label="Payment window (minutes)" value={s.paymentWindowMins} onSave={(v) => { setS({ ...s, paymentWindowMins: v }); save({ paymentWindowMins: v }); }} hint="How long a payment slot is held for whoever opened it — including somebody who opened the sheet and walked away. For that whole time every other captain who taps Pay is told the slot is taken, and the match sits on the board un-takeable. The holder can now hand it back early, but nobody else can. It protects a UPI collect still resolving at the bank, which is minutes, not hours — so treat this as a few minutes plus a margin, not a session length. It does NOT expire the challenge; that happens at the match time or the TTL." />
            </div>
          </Panel>

          {/* The Push panel is back.
              It was pulled because `pushAudience` and `pushDailyCap` were
              saved, validated, bounded — and read by nothing: there was no
              new-challenge broadcast in the module at all, so the controls
              described behaviour the product did not have. That is worse
              than an absent control, because the venue sets it, believes it,
              and wonders why the board stays quiet. The broadcast exists
              now (`announceNewChallenges`, on the per-minute sweep), and
              every field below is read by it. Do not re-add a field here
              that nothing consumes. */}
          <Panel
            title="Telling people a match is up"
            desc="The only message in this module that reaches people who are not in the match. Everything else goes to the two captains involved; this lands on strangers' phones, which is why it has its own switch and its own daily ceiling."
          >
            <Toggle
              label="Announce new challenges"
              value={s.postedPushEnabled}
              onChange={(v) => { setS({ ...s, postedPushEnabled: v }); save({ postedPushEnabled: v }); }}
            />
            <p className={hint}>
              Off, the board still works exactly as it does now — people find
              a match by opening it. On, a post goes out to the audience below
              about a minute after it is made.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label}>Who hears it</label>
                <select
                  className={field}
                  value={s.pushAudience}
                  disabled={pending}
                  onChange={(e) => {
                    setS({ ...s, pushAudience: e.target.value });
                    save({ pushAudience: e.target.value });
                  }}
                >
                  <option value="ALL">Everyone with the app</option>
                  <option value="SPORT">People who have played that sport</option>
                  <option value="RECENT">People who booked recently</option>
                </select>
                <p className={hint}>
                  The poster never gets their own announcement. Everyone means
                  every phone signed in to the app — the widest reach and the
                  fastest way to train people to mute you, which is what the
                  cap next to it is for.
                </p>
              </div>
              <Num
                label="Announcements per day"
                value={s.pushDailyCap}
                onSave={(v) => { setS({ ...s, pushDailyCap: v }); save({ pushDailyCap: v }); }}
                hint="A hard ceiling across the whole board, not per person. Past it, challenges still post — they just go up quietly. Zero switches announcements off the same as the toggle above."
              />
            </div>

            <Num
              label="“Recently” means this many days"
              value={s.pushRecentDays}
              onSave={(v) => { setS({ ...s, pushRecentDays: v }); save({ pushRecentDays: v }); }}
              hint="Only used when the audience above is set to people who booked recently."
            />

            <PushEditor
              title="The announcement"
              desc="Sent about a minute after a match goes up. A tap opens that match."
              single
              variables={POSTED_VARIABLES}
              value={asPushList(s.postedPush, [DEFAULT_POSTED])}
              onSave={(list) => {
                setS({ ...s, postedPush: list[0] });
                save({ postedPush: { title: list[0].title, body: list[0].body } });
              }}
            />
            <p className={hint}>
              There is no {"{name}"} here on purpose. This message goes to
              people the poster has never met, so it can name a team and never
              a person.
            </p>
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
                {initial.settings.enabled
                  ? "Nothing posted yet. It'll show up here the moment somebody puts a match up."
                  : "Nothing posted yet — and the board is switched off, so nobody can."}
              </p>
            )}
          </div>

          {/* Money the arena has taken and cannot honour. Every branch of
              the payment code that refuses a CAPTURED payment stamps
              `refundOwedAt`, so this is a query rather than a reading of the
              activity feed — which is how these used to be found, i.e. when
              the customer rang up. Asked for server-side and uncapped: the
              old version derived it from the 200 most recent challenges, so
              the oldest unrefunded capture would eventually drop out of the
              one view that exists to remember it. */}
          {initial.refundsOwed.length > 0 && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4">
              <p className="text-sm font-medium text-rose-300">
                Refunds owed — ₹{initial.refundsOwed.reduce((t, r) => t + r.amount, 0)} taken and
                not honoured
              </p>
              <p className="mt-0.5 text-xs text-zinc-400">
                These captures arrived after the match could no longer be held, and each payer has
                already been told a refund is coming. Refund in Razorpay (or in cash at the
                counter), then mark it here — that is what clears it from this list and lets the
                challenge be taken down.
              </p>
              <div className="mt-3 space-y-2">
                {initial.refundsOwed.map((r) => (
                  <RefundRow key={r.id} row={r} />
                ))}
              </div>
            </div>
          )}

          {/* The consequence of "the court is bought only when BOTH have
              paid". One captain's money is in, the hour is still on sale, and
              the second half may never arrive — so the venue is holding money
              against nothing. Two ways out, and both need a person: chase the
              other captain, or refund the half that paid.

              The urgent case is the reverse one: if the hour gets sold to
              somebody else while a challenge sits here, the cron discards the
              challenge, refunds are flagged, and you get a push naming whose
              money you owe. This panel is what you work through BEFORE that
              happens.

              Computed on the server now, from DISTINCT SIDES PAID rather
              than from a count of rows. Rows are created lazily, one per
              side, when that side opens a payment sheet — so the canonical
              case (one captain paid, the other has not started) has exactly
              one row, and the old `!every(paid)` test was vacuously false on
              it. The panel built for that case was the one case it missed. */}
          {initial.halfPaid.length > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
              <p className="text-sm font-medium text-amber-300">
                Half paid — money in, hour NOT held
              </p>
              <p className="mt-0.5 text-xs text-zinc-400">
                Money is in and the court is still on sale, because it is only taken off sale
                once both halves are in. Chase the captain who still owes — or, to give the
                money back, use <strong>Take down</strong> on the challenge's own card below:
                that is what flags the refund and tells everyone. If somebody else books the
                hour first the challenge is discarded automatically and you are told whose
                money to return.
              </p>
              <div className="mt-3 space-y-2">
                {initial.halfPaid.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-300"
                  >
                    <span className="font-medium text-zinc-100">
                      {c.teamName || "A team"}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 ${STATUS_TONE[c.status] ?? "border-zinc-700 text-zinc-400"}`}
                    >
                      {c.status.replace("_", " ").toLowerCase()}
                    </span>
                    {c.window && (
                      <span className="text-zinc-400">
                        {new Date(c.window.date).toISOString().slice(0, 10)} {hr(c.window.startHour)}
                        –{hr(c.window.endHour)}
                      </span>
                    )}
                    <span className="text-emerald-300">₹{c.held} held</span>
                    {/* The breakdown was computed server-side and never shown,
                        so a stuck capture was invisible inside a single
                        "₹1000 held" — and it is the half that needs a person. */}
                    {c.stuck > 0 && (
                      <span className="text-rose-300">
                        ₹{c.stuck} of it captured but not on a booking
                      </span>
                    )}
                    {c.owes ? (
                      <span className="text-amber-300">
                        {c.owes.name ?? "the other captain"} owes
                        {c.owes.phone ? ` · ${c.owes.phone}` : ""}
                      </span>
                    ) : (
                      <span className="text-zinc-500">
                        {c.stuck > 0
                          ? "both captains have paid — one capture never reached a booking"
                          : "nobody has taken the other half yet"}
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
                ))}
              </div>
            </div>
          )}

          {initial.challenges.map((c) => (
            <div key={c.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* The whole story is one tap away. The card shows a
                        STATUS, and a status is a summary — who agreed with
                        whom, what they turned down, whether anybody paid and
                        why it is sitting where it is all live on the detail
                        page. Working that out used to mean reading the
                        source. */}
                    <a
                      href={`/admin/challenges/${c.id}`}
                      className="font-medium text-white underline decoration-zinc-700 underline-offset-4 hover:decoration-emerald-400"
                    >
                      {c.teamName || c.createdBy?.name || "A team"}
                    </a>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[c.status] ?? ""}`}
                    >
                      {c.status.replace("_", " ").toLowerCase()}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {c.sport[0] + c.sport.slice(1).toLowerCase()} · {c.playerCount} players
                    </span>
                  </div>
                  <p className="mt-0.5 break-words text-xs text-zinc-500">
                    {c.createdBy?.name || "—"} {c.createdBy?.phone || ""}
                    {c.acceptedBy && ` · taken by ${c.acceptedBy.name || c.acceptedBy.phone}`}
                  </p>
                  {c.notes && (
                    <p className="mt-1 break-words text-sm text-zinc-400">{c.notes}</p>
                  )}
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
                          {w.proposedBy === "CHALLENGER"
                            ? "them"
                            : w.approvedAt
                              ? "agreed"
                              : "asked"}
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
                            {who}: ₹{pay.amount}{" "}
                            {pay.refundedAt
                              ? "refunded"
                              : pay.refundOwedAt
                                ? "refund owed"
                                : pay.paidAt && !pay.placedAt
                                  ? "captured, not on a booking"
                                  : pay.paidAt
                                    ? "paid"
                                    : "started, unpaid"}
                          </span>
                        );
                      })}
                      {c.bookingId && (
                        <a
                          href={`/admin/bookings/${c.bookingId}`}
                          className="rounded border border-sky-500/40 px-2 py-0.5 text-sky-300 hover:bg-sky-500/10"
                        >
                          booked → open booking
                        </a>
                      )}
                    </div>
                  )}
                  {c.withdrawReason && (
                    <p className="mt-2 text-xs text-amber-400">Taken down: {c.withdrawReason}</p>
                  )}
                </div>
                {/* SHOWN WHEN MONEY IS IN — that is the case it exists for.
                    The old condition hid the button whenever any capture was
                    unrefunded, which is precisely the state `adminWithdrawChallenge`
                    was rewritten to handle: it flags every capture, tells each
                    payer and tells the arena. Hiding it left a PART_PAID
                    challenge as a permanent dead row whose only on-screen
                    instruction pointed at a refunds panel the payment was not
                    on and nothing could put it on. The comment that used to sit
                    here described the pre-redesign model, where a first payment
                    created a PENDING booking; it does not any more.

                    A challenge that HAS a booking still goes through the
                    booking — the server says so in its own words. */}
                {!["WITHDRAWN", "EXPIRED"].includes(c.status) &&
                  // A CANCELLED booking is not a booking. Hiding the button on
                  // status alone left a challenge holding two captures with no
                  // control anywhere once the venue cancelled its court.
                  (!c.bookingId || c.bookingStatus === "CANCELLED") && (
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
  const [why, setWhy] = useState<string | null>(null);
  // Re-sync when the server value changes — including when a save is
  // REFUSED and the prop comes back unchanged. Without this the field kept
  // displaying a number the database never accepted.
  useEffect(() => {
    setV(String(value));
    setWhy(null);
  }, [value]);
  return (
    <div>
      <label className="mb-1 block text-xs uppercase tracking-wide text-zinc-500">{label}</label>
      <input
        inputMode="numeric"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          // Parse what was actually typed rather than stripping it to
          // digits: "-5" used to save as 5 and "2.5" as 25, so the value
          // that reached the database was not the one on screen and the
          // server's bounds check judged an already-mangled number.
          const n = Number(v.trim());
          if (Number.isInteger(n)) {
            setWhy(null);
            if (n !== value) onSave(n);
          } else {
            // SAY SO. Reverting in silence looked like the edit had been
            // taken and then lost, which is the one thing a settings screen
            // must never do.
            setWhy("Whole numbers only — that edit wasn't saved.");
            setV(String(value));
          }
        }}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
      />
      {why && <p className="mt-1 text-xs text-amber-400">{why}</p>}
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
  // Re-sync from the server, exactly as `Num` and `PushEditor` do. Without it
  // this editor showed what was TYPED rather than what was STORED: a
  // 214-character message was displayed in full, "Saved." and all, while the
  // app served the 200 characters the server had truncated it to. The
  // page-level effect cannot reach into a mounted child.
  useEffect(() => setV(value ?? ""), [value]);
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

/**
 * The prize wheel, and what it has actually cost.
 *
 * The editor deliberately does NOT take an average as an input. Average,
 * floor and ceiling are not independent — set floor 15, ceiling 50 and
 * average 25 and there may be no distribution that satisfies it. So the
 * venue edits segments and weights, and this screen shows the arithmetic
 * that follows: the average, each segment's odds, and what 100 spins costs
 * on a typical hour. Saving is refused when the derived average leaves the
 * band, because a wheel paying 40% looks exactly like one paying 18% until
 * the month's numbers arrive.
 */
function PromoTab({
  initial,
  s,
  setS,
  save,
  pending,
}: {
  initial: { promo: PromoStats };
  s: Settings;
  setS: (v: Settings) => void;
  save: (patch: Record<string, unknown>) => void;
  pending: boolean;
}) {
  // An EMPTY list resolves to the built-in wheel in both the validator and
  // the runtime, so the editor has to show that too. Rendering zero
  // segments told the venue the wheel averaged 0% and "won't save" while a
  // 17.75% wheel was live.
  // DRAFT state, local to this editor.
  //
  // Segment edits happen keystroke by keystroke and are saved in a LATER
  // event, so writing them straight into `s` defeated the snapshot rollback
  // entirely: by the time Save ran, the snapshot already contained the
  // rejected values. A refused wheel then stayed on screen for ever and kept
  // driving the average, the in-band banner and the Save button — which is
  // precisely the failure that rollback was added to prevent.
  const stored = Array.isArray(s.spinSegments)
    ? (s.spinSegments as { pct: number; weight: number }[])
    : null;
  const usingBuiltInWheel = !stored || stored.length === 0;
  const serverSegs = resolveWheel(s.spinSegments);
  const [draft, setDraft] = useState<{ pct: number; weight: number }[]>(serverSegs);
  // Re-sync when the SERVER's wheel changes — after a successful save, or a
  // refusal that leaves it untouched.
  useEffect(() => setDraft(serverSegs), [JSON.stringify(serverSegs)]);
  const segs = draft;
  const dirty = JSON.stringify(draft) !== JSON.stringify(serverSegs);
  const total = segs.reduce((t, x) => t + Math.max(0, x.weight), 0);
  const avg = total > 0 ? segs.reduce((t, x) => t + x.pct * Math.max(0, x.weight), 0) / total : 0;
  // The SAME rule the server applies, not a weaker local approximation.
  // Gating on the band alone let 20.5% through — inside 15–25 — and the
  // server then refused it for being fractional, with nothing to roll back
  // to because the draft was already in `s`.
  const wheelProblem = wheelRefusal(draft, s.spinAvgMinPct, s.spinAvgMaxPct);
  const inBand = !wheelProblem;
  const p = initial.promo;
  // A representative hour, so "what does this cost" is a rupee figure the
  // venue can argue with rather than a percentage they have to translate.
  const SAMPLE_HOUR = 2000;

  const setSegs = (next: { pct: number; weight: number }[]) => setDraft(next);

  return (
    <div className="mt-5 space-y-5">
      <Panel
        title="The wheel"
        desc="Switched separately from the board, so the promo can be paused without taking challenges down."
      >
        <Toggle
          label="Prize wheel running"
          value={s.spinEnabled}
          onChange={(v) => {
            setS({ ...s, spinEnabled: v });
            save({ spinEnabled: v });
          }}
        />
      </Panel>

      <Panel
        title="Segments and weights"
        desc="Edit these; the average is what follows from them. A higher weight means that slice wins more often — but NOT a bigger slice on screen: the app draws every segment as an equal wedge, so the weights decide the odds and nothing else. Keep the list short enough to read on a phone; past a dozen segments the labels stop fitting."
      >
        {usingBuiltInWheel && (
          <p className="mb-3 rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
            You haven&apos;t saved your own wheel yet — these are the built-in segments, and
            they are what is running right now.
          </p>
        )}
        <div className="space-y-2">
          {segs.map((seg, i) => {
            const chance = total > 0 ? (Math.max(0, seg.weight) / total) * 100 : 0;
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  type="number"
                  value={seg.pct}
                  min={0}
                  max={100}
                  onChange={(e) => {
                    const next = [...segs];
                    next[i] = { ...seg, pct: Number(e.target.value) };
                    setSegs(next);
                  }}
                  className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
                />
                <span className="text-zinc-500">% off, weight</span>
                <input
                  type="number"
                  value={seg.weight}
                  min={0}
                  onChange={(e) => {
                    const next = [...segs];
                    next[i] = { ...seg, weight: Number(e.target.value) };
                    setSegs(next);
                  }}
                  className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
                />
                <span className="w-32 tabular-nums text-zinc-400">
                  {chance.toFixed(1)}% of spins
                </span>
                <span className="w-28 tabular-nums text-zinc-500">
                  1 in {chance > 0 ? Math.round(100 / chance) : "∞"}
                </span>
                <button
                  onClick={() => setSegs(segs.filter((_, j) => j !== i))}
                  className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
                >
                  remove
                </button>
              </div>
            );
          })}
          <button
            onClick={() => setSegs([...segs, { pct: 10, weight: 10 }])}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            + add a segment
          </button>
        </div>

        <div
          className={`mt-4 rounded-lg border p-3 text-sm ${
            inBand
              ? "border-emerald-500/40 bg-emerald-500/5"
              : "border-red-500/40 bg-red-500/5"
          }`}
        >
          <p className={inBand ? "text-emerald-300" : "text-red-300"}>
            This wheel averages <strong>{avg.toFixed(1)}%</strong>
            {inBand
              ? ` — inside your ${s.spinAvgMinPct}–${s.spinAvgMaxPct}% band.`
              : ` — ${wheelProblem}`}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            On a ₹{SAMPLE_HOUR.toLocaleString("en-IN")} hour, 100 spins all taken up would
            give away about{" "}
            <strong className="text-zinc-200">
              ₹{Math.round((SAMPLE_HOUR * avg) / 100 * 100).toLocaleString("en-IN")}
            </strong>{" "}
            and collect{" "}
            <strong className="text-zinc-200">
              ₹{Math.round(SAMPLE_HOUR * 100 - (SAMPLE_HOUR * avg) / 100 * 100).toLocaleString("en-IN")}
            </strong>{" "}
            on hours that would otherwise have sat empty.
          </p>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            disabled={pending || !inBand || !dirty}
            onClick={() => save({ spinSegments: draft })}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Save the wheel
          </button>
          <Num
            label="Average floor %"
            value={s.spinAvgMinPct}
            onSave={(v) => {
              setS({ ...s, spinAvgMinPct: v });
              save({ spinAvgMinPct: v });
            }}
          />
          <Num
            label="Average ceiling %"
            value={s.spinAvgMaxPct}
            onSave={(v) => {
              setS({ ...s, spinAvgMaxPct: v });
              save({ spinAvgMaxPct: v });
            }}
          />
        </div>
      </Panel>

      <Panel
        title="The two offers"
        desc="The hour after the match is held unsold while the captain asks his side, so give it minutes. The any-day fallback holds nothing, so it can have longer."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Num
            label="Next-hour offer lasts (minutes)"
            value={s.spinAdjacentWindowMins}
            onSave={(v) => {
              setS({ ...s, spinAdjacentWindowMins: v });
              save({ spinAdjacentWindowMins: v });
            }}
            hint="How long the captain has to ask his players before the hour goes back on sale."
          />
          <Num
            label="Another-day offer lasts (minutes)"
            value={s.spinFallbackWindowMins}
            onSave={(v) => {
              setS({ ...s, spinFallbackWindowMins: v });
              save({ spinFallbackWindowMins: v });
            }}
            hint="Used when the hour after the match was already booked."
          />
          <Num
            label="Fallback valid for (days ahead)"
            value={s.spinFallbackDays}
            onSave={(v) => {
              setS({ ...s, spinFallbackDays: v });
              save({ spinFallbackDays: v });
            }}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Num
            label="Spins per poster (0 = no cap)"
            value={s.spinsPerPosterCap}
            onSave={(v) => {
              setS({ ...s, spinsPerPosterCap: v });
              save({ spinsPerPosterCap: v });
            }}
            hint="The only defence against two friends posting at each other to farm the wheel. Zero means no cap."
          />
          <Num
            label="…in how many days (0 = ever)"
            value={s.spinsPerPosterPerDays}
            onSave={(v) => {
              setS({ ...s, spinsPerPosterPerDays: v });
              save({ spinsPerPosterPerDays: v });
            }}
            hint="Zero means the cap counts every spin ever, not a rolling window."
          />
        </div>
        <div className="mt-3">
          <Toggle
            label="Prize only on the same size of court"
            value={s.spinSameSizeOnly}
            onChange={(v) => {
              setS({ ...s, spinSameSizeOnly: v });
              save({ spinSameSizeOnly: v });
            }}
          />
          <p className="mt-1 text-xs text-zinc-500">
            Ties the prize to the match that earned it. Switch this off and a spin won on the
            cheapest pitch can be spent on the full ground — two friends can confirm a ₹200
            match for ₹50 each and take ~₹350 of the big court, over and over.
          </p>
        </div>
        <div className="mt-3">
          <Toggle
            label="Next hour only — never offer another day"
            value={s.spinAdjacentOnly}
            onChange={(v) => {
              setS({ ...s, spinAdjacentOnly: v });
              save({ spinAdjacentOnly: v });
            }}
          />
        </div>
      </Panel>

      <Panel
        title="What the pushes say"
        desc="Your words, not the app's. Anything in braces is filled in when it sends."
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {PUSH_VARS.map((v) => (
            <span
              key={v.name}
              title={v.note}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 font-mono text-[11px] text-zinc-300"
            >
              {"{"}
              {v.name}
              {"}"} → {v.example}
            </span>
          ))}
        </div>

        <PushEditor
          title="When they win"
          desc="Sent the moment the wheel stops."
          single
          value={asPushList(s.spinWonPush, [DEFAULT_WON])}
          onSave={(list) => {
            setS({ ...s, spinWonPush: list[0] });
            save({ spinWonPush: { title: list[0].title, body: list[0].body } });
          }}
        />

        <PushEditor
          title="Chasing the next hour"
          desc={`Nudges inside the ${s.spinAdjacentWindowMins}-minute window. A nudge set at or above that never fires.`}
          windowMins={s.spinAdjacentWindowMins}
          value={asPushList(s.spinAdjacentPushes, DEFAULT_ADJ)}
          onSave={(list) => {
            setS({ ...s, spinAdjacentPushes: list });
            save({ spinAdjacentPushes: list });
          }}
        />

        <PushEditor
          title="Chasing the any-day offer"
          desc={`Nudges inside the ${s.spinFallbackWindowMins}-minute window.`}
          windowMins={s.spinFallbackWindowMins}
          value={asPushList(s.spinFallbackPushes, DEFAULT_FB)}
          onSave={(list) => {
            setS({ ...s, spinFallbackPushes: list });
            save({ spinFallbackPushes: list });
          }}
        />
      </Panel>

      <Panel
        title="What the match itself says"
        desc="The five messages a match sends as it moves. These are the ones every captain reads, so they are the venue's words, not the code's. There is no way to switch one off — a captain who is never told is a captain whose money sits there while the hour gets sold to somebody else — only different words."
      >
        <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
          {LIFECYCLE_VARIABLES.map((v) => (
            <span key={v.name} className="rounded bg-zinc-900 px-1.5 py-0.5">
              {"{"}
              {v.name}
              {"}"} → {v.example}
            </span>
          ))}
        </div>
        {LIFECYCLE_KEYS.map((k) => (
          <PushEditor
            key={k}
            title={LIFECYCLE_LABELS[k.replace(/Push$/, "") as LifecyclePush].title}
            desc={LIFECYCLE_LABELS[k.replace(/Push$/, "") as LifecyclePush].desc}
            single
            variables={LIFECYCLE_VARIABLES}
            value={asPushList(s[k], [
              DEFAULT_LIFECYCLE_PUSHES[k.replace(/Push$/, "") as LifecyclePush],
            ])}
            onSave={(list) => {
              setS({ ...s, [k]: list[0] });
              save({ [k]: { title: list[0].title, body: list[0].body } });
            }}
          />
        ))}
      </Panel>

      <Panel
        title="What YOU are told"
        desc="The one message in this module addressed to the arena rather than to a player. It goes to the admin app when a captain's money has to be given back — because a court is only taken off sale once both halves are in, so an hour somebody is halfway through buying can be sold to a walk-in. Nothing refunds automatically: if this message does not reach you, the refund does not happen."
      >
        <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
          {OWNER_VARIABLES.map((v) => (
            <span key={v.name} className="rounded bg-zinc-900 px-1.5 py-0.5">
              {"{"}
              {v.name}
              {"}"} → {v.example}
            </span>
          ))}
        </div>
        <PushEditor
          title="Refund owed"
          desc="Keep the amount and the phone number in it. Whoever reads this has to ring that person and refund by hand, and a message that makes them go and look the number up is a message that gets postponed."
          single
          variables={OWNER_VARIABLES}
          value={asPushList(s.ownerRefundPush, [DEFAULT_OWNER_REFUND_PUSH])}
          onSave={(list) => {
            setS({ ...s, ownerRefundPush: list[0] });
            save({ ownerRefundPush: { title: list[0].title, body: list[0].body } });
          }}
        />
      </Panel>

      <Panel
        title="What it has actually cost"
        desc="Two averages, deliberately. What the wheel LANDS on across all spins, and what it actually COST you — discount over rack price, on the offers people took. Only the second matches the books."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Spins" value={p.spins} />
          <Stat label="Offers taken" value={`${p.offersTaken}/${p.offersMade}`} />
          <Stat label="Lapsed" value={p.offersLapsed} />
          <Stat label="Wheel landed on (avg)" value={`${p.wheelMeanPct}%`} />
          <Stat label="Cost you (of rack)" value={`${p.realisedCostPct}%`} />
          <Stat label="Given away" value={`₹${p.discounted.toLocaleString("en-IN")}`} />
          <Stat label="Collected" value={`₹${p.collected.toLocaleString("en-IN")}`} />
          <Stat label="Next hour" value={`${p.adjacentTaken}/${p.adjacentMade}`} />
          <Stat label="Another day" value={`${p.fallbackTaken}/${p.fallbackMade}`} />
        </div>
        {p.byPct.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-zinc-500">WHAT THE WHEEL ACTUALLY LANDED ON</p>
            <div className="mt-2 space-y-1">
              {p.byPct.map((row) => (
                <div key={row.pct} className="flex items-center gap-2 text-xs">
                  <span className="w-12 tabular-nums text-zinc-300">{row.pct}%</span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-zinc-800">
                    <div
                      className="h-full bg-emerald-500/60"
                      style={{ width: `${(row.count / Math.max(1, p.spins)) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 tabular-nums text-zinc-500">{row.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}


function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-0.5 text-lg font-medium tabular-nums text-zinc-100">{value}</p>
    </div>
  );
}

/** The same on/off affordance the board switch uses, so nothing new to learn. */
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm font-medium ${
        value
          ? "border-emerald-500/40 bg-emerald-600/10 text-emerald-300"
          : "border-zinc-700 bg-zinc-900 text-zinc-400"
      }`}
    >
      {value ? `${label} — ON` : `${label} — OFF`}
    </button>
  );
}

type Push = { minsLeft?: number; title: string; body: string };

// Imported, never re-typed. These were copied into this file and had
// already DRIFTED: three of the six bodies lost their {date} placeholder,
// so the admin proofread and previewed copy that was not what sent.
const PUSH_VARS = PUSH_VARIABLES;
const DEFAULT_WON = DEFAULT_WON_PUSH;
const DEFAULT_ADJ = DEFAULT_ADJACENT_PUSHES;
const DEFAULT_FB = DEFAULT_FALLBACK_PUSHES;
const DEFAULT_SEGMENTS = DEFAULT_WHEEL;
const DEFAULT_POSTED = DEFAULT_POSTED_PUSH;



/**
 * An EMPTY stored list means the venue turned nudges OFF, and the editor has
 * to show that. Rendering the built-in schedule instead told them two
 * nudges were configured while the runtime sent none — and any later Save
 * on that panel silently re-instated the defaults they had removed.
 */
/**
 * The SAME resolver the runtime and the validator use, with one extra case:
 * `spinWonPush` is stored as a single object, not a list. Re-implementing
 * this was how the rule ended up in three places, and it had already
 * disagreed twice when it was only in two.
 */
function asPushList(v: unknown, fallback: Push[]): Push[] {
  if (v && !Array.isArray(v) && typeof v === "object" && "title" in (v as object)) {
    return [v as Push];
  }
  return resolvePushes(v, fallback) as Push[];
}

/**
 * Edits one push schedule.
 *
 * The preview is the point: a template is only correct once you have seen
 * it with real values substituted, and "{minsLef}" reads as fine in a form
 * field and as broken in a notification.
 */
function PushEditor({
  title,
  desc,
  value,
  onSave,
  windowMins,
  single,
  variables,
}: {
  title: string;
  desc: string;
  value: Push[];
  onSave: (v: Push[]) => void;
  windowMins?: number;
  single?: boolean;
  /** Which placeholder set this message may use. Defaults to the promo's. */
  variables?: { name: string; example: string; note: string }[];
}) {
  const [list, setList] = useState<Push[]>(value);
  // Re-sync when the SERVER's copy changes — after a successful save, and
  // after a refusal, which leaves it untouched. Without this the editor kept
  // showing copy the server had rejected: the page-level rollback restores
  // the settings object but cannot reach into this child, so a nudge refused
  // for being set to 12.5 minutes still read 12.5 afterwards.
  useEffect(() => setList(value), [JSON.stringify(value)]);

  // Built from PUSH_VARIABLES so the preview can never advertise a
  // placeholder it cannot substitute.
  const sample: Record<string, string> = Object.fromEntries(
    (variables ?? PUSH_VARIABLES).map((v) => [v.name, v.example]),
  );
  /**
   * Preview one template, using ITS OWN marker for {minsLeft}.
   *
   * The fixed example of 5 made every nudge in a ladder preview identically:
   * a 30-minute nudge and a 10-minute last call both read "5 minutes", so a
   * venue proofreading the ladder could not tell them apart — and the number
   * they proofread was never the number that sends, because the sender
   * computes the real minutes remaining.
   */
  const render = (t: string, p?: Push) =>
    t.replace(/\{(\w+)\}/g, (whole, k: string) =>
      k === "minsLeft" && typeof p?.minsLeft === "number"
        ? String(p.minsLeft)
        : (sample[k] ?? whole),
    );

  const tooLate = (p: Push) =>
    !single && windowMins !== undefined && (p.minsLeft ?? 0) >= windowMins;

  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <p className="text-sm font-medium text-zinc-200">{title}</p>
      <p className="mt-0.5 text-xs text-zinc-500">{desc}</p>
      <div className="mt-3 space-y-3">
        {list.map((p, i) => (
          <div key={i} className="space-y-1.5">
            {!single && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-zinc-500">fires with</span>
                <input
                  type="number"
                  value={p.minsLeft ?? 0}
                  min={1}
                  onChange={(e) => {
                    const next = [...list];
                    next[i] = { ...p, minsLeft: Number(e.target.value) };
                    setList(next);
                  }}
                  className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100"
                />
                <span className="text-zinc-500">minutes left</span>
                {tooLate(p) && (
                  <span className="text-red-400">
                    never fires — the offer is only {windowMins} minutes long
                  </span>
                )}
                <button
                  onClick={() => setList(list.filter((_, j) => j !== i))}
                  className="ml-auto rounded border border-zinc-700 px-2 py-0.5 text-zinc-400 hover:bg-zinc-800"
                >
                  remove
                </button>
              </div>
            )}
            <input
              value={p.title}
              placeholder="Title"
              onChange={(e) => {
                const next = [...list];
                next[i] = { ...p, title: e.target.value };
                setList(next);
              }}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
            />
            <textarea
              value={p.body}
              placeholder="Body"
              rows={2}
              onChange={(e) => {
                const next = [...list];
                next[i] = { ...p, body: e.target.value };
                setList(next);
              }}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
            />
            <div className="rounded border border-zinc-800 bg-black/40 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-zinc-600">As it sends</p>
              <p className="text-xs font-medium text-zinc-200">{render(p.title, p)}</p>
              <p className="text-xs text-zinc-400">{render(p.body, p)}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {!single && (
          <button
            onClick={() => setList([...list, { minsLeft: 10, title: "", body: "" }])}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            + add a nudge
          </button>
        )}
        <button
          onClick={() => onSave(list)}
          disabled={list.some(tooLate) || list.some((p) => !p.title.trim() || !p.body.trim())}
          className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}
