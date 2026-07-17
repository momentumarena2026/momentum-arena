import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  CalendarClock,
  Calendar,
  CheckCircle2,
  Clock,
  Coffee,
  Coins,
  Gift,
  IndianRupee,
  Info,
  Percent,
  Sparkles,
  TrendingUp,
  Trophy,
  Wallet,
} from "lucide-react";
import { getMyRewardOverview } from "@/actions/rewards";
import { BackButton } from "@/components/back-button";

export const dynamic = "force-dynamic";

/**
 * "How Momentum Points work" — visual + plain-English explainer.
 *
 * Every number on the page is driven by the live RewardConfig via
 * getMyRewardOverview(). When admin changes a knob in /admin/rewards
 * (earn rate, conversion, caps), the next page render reflects it
 * with no manual copy edit.
 *
 * Structure:
 *   1. Hero — friendly headline + current balance teaser
 *   2. 3-step flow (Book → Earn → Save) with big icons
 *   3. Worked example using the user's actual earn rate
 *   4. "How you earn" — per-source cards (booking, cafe, bonuses)
 *   5. "How you spend" — min, max%, max₹, holding period
 *   6. Expiry timeline (visual)
 *   7. FAQ in plain language
 *   8. CTAs (Book a court / View statement)
 */
// Lives under (protected) so the shared header + auth gate apply.
// Route group is invisible in the URL — this still renders at
// /rewards/how-it-works.
export default async function RewardsHowItWorksPage() {
  const overview = await getMyRewardOverview();
  if (!overview) redirect("/login");

  const cfg = overview.config;
  const earnPctBooking = Math.round(cfg.earnRateBookingBps / 100);
  const earnPctCafe = Math.round(cfg.earnRateCafeBps / 100);
  const pointValueRupees = (cfg.pointValuePaise / 100).toFixed(
    cfg.pointValuePaise % 100 === 0 ? 0 : 2,
  );
  const maxRedemptionRupees = cfg.maxRedemptionPaisePerTxn
    ? Math.round(cfg.maxRedemptionPaisePerTxn / 100)
    : null;

  // Worked example — use a realistic Pickleball night slot (₹800).
  // The numbers below all flow from the live earn rate + conversion
  // so the example stays correct when admin tweaks either.
  const exampleSpend = 800;
  const examplePtsEarned = Math.floor(
    (exampleSpend * cfg.earnRateBookingBps) / 10000,
  );
  const exampleRupeesEarned = Math.floor(
    (examplePtsEarned * cfg.pointValuePaise) / 100,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <BackButton className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors" />

      {/* ─── HERO ──────────────────────────────────────────────────── */}
      <header className="relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/80 via-zinc-950 to-zinc-950 p-8 sm:p-10">
        <div className="absolute -top-20 -right-20 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" />
            Momentum Points
          </div>
          <h1 className="mt-4 text-4xl sm:text-5xl font-extrabold text-white leading-tight">
            The more you play,
            <br />
            <span className="bg-gradient-to-r from-emerald-300 to-emerald-500 bg-clip-text text-transparent">
              the more you save.
            </span>
          </h1>
          <p className="mt-3 max-w-md text-sm sm:text-base text-zinc-400">
            Every booking earns you points. Every point trims your next bill.
            That's it — no codes, no catches.
          </p>

          {/* Live balance teaser */}
          <div className="mt-6 inline-flex items-end gap-2 rounded-2xl border border-emerald-500/30 bg-zinc-950/60 px-5 py-4 backdrop-blur">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-300/80">
                You have
              </p>
              <div className="flex items-end gap-1.5">
                <span className="text-3xl sm:text-4xl font-extrabold text-white">
                  {overview.pointsAvailable.toLocaleString("en-IN")}
                </span>
                <span className="pb-1 text-xs text-zinc-400">pts</span>
              </div>
              <p className="text-xs text-emerald-300/80">
                = ₹
                {Math.round(overview.pointsValuePaise / 100).toLocaleString(
                  "en-IN",
                )}{" "}
                off your next booking
              </p>
            </div>
          </div>

          {!cfg.enabled && (
            <div className="mt-5 inline-flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Rewards are paused right now</p>
                <p className="mt-0.5 text-amber-200/80 text-xs">
                  You can still see how it usually works below.
                </p>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ─── 3 STEPS ───────────────────────────────────────────────── */}
      <section>
        <SectionLabel>The whole thing in 3 steps</SectionLabel>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StepCard
            n={1}
            color="emerald"
            Icon={Calendar}
            title="Book a court"
            body="Cricket, football, pickleball — or grab a snack from the cafe."
          />
          <StepCard
            n={2}
            color="amber"
            Icon={Sparkles}
            title="Earn points"
            body={`${earnPctBooking}% of every booking comes straight back as Momentum Points.`}
          />
          <StepCard
            n={3}
            color="yellow"
            Icon={Wallet}
            title="Save next time"
            body="Tick one checkbox at checkout. Your points cut your bill instantly."
          />
        </div>
      </section>

      {/* ─── WORKED EXAMPLE ────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl border border-yellow-500/30 bg-gradient-to-br from-yellow-950/40 via-zinc-950 to-zinc-950 p-6 sm:p-8">
        <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-yellow-500/10 blur-3xl" />
        <div className="relative">
          <SectionLabel className="text-yellow-300">
            See it with real numbers
          </SectionLabel>
          <p className="mt-2 text-sm text-zinc-400">
            Here's exactly what happens when you book a ₹{exampleSpend} pickleball
            slot at tonight's rate:
          </p>

          {/* Flow row */}
          <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] items-center">
            <ExamplePill
              icon={<IndianRupee className="h-5 w-5" />}
              label="You pay"
              value={`₹${exampleSpend}`}
              tone="zinc"
            />
            <ArrowRight className="hidden sm:block h-5 w-5 mx-auto text-zinc-600" />
            <ExamplePill
              icon={<Sparkles className="h-5 w-5" />}
              label={`Earn ${earnPctBooking}% back`}
              value={`+${examplePtsEarned.toLocaleString("en-IN")} pts`}
              tone="emerald"
            />
            <ArrowRight className="hidden sm:block h-5 w-5 mx-auto text-zinc-600" />
            <ExamplePill
              icon={<Wallet className="h-5 w-5" />}
              label="Next time save"
              value={`₹${exampleRupeesEarned.toLocaleString("en-IN")}`}
              tone="yellow"
            />
          </div>

          <p className="mt-5 text-xs text-zinc-500">
            That's it. No promo codes, no expiry to memorize — just a checkbox
            at checkout that takes ₹{exampleRupeesEarned} off your next bill.
          </p>
        </div>
      </section>

      {/* ─── HOW YOU EARN ───────────────────────────────────────────── */}
      <section>
        <SectionLabel>How you earn</SectionLabel>
        <p className="mt-2 text-sm text-zinc-400">
          Points show up automatically — you don't have to claim anything.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EarnCard
            Icon={TrendingUp}
            color="emerald"
            headline={`${earnPctBooking}% back`}
            title="Every confirmed booking"
            body={`Spend ₹100 on a slot, get ${(earnPctBooking).toString()} pts back. They land in your balance the moment the booking confirms.`}
          />
          {cfg.cafeEarnEnabled && (
            <EarnCard
              Icon={Coffee}
              color="amber"
              headline={`${earnPctCafe}% back`}
              title="Cafe orders too"
              body={`Grab a coffee, snacks, or a full meal — you earn on every cafe order, same as bookings.`}
            />
          )}
          <EarnCard
            Icon={Gift}
            color="yellow"
            headline="🎁"
            title="Bonus events"
            body="Welcome bonuses on signup, referrals, birthday treats, and the occasional venue-wide promo all credit straight to your balance."
          />
          <EarnCard
            Icon={Trophy}
            color="emerald"
            headline="∞"
            title="No cap on earning"
            body="There's no ceiling on how many points you can rack up. Play more, save more — straightforward."
          />
        </div>
      </section>

      {/* ─── HOW YOU SPEND ──────────────────────────────────────────── */}
      <section>
        <SectionLabel>How you spend</SectionLabel>
        <p className="mt-2 text-sm text-zinc-400">
          A few sensible rules so the system is fair for everyone.
        </p>
        <div className="mt-4 space-y-3">
          <RuleRow
            Icon={Coins}
            color="yellow"
            title={`1 point = ₹${pointValueRupees}`}
            body={`Plain and simple. Every point is ₹${pointValueRupees} off your bill — no exchange rates, no fine print.`}
          />
          <RuleRow
            Icon={CheckCircle2}
            color="emerald"
            title={`Start spending from ${cfg.minPointsToRedeem.toLocaleString("en-IN")} pts`}
            body={`We hold you back from spending until you have at least ${cfg.minPointsToRedeem.toLocaleString(
              "en-IN",
            )} points — keeps the discount meaningful.`}
          />
          <RuleRow
            Icon={Percent}
            color="sky"
            title={`Up to ${cfg.maxRedemptionPctOfBill}% of any bill`}
            body={`You can use points to cover up to ${cfg.maxRedemptionPctOfBill}% of any booking or cafe order. Pay the rest as usual.`}
          />
          {maxRedemptionRupees ? (
            <RuleRow
              Icon={IndianRupee}
              color="sky"
              title={`Cap of ₹${maxRedemptionRupees.toLocaleString("en-IN")} per transaction`}
              body={`The max rupee discount on a single transaction. Keeps things balanced across all members.`}
            />
          ) : null}
          {cfg.earnToRedeemMinHours > 0 ? (
            <RuleRow
              Icon={Clock}
              color="zinc"
              title={`A short ${cfg.earnToRedeemMinHours}-hour wait`}
              body={`Points you just earned are usable after ${cfg.earnToRedeemMinHours} hour${cfg.earnToRedeemMinHours === 1 ? "" : "s"}. (Stops accidental refund loops — purely a safety thing.)`}
            />
          ) : null}
        </div>
      </section>

      {/* ─── EXPIRY VISUAL ──────────────────────────────────────────── */}
      {/* All copy + the timeline are driven by cfg.pointExpiryMonths so
          changes in /admin/rewards flow through without a code edit.
          When admin sets the value to 0 (the "no expiry" sentinel
          shipped alongside the float Max % of bill change), we flip to
          a simpler card that just tells the user they have unlimited
          time, and skip the timeline SVG entirely. */}
      <section className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 sm:p-8">
        <SectionLabel>Time to use them</SectionLabel>
        <div className="mt-4 grid items-center gap-6 sm:grid-cols-[auto_1fr]">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-900">
            <CalendarClock className="h-7 w-7 text-zinc-300" />
          </div>
          <div>
            {cfg.pointExpiryMonths > 0 ? (
              <>
                <h3 className="text-lg font-bold text-white">
                  Each batch lasts {cfg.pointExpiryMonths} month
                  {cfg.pointExpiryMonths === 1 ? "" : "s"}
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  Points expire {cfg.pointExpiryMonths} month
                  {cfg.pointExpiryMonths === 1 ? "" : "s"} after they're
                  earned. Your{" "}
                  <Link
                    href="/rewards"
                    className="text-emerald-300 underline-offset-2 hover:underline"
                  >
                    statement
                  </Link>{" "}
                  flags any batch that's about to drop off so you never lose
                  them by accident.
                </p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold text-white">
                  Your points never expire
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  Earn now, spend whenever. Check your{" "}
                  <Link
                    href="/rewards"
                    className="text-emerald-300 underline-offset-2 hover:underline"
                  >
                    statement
                  </Link>{" "}
                  any time to see your balance.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Inline SVG timeline — month markers + a moving glow. Purely
            decorative; gives the expiry message a visual anchor. Marker
            spacing scales with cfg.pointExpiryMonths so a 6-month or
            24-month config still fits the 600px viewBox cleanly. We
            cap rendered "month" dots at 24 to avoid pixel-soup; only
            bookends + a few intermediates are visible past that. */}
        {cfg.pointExpiryMonths > 0 && (() => {
          const months = cfg.pointExpiryMonths;
          // Number of dots = months + 1 (Day 1 endpoint + each month
          // marker through expiry). For long configurations cap the
          // intermediate dots so the SVG stays legible.
          const totalMarkers = months + 1;
          const renderedMarkers = Math.min(totalMarkers, 25);
          const step = 600 / (renderedMarkers - 1);
          return (
            <svg
              viewBox="0 0 600 60"
              className="mt-6 w-full"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="timelineGrad" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="70%" stopColor="#fde047" />
                  <stop offset="100%" stopColor="#71717a" />
                </linearGradient>
              </defs>
              <rect
                x="0"
                y="22"
                width="600"
                height="6"
                rx="3"
                fill="url(#timelineGrad)"
                opacity="0.7"
              />
              {Array.from({ length: renderedMarkers }).map((_, i) => {
                const isStart = i === 0;
                const isEnd = i === renderedMarkers - 1;
                return (
                  <g key={i}>
                    <circle
                      cx={i * step}
                      cy={25}
                      r={isStart || isEnd ? 6 : 3}
                      fill={
                        isStart ? "#34d399" : isEnd ? "#71717a" : "#fde047"
                      }
                      opacity={isStart || isEnd ? 1 : 0.6}
                    />
                  </g>
                );
              })}
              <text x="0" y="55" fill="#34d399" fontSize="11" fontWeight="700">
                Day 1 · earned
              </text>
              <text
                x="600"
                y="55"
                fill="#a1a1aa"
                fontSize="11"
                fontWeight="700"
                textAnchor="end"
              >
                Month {months} · expires
              </text>
            </svg>
          );
        })()}
      </section>

      {/* ─── FAQ ──────────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Quick answers</SectionLabel>
        <div className="mt-4 space-y-3">
          <FaqItem
            q="Do I need to enter a code at checkout?"
            a={
              <>
                Nope — just tick the "Redeem Momentum Points" checkbox at
                checkout. Your discount applies instantly.
              </>
            }
          />
          <FaqItem
            q="Can I use points and a discount coupon together?"
            a={
              <>
                Yes. Points come off after coupons, so you stack savings on
                stacked savings.
              </>
            }
          />
          <FaqItem
            q="What if I cancel a booking I earned points on?"
            a={
              <>
                Those points are reversed automatically — you'll see a
                "Reversed" row in your{" "}
                <Link
                  href="/rewards"
                  className="text-emerald-300 underline-offset-2 hover:underline"
                >
                  statement
                </Link>
                .
              </>
            }
          />
          <FaqItem
            q="Can I transfer points to a friend?"
            a={<>Not today. Points are tied to your account.</>}
          />
          <FaqItem
            q="Where do I see my history?"
            a={
              <>
                Your{" "}
                <Link
                  href="/rewards"
                  className="text-emerald-300 underline-offset-2 hover:underline"
                >
                  statement
                </Link>{" "}
                lists every earn, redeem, and expiry — with the booking ID,
                rupee value, and date for each entry.
              </>
            }
          />
        </div>
      </section>

      {/* ─── CTA ──────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href="/book"
          className="group relative overflow-hidden rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-900/40 to-zinc-950 p-6 transition-all hover:border-emerald-400/60"
        >
          <Calendar className="h-6 w-6 text-emerald-400" />
          <p className="mt-3 text-base font-bold text-white">Book a court</p>
          <p className="mt-1 text-xs text-zinc-400">
            Start earning points today
          </p>
          <ArrowRight className="absolute right-5 bottom-5 h-5 w-5 text-emerald-400 transition-transform group-hover:translate-x-1" />
        </Link>
        <Link
          href="/rewards"
          className="group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 transition-all hover:border-zinc-700"
        >
          <Wallet className="h-6 w-6 text-zinc-300" />
          <p className="mt-3 text-base font-bold text-white">My statement</p>
          <p className="mt-1 text-xs text-zinc-500">
            Every earn, redeem & expiry — with full detail
          </p>
          <ArrowRight className="absolute right-5 bottom-5 h-5 w-5 text-zinc-400 transition-transform group-hover:translate-x-1" />
        </Link>
      </section>
    </div>
  );
}

// ─── Page primitives ─────────────────────────────────────────────────────

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`text-xs font-bold uppercase tracking-widest text-emerald-300/80 ${className ?? ""}`}
    >
      {children}
    </p>
  );
}

function StepCard({
  n,
  color,
  Icon,
  title,
  body,
}: {
  n: number;
  color: "emerald" | "amber" | "yellow";
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  // Tailwind needs concrete classes — switch on color rather than
  // template-string-interpolating into the className.
  const accent =
    color === "emerald"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
      : color === "amber"
        ? "border-amber-500/30 bg-amber-500/5 text-amber-300"
        : "border-yellow-500/30 bg-yellow-500/5 text-yellow-200";

  return (
    <div className={`relative rounded-2xl border p-5 ${accent}`}>
      <span className="absolute right-4 top-4 text-5xl font-extrabold text-zinc-800/60">
        {n}
      </span>
      <Icon className="h-7 w-7" />
      <p className="mt-3 text-base font-bold text-white">{title}</p>
      <p className="mt-1 text-xs text-zinc-300/80 leading-relaxed">{body}</p>
    </div>
  );
}

function ExamplePill({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "zinc" | "emerald" | "yellow";
}) {
  const accent =
    tone === "emerald"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : tone === "yellow"
        ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-300"
        : "border-zinc-700 bg-zinc-900/60 text-zinc-300";

  return (
    <div className={`rounded-2xl border p-4 text-center ${accent}`}>
      <div className="mx-auto inline-flex">{icon}</div>
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-widest opacity-80">
        {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold">{value}</p>
    </div>
  );
}

function EarnCard({
  Icon,
  color,
  headline,
  title,
  body,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  color: "emerald" | "amber" | "yellow";
  headline: string;
  title: string;
  body: string;
}) {
  const accent =
    color === "emerald"
      ? {
          border: "border-emerald-500/30",
          bg: "bg-emerald-500/5",
          text: "text-emerald-300",
        }
      : color === "amber"
        ? {
            border: "border-amber-500/30",
            bg: "bg-amber-500/5",
            text: "text-amber-300",
          }
        : {
            border: "border-yellow-500/30",
            bg: "bg-yellow-500/5",
            text: "text-yellow-300",
          };

  return (
    <div
      className={`rounded-2xl border p-5 ${accent.border} ${accent.bg}`}
    >
      <div className={`inline-flex rounded-xl p-2.5 ${accent.bg} border ${accent.border} ${accent.text}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className={`mt-3 text-3xl font-extrabold ${accent.text}`}>
        {headline}
      </p>
      <p className="mt-1 text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 text-xs text-zinc-400 leading-relaxed">{body}</p>
    </div>
  );
}

function RuleRow({
  Icon,
  color,
  title,
  body,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  color: "yellow" | "emerald" | "sky" | "zinc";
  title: string;
  body: string;
}) {
  const accent =
    color === "yellow"
      ? "border-yellow-500/30 bg-yellow-500/5 text-yellow-300"
      : color === "emerald"
        ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
        : color === "sky"
          ? "border-sky-500/30 bg-sky-500/5 text-sky-300"
          : "border-zinc-700 bg-zinc-900/40 text-zinc-300";

  return (
    <div className="flex items-start gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className={`shrink-0 rounded-xl border p-3 ${accent}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-1 text-xs text-zinc-400 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function FaqItem({
  q,
  a,
}: {
  q: string;
  a: React.ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-white">{q}</span>
        <span className="text-zinc-500 group-open:rotate-90 transition-transform">
          <ArrowRight className="h-4 w-4" />
        </span>
      </summary>
      <p className="mt-3 text-xs text-zinc-400 leading-relaxed">{a}</p>
    </details>
  );
}
