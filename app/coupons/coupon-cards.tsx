"use client";

import { useState } from "react";
import { formatPrice } from "@/lib/pricing";
import { Ticket, Copy, Check, Sparkles, Tag } from "lucide-react";

interface PublicCoupon {
  id: string;
  code: string;
  description: string | null;
  scope: string;
  type: string;
  value: number;
  maxDiscount: number | null;
  minAmount: number | null;
  sportFilter: string[];
  categoryFilter: string[];
  validFrom: string;
  validUntil: string;
  conditions: { type: string; value: string }[];
}

const SCOPE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  SPORTS: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
  CAFE: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  BOTH: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/20" },
};

function CouponCard({ coupon }: { coupon: PublicCoupon }) {
  const [copied, setCopied] = useState(false);
  const scopeStyle = SCOPE_STYLES[coupon.scope] || SCOPE_STYLES.BOTH;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(coupon.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDiscount = () => {
    if (coupon.type === "PERCENTAGE") {
      const pct = (coupon.value / 100).toFixed(0);
      return `${pct}% OFF`;
    }
    return `${formatPrice(coupon.value)} OFF`;
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const buildTerms = (): string[] => {
    const terms: string[] = [];
    if (coupon.minAmount) {
      terms.push(`Min order ${formatPrice(coupon.minAmount)}`);
    }
    if (coupon.maxDiscount) {
      terms.push(`Max discount ${formatPrice(coupon.maxDiscount)}`);
    }
    if (coupon.sportFilter.length > 0) {
      terms.push(`Valid for: ${coupon.sportFilter.map((s) => s.charAt(0) + s.slice(1).toLowerCase()).join(", ")}`);
    }
    if (coupon.categoryFilter.length > 0) {
      terms.push(`Categories: ${coupon.categoryFilter.map((c) => c.charAt(0) + c.slice(1).toLowerCase()).join(", ")}`);
    }
    for (const cond of coupon.conditions) {
      try {
        const val = JSON.parse(cond.value);
        switch (cond.type) {
          case "MIN_AMOUNT":
            if (val.minAmount) terms.push(`Min amount ${formatPrice(val.minAmount)}`);
            break;
          case "TIME_WINDOW":
            if (val.startHour !== undefined && val.endHour !== undefined) {
              terms.push(`Valid ${val.startHour}:00 - ${val.endHour}:00`);
            }
            break;
          case "FIRST_PURCHASE":
            terms.push("First purchase only");
            break;
        }
      } catch {}
    }
    return terms;
  };

  const terms = buildTerms();

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-zinc-900 to-zinc-950 transition-all hover:border-amber-500/40 hover:shadow-lg hover:shadow-amber-500/5">
      {/* Dashed cut-out effect */}
      <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-black" />
      <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-black" />

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span
              className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${scopeStyle.bg} ${scopeStyle.text} ${scopeStyle.border}`}
            >
              {coupon.scope === "BOTH"
                ? "Sports & Cafe"
                : coupon.scope.charAt(0) + coupon.scope.slice(1).toLowerCase()}
            </span>
          </div>
          <p className="text-xl font-bold text-amber-400">{formatDiscount()}</p>
        </div>

        {coupon.description && (
          <p className="mt-3 text-sm text-zinc-300">{coupon.description}</p>
        )}

        {/* Code with Copy */}
        <div className="mt-4 flex items-center gap-2">
          <div className="flex-1 rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-center">
            <span className="font-mono text-lg font-bold tracking-wider text-amber-300">
              {coupon.code}
            </span>
          </div>
          <button
            onClick={handleCopy}
            className={`shrink-0 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
              copied
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            }`}
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Validity */}
        <p className="mt-3 text-xs text-zinc-500">
          Valid: {formatDate(coupon.validFrom)} - {formatDate(coupon.validUntil)}
        </p>

        {/* Terms */}
        {terms.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {terms.map((t, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-500">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                {t}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function CouponCards({
  allCoupons,
  personalizedCoupons,
  personalizedIds,
  isLoggedIn,
}: {
  allCoupons: PublicCoupon[];
  personalizedCoupons: PublicCoupon[];
  personalizedIds: string[];
  isLoggedIn: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"ALL" | "SPORTS" | "CAFE">("ALL");

  const personalizedIdSet = new Set(personalizedIds);

  const filtered = allCoupons.filter((c) => {
    if (activeTab === "ALL") return true;
    return c.scope === activeTab || c.scope === "BOTH";
  });

  return (
    <div className="space-y-8">
      {/* Personalized Section */}
      {isLoggedIn && personalizedCoupons.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-5 w-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-white">For You</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {personalizedCoupons.map((coupon) => (
              <CouponCard key={coupon.id} coupon={coupon} />
            ))}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div>
        <div className="flex items-center gap-4 mb-5">
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
            {(["ALL", "SPORTS", "CAFE"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-zinc-700 text-white"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {tab === "ALL"
                  ? "All"
                  : tab.charAt(0) + tab.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <span className="text-sm text-zinc-500">
            {filtered.length} offer{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Coupon Grid */}
        {filtered.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((coupon) => (
              <CouponCard key={coupon.id} coupon={coupon} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-12 text-center">
            <Ticket className="mx-auto h-10 w-10 text-zinc-600" />
            <p className="mt-3 text-sm text-zinc-500">
              No offers available right now
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              Check back later for new deals and promotions
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
