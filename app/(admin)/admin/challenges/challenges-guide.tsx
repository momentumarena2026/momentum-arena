"use client";

/**
 * The Challenges module, explained for somebody who has never seen it.
 *
 * This exists because every other tab assumes you already know what a
 * challenge IS. The settings tab in particular is forty numbers with one-line
 * hints, and two of them — the wheel's percentages and its weights — sit on
 * the same row, look identical, and mean completely different things.
 *
 * Written to be read top to bottom on somebody's first day: what the feature
 * does, what a captain sees at each step, what EVERY field changes with a
 * worked example of real values, and — the part that costs money if missed —
 * what the arena has to do by hand.
 *
 * The phone screens are DRAWN rather than screenshotted, deliberately. A
 * screenshot goes stale the first time the venue edits its own copy, and it
 * cannot be labelled with the setting that controls each piece. These can.
 * The wheel preview is better still: it reads the venue's real segments, so
 * the odds shown are the odds their players actually get.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeIndianRupee,
  BellRing,
  CircleDot,
  Clock,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";

type Seg = { pct: number; weight: number };

const BUILT_IN_WHEEL: Seg[] = [
  { pct: 5, weight: 10 },
  { pct: 10, weight: 30 },
  { pct: 15, weight: 25 },
  { pct: 20, weight: 15 },
  { pct: 25, weight: 10 },
  { pct: 50, weight: 10 },
];

/* ── building blocks ───────────────────────────────────────────────── */

function Section({
  n,
  title,
  lead,
  children,
}: {
  n: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600/15 text-xs font-semibold text-emerald-300">
          {n}
        </span>
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          {lead && <p className="mt-1 max-w-3xl text-sm text-zinc-400">{lead}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * A real screenshot of the app, with the setting that controls it named
 * underneath. Taken from the running iOS build against staging data; the
 * team names and times are demo rows, everything else is the real screen.
 */
function Shot({
  src,
  alt,
  caption,
  by,
  w,
  h,
}: {
  src: string;
  alt: string;
  caption: string;
  by?: string;
  w: number;
  h: number;
}) {
  return (
    <figure className="min-w-0">
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} width={w} height={h} className="block h-auto w-full" />
      </div>
      <figcaption className="mt-2 text-xs leading-snug text-zinc-400">{caption}</figcaption>
      {by && (
        <p className="mt-1 text-[11px] leading-tight text-emerald-500/90">
          Controlled by <span className="font-medium">{by}</span>
        </p>
      )}
    </figure>
  );
}

/**
 * One setting: what it is, then a small table of real values and what each
 * one actually does. The examples are the point — "maxWindows: 3" means
 * nothing to a new manager; "3 → the captain can offer Fri 7pm, Sat 6pm and
 * Sun 8pm" means something.
 */
function Field({
  name,
  what,
  examples,
  careful,
  seen,
}: {
  name: string;
  what: string;
  examples?: [string, string][];
  careful?: string;
  seen?: string;
}) {
  return (
    <div className="border-t border-zinc-800 py-4 first:border-t-0 first:pt-0">
      <p className="text-sm font-semibold text-white">{name}</p>
      <p className="mt-1 text-sm text-zinc-400">{what}</p>
      {examples && (
        <div className="mt-2 overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-zinc-800">
              {examples.map(([v, m]) => (
                <tr key={v}>
                  <td className="w-24 whitespace-nowrap bg-zinc-950 px-2.5 py-1.5 align-top font-mono font-medium text-emerald-300">
                    {v}
                  </td>
                  <td className="px-2.5 py-1.5 text-zinc-400">{m}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {careful && (
        <p className="mt-2 text-xs text-amber-300/90">
          <span className="font-semibold">Careful:</span> {careful}
        </p>
      )}
      {seen && (
        <p className="mt-1.5 text-xs text-zinc-500">
          <span className="font-medium text-zinc-400">Where the customer sees it:</span>{" "}
          {seen}
        </p>
      )}
    </div>
  );
}

function Warn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-300">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {title}
      </p>
      <div className="mt-1.5 space-y-2 text-sm text-amber-100/70">{children}</div>
    </div>
  );
}

/* ── the live wheel preview ────────────────────────────────────────── */

function WheelPreview({ segments }: { segments: Seg[] }) {
  const live = useMemo(() => segments.filter((s) => s.weight > 0), [segments]);
  const total = live.reduce((t, s) => t + s.weight, 0) || 1;
  const avg = live.reduce((t, s) => t + s.pct * s.weight, 0) / total;
  const sweep = 360 / (live.length || 1);
  const R = 72;
  const C = 80;

  const wedge = (i: number) => {
    const a0 = ((i * sweep - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * sweep - 90) * Math.PI) / 180;
    const x0 = C + R * Math.cos(a0);
    const y0 = C + R * Math.sin(a0);
    const x1 = C + R * Math.cos(a1);
    const y1 = C + R * Math.sin(a1);
    return `M ${C} ${C} L ${x0} ${y0} A ${R} ${R} 0 ${sweep > 180 ? 1 : 0} 1 ${x1} ${y1} Z`;
  };
  const max = Math.max(...live.map((s) => s.pct), 0);
  const fill = (pct: number) => {
    if (pct >= max) return "#f59e0b";
    const share = max > 0 ? pct / max : 0;
    if (share >= 0.5) return "#10b981";
    if (share >= 0.3) return "#0f766e";
    return "#134e4a";
  };

  return (
    <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
      <div className="mx-auto">
        <svg width={160} height={160} viewBox="0 0 160 160" role="img" aria-label="Your wheel">
          {live.map((s, i) => (
            <g key={`${s.pct}-${i}`}>
              <path d={wedge(i)} fill={fill(s.pct)} stroke="#09090b" strokeWidth="1.5" />
              <text
                x={C + R * 0.66 * Math.cos(((i * sweep + sweep / 2 - 90) * Math.PI) / 180)}
                y={C + R * 0.66 * Math.sin(((i * sweep + sweep / 2 - 90) * Math.PI) / 180)}
                fill="#fff"
                fontSize="10"
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {s.pct}%
              </text>
            </g>
          ))}
          <circle cx={C} cy={C} r={R} fill="none" stroke="#27272a" strokeWidth="2" />
        </svg>
        <p className="mt-1 text-center text-[11px] text-zinc-500">
          Every slice the same size — see below
        </p>
      </div>

      <div>
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-xs">
            <thead className="bg-zinc-950 uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-2.5 py-2 text-left font-medium">Prize</th>
                <th className="px-2.5 py-2 text-right font-medium">Weight</th>
                <th className="px-2.5 py-2 text-right font-medium">Real chance</th>
                <th className="px-2.5 py-2 text-right font-medium">On ₹2,000</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {live.map((s, i) => (
                <tr key={`${s.pct}-r${i}`}>
                  <td className="px-2.5 py-1.5 font-medium text-white">{s.pct}% off</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-amber-300">
                    {s.weight}
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-zinc-300">
                    {((s.weight / total) * 100).toFixed(1)}% · about 1 in{" "}
                    {Math.max(1, Math.round(total / s.weight))}
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-zinc-400">
                    −₹{Math.round((2000 * s.pct) / 100).toLocaleString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-zinc-950">
              <tr>
                <td className="px-2.5 py-2 font-semibold text-white">Average</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-zinc-500">{total}</td>
                <td className="px-2.5 py-2 text-right text-zinc-500">—</td>
                <td className="px-2.5 py-2 text-right font-semibold tabular-nums text-emerald-300">
                  {avg.toFixed(1)}% · −₹{Math.round((2000 * avg) / 100).toLocaleString("en-IN")}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          This is <span className="font-medium text-zinc-300">your</span> wheel, read from
          the settings as they stand now. The average is what a spin costs you on a ₹2,000
          court, over many spins.
        </p>
      </div>
    </div>
  );
}

/* ── the page ──────────────────────────────────────────────────────── */

export function ChallengesGuide({
  segments,
  advancePct = 50,
}: {
  segments?: Seg[] | null;
  advancePct?: number;
}) {
  const wheel =
    Array.isArray(segments) && segments.length > 0 && segments.some((s) => s?.weight > 0)
      ? segments
      : BUILT_IN_WHEEL;

  const [court, setCourt] = useState(2000);
  const [pct, setPct] = useState(advancePct);
  const advance = Math.round((court * pct) / 100);
  const each = Math.round(advance / 2);

  return (
    <div className="space-y-4 pb-16">
      {/* 1 ── what it is */}
      <Section
        n="1"
        title="What the Challenges board is"
        lead="A way to sell an hour that would otherwise stay empty, by letting two half-teams find each other and split the bill."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: Users,
              h: "Somebody posts a match",
              p: "A captain with eight players and no opponent puts up the sport, how many players they have, and up to three times they could play. Posting is free and takes no money.",
            },
            {
              icon: ArrowRight,
              h: "Somebody else takes it",
              p: "Another captain sees it on the board, picks one of those times, and pays their half. Paying IS accepting — there is no separate accept button.",
            },
            {
              icon: Trophy,
              h: "Both pay, court is booked",
              p: "When the second half lands, the court is booked automatically and both captains are told. One booking, two people who paid for it.",
            },
          ].map((c) => (
            <div key={c.h} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <c.icon className="h-5 w-5 text-emerald-400" />
              <p className="mt-2 text-sm font-semibold text-white">{c.h}</p>
              <p className="mt-1 text-sm text-zinc-400">{c.p}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-zinc-400">
          It is <span className="font-medium text-white">app only</span>. There is no page
          on the website — a customer on a laptop cannot see or use this.
        </p>
      </Section>

      {/* 2 ── the rule that surprises everybody */}
      <Section
        n="2"
        title="The one rule that surprises everybody"
        lead="Read this even if you read nothing else here."
      >
        <Warn title="The hour is NOT held when the first captain pays.">
          <p>
            A court comes off sale only when <span className="font-semibold">both</span>{" "}
            halves are in. Between the first payment and the second, that hour is still on
            sale everywhere — the app, the website, and your own front desk.
          </p>
          <p>
            So a walk-in can book it. When that happens the challenge is discarded, both
            captains are told the hour has gone, and whoever paid is owed their money back.
          </p>
        </Warn>
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-sm font-semibold text-white">Why it works this way</p>
          <p className="mt-1 text-sm text-zinc-400">
            The alternative is holding a court for a match that may never be paid for.
            Half-paid challenges that go nowhere are common, and each would block a
            sellable hour for as long as it lasted. The venue would rather sell the hour
            and refund the rare half-payer. That trade only works if the refund actually
            happens — which is section 6.
          </p>
        </div>
      </Section>

      {/* 3 ── what the customer sees */}
      <Section
        n="3"
        title="What the customer actually sees"
        lead="Every word below is yours to change. The green note under each screen says which setting controls it."
      >
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <Shot
            src="/help/challenges/home-card.webp"
            alt="The Challenge a team card on the app's Home screen"
            w={620}
            h={222}
            caption="Home screen. The card appears only while the board is switched on — and only in the app, never on the website."
            by="Home screen card (title, subtitle, badge) and the Master switch"
          />
          <Shot
            src="/help/challenges/board.webp"
            alt="The challenges board listing open matches"
            w={620}
            h={939}
            caption="The board. Everything currently open to take, newest first, filterable by sport. A captain's own posts appear under YOURS instead."
            by="Wording (title, subtitle, empty message) and Which sports"
          />
          <Shot
            src="/help/challenges/detail-pay.webp"
            alt="A challenge showing the court price, the split and the pay button"
            w={620}
            h={385}
            caption="Opening one. Note the whole money story in one line — ₹2,000 court, ₹500 now, ₹1,000 at the venue. Paying IS accepting; there is no separate accept button."
            by="Advance % — see section 4"
          />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <Shot
            src="/help/challenges/post-form.webp"
            alt="The form a captain fills in to post a challenge"
            w={620}
            h={770}
            caption="What a captain fills in to post."
            by="Which sports · Minimum and maximum players · Times per challenge"
          />
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-sm font-semibold text-white">Reading that form against your settings</p>
            <ul className="mt-2 space-y-2 text-sm text-zinc-400">
              <li>
                <span className="font-medium text-white">The sport chips</span> are exactly
                the sports you allowed. Allow none and every sport the arena runs appears.
              </li>
              <li>
                <span className="font-medium text-white">&ldquo;When can you play? (0/3)&rdquo;</span>{" "}
                — that 3 is your <span className="text-emerald-300">Times per challenge</span>.
                Set it to 1 and the counter reads (0/1).
              </li>
              <li>
                <span className="font-medium text-white">How many players</span> is checked
                against your minimum and maximum before the post is accepted.
              </li>
              <li>
                Times inside your <span className="text-emerald-300">notice period</span>{" "}
                are simply not offered, so nobody can arrange a game you cannot staff.
              </li>
            </ul>
          </div>
        </div>

      </Section>

      {/* 4 ── the money */}
      <Section
        n="4"
        title="The money, with real numbers"
        lead="Only the advance is taken online, exactly like any other advance booking here. The rest is collected at the venue."
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <p className="mb-3 text-sm font-semibold text-white">Move these and watch</p>
            <label className="block text-xs uppercase tracking-wide text-zinc-500">
              Court price for the hour
            </label>
            <input
              type="number"
              value={court}
              onChange={(e) => setCourt(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white"
            />
            <label className="mt-3 block text-xs uppercase tracking-wide text-zinc-500">
              Advance % — currently {pct}%
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="mt-2 w-full accent-emerald-500"
            />
            <p className="mt-2 text-xs text-zinc-500">
              Your live setting is {advancePct}%.
            </p>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <table className="w-full text-sm">
              <tbody className="[&_td]:py-1.5">
                <tr className="border-b border-zinc-800">
                  <td className="text-zinc-400">Court for the hour</td>
                  <td className="text-right font-medium tabular-nums text-white">
                    ₹{court.toLocaleString("en-IN")}
                  </td>
                </tr>
                <tr className="border-b border-zinc-800">
                  <td className="text-zinc-400">Taken online in total ({pct}%)</td>
                  <td className="text-right font-medium tabular-nums text-white">
                    ₹{advance.toLocaleString("en-IN")}
                  </td>
                </tr>
                <tr className="border-b border-zinc-800">
                  <td className="text-emerald-300">Each captain pays online</td>
                  <td className="text-right font-semibold tabular-nums text-emerald-300">
                    ₹{each.toLocaleString("en-IN")}
                  </td>
                </tr>
                <tr>
                  <td className="text-zinc-400">Collected at the venue</td>
                  <td className="text-right font-medium tabular-nums text-white">
                    ₹{(court - each * 2).toLocaleString("en-IN")}
                  </td>
                </tr>
              </tbody>
            </table>
            {pct === 0 && (
              <p className="mt-3 text-xs text-amber-300">
                At 0% nobody can take a challenge at all — a ₹0 payment cannot be
                processed, so the feature stops working. Use the master switch to close
                the board instead.
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-center">
          <Shot
            src="/help/challenges/detail-pay.webp"
            alt="The same numbers as the customer sees them"
            w={620}
            h={385}
            caption="The same three numbers as a captain sees them, in one line."
          />
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
            <p>
              At 50% on a ₹2,000 court that reads{" "}
              <span className="text-white">
                &ldquo;₹2000 for the court · your half now, ₹1000 at the venue&rdquo;
              </span>{" "}
              with a <span className="text-white">Take it — pay ₹500</span> button. Change
              the advance to 100% and the same screen asks for ₹1,000 with nothing due at
              the gate.
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm text-zinc-400">
          The split is halved and rounded, so an odd advance leaves a rupee in the
          venue&apos;s favour at the gate. Once the court is booked the{" "}
          <span className="font-medium text-white">booking becomes the contract</span> —
          changing the advance % or re-pricing the court afterwards does not change what
          the second captain is charged.
        </p>
      </Section>

      {/* 5 ── the wheel */}
      <Section
        n="5"
        title="The prize wheel, field by field"
        lead="Percentage and weight sit on the same row and do entirely different jobs. This is the most misread part of the settings."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-white">
              <BadgeIndianRupee className="h-4 w-4 text-emerald-400" />
              Percentage = the prize
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              How much comes off their next hour. <span className="text-white">20</span>{" "}
              means 20% off — on a ₹2,000 court that is ₹400 out of your pocket. Whole
              numbers only: 17.5 would be stored as 17 and the player would be charged
              differently from what they were shown.
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-white">
              <CircleDot className="h-4 w-4 text-amber-400" />
              Weight = how often it comes up
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              A share, not a percentage. It does not need to add to 100 — only the ratios
              matter. Weights of{" "}
              <span className="font-mono text-amber-300">1 / 4 / 15</span> and{" "}
              <span className="font-mono text-amber-300">5 / 20 / 75</span> give identical
              odds. A weight of 0 means that prize is never drawn and is not even shown on
              the wheel.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <p className="mb-3 text-sm font-semibold text-white">Your wheel, right now</p>
          <WheelPreview segments={wheel} />
        </div>

        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-sm font-semibold text-white">
            Why every slice is drawn the same size
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            A jackpot drawn as a hair-thin sliver reads as a wheel that cannot be won, so
            the picture is even while the odds stay exactly your weights. Nothing is
            hidden: the caption under the wheel tells the player the true chance in words
            — &ldquo;about 1 spin in 20&rdquo;.
          </p>
        </div>

        <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <Field
            name="Prize wheel running"
            what="A switch of its own, separate from the board's master switch."
            examples={[
              ["On", "Posters get a spin once their match is confirmed."],
              ["Off", "The board works exactly as before, with no prizes at all."],
            ]}
          />
          <Field
            name="Segments and weights"
            what="The prize list itself. Add a row per prize."
            examples={[
              ["50% / 1", "A jackpot that lands about 1 spin in 20 on the table above."],
              ["10% / 30", "The common result — most people get this."],
              ["25% / 0", "Listed but switched off: never drawn, never shown."],
            ]}
            careful="At least one segment needs a weight above zero, or there is nothing to win and the built-in wheel is used instead."
          />
          <Field
            name="Average floor % and ceiling %"
            what="A safety rail, not a prize. The system works out what your wheel gives away on average and refuses to save it if that average falls outside this band."
            examples={[
              ["15 – 25", "A wheel averaging 14.5% is rejected until you raise the prizes or lower the floor."],
              ["0 – 100", "Effectively no rail — any wheel saves."],
            ]}
            careful="This is about the AVERAGE, not any single prize. A 50% jackpot is fine inside a 15–25 band as long as it is rare enough."
          />
          <Field
            name="Next-hour offer lasts (minutes)"
            what="How long the winner has to book the hour straight after their match before the prize lapses."
            examples={[
              ["30", "Decide during the game. Short, urgent, and most will miss it."],
              ["120", "Two hours — they can decide after they have played."],
            ]}
            seen="A countdown on their prize card in the app."
          />
          <Field
            name="Another-day offer lasts (minutes) and valid for (days ahead)"
            what="The fallback when the next hour is already sold: a longer window, usable on a later date."
            examples={[
              ["120 mins / 1 day", "Two hours to claim, playable within the next day."],
              ["1440 mins / 7 days", "A full day to claim, playable any time that week."],
            ]}
          />
          <Field
            name="Next hour only — never offer another day"
            what="Turns the fallback off entirely."
            examples={[
              ["Off", "If the adjoining hour is gone, they are offered another day instead."],
              ["On", "No adjoining hour free means no prize at all — the spin is recorded and they are told why."],
            ]}
          />
          <Field
            name="Prize only on the same size of court"
            what="Keeps the discount on a court like the one they played on."
            examples={[
              ["On", "A full-ground win cannot be spent on a small pitch."],
              ["Off", "They may spend it on any court, which costs you less but feels arbitrary."],
            ]}
          />
          <Field
            name="Spins per poster / in how many days"
            what="A cap so one very active captain cannot farm discounts."
            examples={[
              ["0 / 0", "No cap at all — a spin for every confirmed match."],
              ["2 / 7", "At most two spins in any seven days, per person."],
            ]}
          />
        </div>
      </Section>

      {/* 6 ── manual work */}
      <Section
        n="6"
        title="What the arena has to do by hand"
        lead="Two things here do not happen automatically, and both are money."
      >
        <div className="space-y-4">
          <Warn title="Refunds are manual. Nothing goes back automatically.">
            <p>
              When an hour is sold out from under a half-paid challenge, the system flags
              the money as owed and sends a message to the admin app with the amount and
              the person&apos;s phone number. Somebody has to ring them and return it.
            </p>
            <p>
              Everything owed is listed on the{" "}
              <span className="font-medium">Challenges</span> tab. Mark each one refunded
              once the money has actually gone back — that is what clears it.
            </p>
          </Warn>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-white">
              <Wallet className="h-4 w-4 text-zinc-400" />
              The balance of the court price
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              Only the advance is taken online. The rest is collected at the venue like any
              other advance booking, and marked on the booking when it is.
            </p>
          </div>
        </div>
      </Section>

      {/* 7 ── every other setting */}
      <Section
        n="7"
        title="Every other setting, with examples"
        lead="In the same order as the Settings tab."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <Users className="h-4 w-4" /> Posting
            </h3>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <Field
                name="Master switch"
                what="Turns the whole board on or off."
                examples={[
                  ["On", "Captains can post, take and pay."],
                  ["Off", "Nobody can do any of it, and the Home card disappears."],
                ]}
                seen="The feature vanishes entirely from the app."
              />
              <Field
                name="Which sports"
                what="Limits challenges to certain sports."
                examples={[
                  ["none selected", "Every sport the arena runs."],
                  ["Cricket only", "A football captain is told challenges aren't open for that sport yet."],
                ]}
              />
              <Field
                name="Minimum / maximum players"
                what="The squad size a captain may claim. A sanity check, not something enforced on the day."
                examples={[
                  ["1 – 30", "Anything from a singles opponent to a full side."],
                  ["6 – 12", "Team sports only; a lone player cannot post."],
                ]}
              />
              <Field
                name="Times per challenge"
                what="How many alternative times one captain may offer."
                examples={[
                  ["3", "Fri 7pm, Sat 6pm and Sun 8pm — three chances to match."],
                  ["1", "Allowed, but most single-time challenges expire unmatched."],
                ]}
              />
              <Field
                name="Counter-offers per side"
                what="How many times each captain may suggest a different time instead of accepting."
                examples={[
                  ["1", "One round of haggling each, then it settles."],
                  ["0", "No haggling — take a time offered or leave it."],
                ]}
              />
              <Field
                name="Notice needed before a slot (minutes)"
                what="How far ahead a match must be, so you can staff it."
                examples={[
                  ["240", "Four hours' notice — nothing can be arranged for right now."],
                  ["0", "A captain may arrange a game for twenty minutes from now."],
                ]}
                seen="Times inside the notice period simply are not offered."
              />
              <Field
                name="Days a challenge lives"
                what="How long a post stays on the board."
                examples={[
                  ["7", "A week, or until its last offered time — whichever comes first."],
                  ["1", "Today only; good for filling tonight, bad for building a board."],
                ]}
              />
            </div>
          </div>

          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <BadgeIndianRupee className="h-4 w-4" /> Money and timing
            </h3>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <Field
                name="Advance %"
                what="How much of the court price is taken online, split evenly between the two captains."
                examples={[
                  ["50", "₹2,000 court → ₹500 each online, ₹1,000 at the venue."],
                  ["100", "₹2,000 court → ₹1,000 each online, nothing at the gate."],
                  ["0", "Nobody can take a challenge at all."],
                ]}
                careful="At 0% the feature stops working — close the board with the master switch instead."
                seen="The exact amount on the pay button, and the balance due at the venue."
              />
              <Field
                name="Payment window (minutes)"
                what="How long one captain's payment attempt holds their place before a rival may take the slot."
                examples={[
                  ["120", "Two hours to finish paying."],
                  ["10", "Ten minutes — brisk, and more matches get taken by somebody quicker."],
                ]}
                careful="This does NOT expire the challenge. That happens at the match time or the TTL above."
              />
            </div>

            <h3 className="mb-2 mt-5 flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <BellRing className="h-4 w-4" /> Messages and wording
            </h3>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <Field
                name="The five match messages"
                what="Sent as a match moves: matched, pay your half, confirmed, hour lost, refund owed. You may change the words but not switch them off."
                examples={[
                  ["{name}", "The other captain's name."],
                  ["{amount}", "What the reader owes — not what the other person paid."],
                  ["{hour} {date}", "The slot, e.g. 7–8pm on Sat 21 Sep."],
                ]}
                careful="A captain who is never told is a captain whose money sits there while the hour is sold to somebody else."
              />
              <Field
                name="Refund owed (addressed to you)"
                what="The only message in this module for the arena rather than a player."
                examples={[
                  ["{reason}", "Why the money is owed — usually that the hour went."],
                ]}
                careful="Keep the amount and the phone number in it. If this message does not reach somebody, the refund does not happen."
              />
              <Field
                name="Board title, subtitle, empty message"
                what="The board's own words in the app."
                examples={[
                  ["blank", "Uses the built-in copy."],
                  ['"Find a match"', "Shows exactly that, as typed."],
                ]}
              />
              <Field
                name="Home screen card"
                what="The card on the app's Home screen, and its badge."
                examples={[
                  ["NEW", "A small green badge to draw the eye."],
                  ["card off", "The feature still works; people reach it from the Sports tab instead."],
                ]}
              />
            </div>
          </div>
        </div>
      </Section>

      {/* 8 ── where to look */}
      <Section n="8" title="Where to look for what" lead="The other four tabs on this page.">
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-zinc-950 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Tab</th>
                <th className="px-3 py-2 text-left font-medium">What it is for</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {[
                [
                  "Challenges",
                  "Every live match and its money. Half-paid ones needing a decision, and everything owed a refund, are listed here.",
                ],
                [
                  "Activity",
                  "Every action and every refusal, with the exact sentence the customer was shown. This is where you find out why somebody could not post.",
                ],
                [
                  "Prize wheel",
                  "What the wheel has cost. Two averages: what it lands on, and what it actually cost against rack price. Only the second matches the books.",
                ],
                ["Settings", "Everything in sections 5 and 7."],
              ].map(([a, b]) => (
                <tr key={String(a)}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-white">{a}</td>
                  <td className="px-3 py-2 text-zinc-400">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 9 ── turning it on */}
      <Section
        n="9"
        title="Turning it on for the first time"
        lead="The board ships switched off. Nothing happens until somebody turns it on here."
      >
        <ol className="space-y-2.5 text-sm text-zinc-400">
          {[
            "Set the Advance % and check section 4 against a real court price.",
            "Pick the sports, or leave it empty for all of them.",
            "Read the five match messages and put them in the venue's own words.",
            "Set the refund message so it carries the amount and the phone number — that message is how a refund reaches a person.",
            "Decide whether the prize wheel runs at all, and check its average in section 5 against what you are willing to give away.",
            "Turn the master switch on, and watch the Activity tab for the first day.",
          ].map((t, i) => (
            <li key={t} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-700 text-[11px] text-zinc-400">
                {i + 1}
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
          <p>
            Turning the board off later does not cancel matches already paid for. Those are
            ordinary bookings now, handled on the Bookings page like any other.
          </p>
        </div>
      </Section>
    </div>
  );
}
