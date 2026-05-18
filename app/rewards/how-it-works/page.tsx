import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Coffee,
  Coins,
  IndianRupee,
  Info,
  Percent,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { getMyRewardOverview } from "@/actions/rewards";
import { BackButton } from "@/components/back-button";

export const dynamic = "force-dynamic";

/**
 * Graphical "How it works" page for Momentum Points.
 *
 * Every value on this page is driven by the live RewardConfig via
 * getMyRewardOverview() — so when admin changes the earn-rate from
 * 20 % → 15 % in /admin/rewards, the next request renders the new
 * number here AND in the redemption checkbox on the checkout page,
 * with no separate copy edits.
 *
 * Sister page is /rewards (the "statement"): hero balance + lifetime
 * stats + transaction history. They link to each other so the user
 * can drill in either direction from the Account tile.
 */
export default async function RewardsHowItWorksPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?returnTo=/rewards/how-it-works");
  }
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

  // Card definitions are computed inline so an admin's config change
  // re-renders the whole grid on next request. Each card pairs a
  // huge headline (the config value) with a one-line plain-English
  // explanation — UX research showed the bullet-list version we had
  // here previously made users skim past the rules they cared about.
  const cards: Array<{
    icon: React.ReactNode;
    accent: string;
    accentBg: string;
    accentBorder: string;
    headline: string;
    title: string;
    body: string;
  } | null> = [
    {
      icon: <TrendingUp className="h-6 w-6" />,
      accent: "text-emerald-300",
      accentBg: "bg-emerald-500/10",
      accentBorder: "border-emerald-500/30",
      headline: `${earnPctBooking}%`,
      title: "Earn on every booking",
      body: `Get ${earnPctBooking}% of every confirmed booking back as Momentum Points — automatically credited the moment the booking is confirmed.`,
    },
    cfg.cafeEarnEnabled
      ? {
          icon: <Coffee className="h-6 w-6" />,
          accent: "text-amber-300",
          accentBg: "bg-amber-500/10",
          accentBorder: "border-amber-500/30",
          headline: `${earnPctCafe}%`,
          title: "Earn on cafe orders",
          body: `Pick up snacks, drinks, or meals at the venue and earn ${earnPctCafe}% back on every cafe order.`,
        }
      : null,
    {
      icon: <Coins className="h-6 w-6" />,
      accent: "text-yellow-300",
      accentBg: "bg-yellow-500/10",
      accentBorder: "border-yellow-500/30",
      headline: `1 pt = ₹${pointValueRupees}`,
      title: "Worth real rupees",
      body: `Every point you earn is worth ₹${pointValueRupees} off your next bill — no exchange rates, no fine print.`,
    },
    {
      icon: <CheckCircle2 className="h-6 w-6" />,
      accent: "text-emerald-300",
      accentBg: "bg-emerald-500/10",
      accentBorder: "border-emerald-500/30",
      headline: `${cfg.minPointsToRedeem.toLocaleString("en-IN")} pts`,
      title: "Minimum to redeem",
      body: `You can start spending once your balance crosses ${cfg.minPointsToRedeem.toLocaleString(
        "en-IN",
      )} points.`,
    },
    {
      icon: <Percent className="h-6 w-6" />,
      accent: "text-sky-300",
      accentBg: "bg-sky-500/10",
      accentBorder: "border-sky-500/30",
      headline: `${cfg.maxRedemptionPctOfBill}%`,
      title: "Of any bill, in points",
      body: `Apply up to ${cfg.maxRedemptionPctOfBill}% of any booking or cafe bill in points — pay the rest as usual.`,
    },
    maxRedemptionRupees
      ? {
          icon: <IndianRupee className="h-6 w-6" />,
          accent: "text-sky-300",
          accentBg: "bg-sky-500/10",
          accentBorder: "border-sky-500/30",
          headline: `₹${maxRedemptionRupees.toLocaleString("en-IN")}`,
          title: "Max per transaction",
          body: `Up to ₹${maxRedemptionRupees.toLocaleString(
            "en-IN",
          )} can come off a single bill in points — keeps things fair across all members.`,
        }
      : null,
    cfg.earnToRedeemMinHours > 0
      ? {
          icon: <Clock className="h-6 w-6" />,
          accent: "text-zinc-300",
          accentBg: "bg-zinc-800/60",
          accentBorder: "border-zinc-700",
          headline: `${cfg.earnToRedeemMinHours}h`,
          title: "Holding period",
          body: `Freshly-earned points become redeemable ${cfg.earnToRedeemMinHours} hour${cfg.earnToRedeemMinHours === 1 ? "" : "s"} after they hit your balance.`,
        }
      : null,
    {
      icon: <CalendarClock className="h-6 w-6" />,
      accent: "text-zinc-300",
      accentBg: "bg-zinc-800/60",
      accentBorder: "border-zinc-700",
      headline: "12 months",
      title: "Expiry window",
      body: "Each batch of points expires 12 months after it's earned. Use them or lose them — your activity page shows what's expiring soon.",
    },
  ];
  const visibleCards = cards.filter((c): c is NonNullable<typeof c> => c !== null);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:py-8">
      <BackButton className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors" />

      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-emerald-300">
          <Sparkles className="h-3.5 w-3.5" />
          Momentum Points
        </div>
        <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold text-white">
          How it works
        </h1>
        <p className="mt-2 text-zinc-400">
          Every value here is live — when the venue tweaks an earn-rate or a
          cap, the number updates straight on this page.
        </p>
      </div>

      {/* Disabled banner — surface clearly when rewards are off so the
          customer doesn't waste time trying to earn / redeem. */}
      {!cfg.enabled && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Rewards are temporarily paused</p>
            <p className="mt-1 text-amber-200/80">
              You can still see how it normally works below. New points won't
              accrue while it's off.
            </p>
          </div>
        </div>
      )}

      {/* Current balance teaser — gives the page a hero anchor while
          keeping the deep balance/statement on /rewards. */}
      <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950 to-emerald-950/40 p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/80">
          Your balance
        </p>
        <div className="mt-2 flex items-end gap-3">
          <span className="text-5xl font-extrabold text-white">
            {overview.pointsAvailable.toLocaleString("en-IN")}
          </span>
          <span className="pb-2 text-sm text-zinc-400">pts</span>
        </div>
        <p className="mt-1 text-sm text-emerald-300/80">
          Worth ₹
          {Math.round(overview.pointsValuePaise / 100).toLocaleString("en-IN")}{" "}
          off your next bill
        </p>
        <Link
          href="/rewards"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-300 hover:text-emerald-200"
        >
          View activity →
        </Link>
      </div>

      {/* Card grid — graphical breakdown of every config knob */}
      <div className="grid gap-3 sm:grid-cols-2">
        {visibleCards.map((card, i) => (
          <div
            key={i}
            className={`rounded-xl border p-5 ${card.accentBorder} ${card.accentBg}`}
          >
            <div className={`inline-flex rounded-lg ${card.accentBg} p-2 ${card.accent} border ${card.accentBorder}`}>
              {card.icon}
            </div>
            <p className={`mt-3 text-3xl font-extrabold ${card.accent}`}>
              {card.headline}
            </p>
            <p className="mt-2 text-sm font-semibold text-white">{card.title}</p>
            <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
              {card.body}
            </p>
          </div>
        ))}
      </div>

      {/* Footer CTA */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/book"
          className="group flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 transition-all hover:bg-emerald-500/15"
        >
          <div>
            <p className="text-sm font-semibold text-white">Book a court</p>
            <p className="text-xs text-zinc-400">Start earning points today</p>
          </div>
          <span className="text-emerald-300 transition-transform group-hover:translate-x-1">
            →
          </span>
        </Link>
        <Link
          href="/rewards"
          className="group flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-5 py-4 transition-all hover:border-zinc-700"
        >
          <div>
            <p className="text-sm font-semibold text-white">My statement</p>
            <p className="text-xs text-zinc-500">
              Earned, redeemed & current balance
            </p>
          </div>
          <span className="text-zinc-400 transition-transform group-hover:translate-x-1">
            →
          </span>
        </Link>
      </div>
    </div>
  );
}
