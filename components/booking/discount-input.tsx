"use client";

import { useState, useEffect } from "react";
import { validateCoupon, applyCoupon } from "@/actions/coupon-validation";
import { getAvailableCoupons } from "@/actions/customer-coupons";
import { formatPrice } from "@/lib/pricing";
import { Ticket, Check, X, Loader2, ChevronRight, Tag, Copy } from "lucide-react";

interface DiscountInputProps {
  bookingId?: string;
  bookingAmount: number; // paise
  sport?: string;
  scope?: "SPORTS" | "CAFE";
  userId?: string;
  disabled?: boolean;
  disabledMessage?: string;
  onDiscountApplied: (discountAmount: number, newTotal: number, code: string) => void;
}

interface CouponItem {
  id: string;
  code: string;
  description: string | null;
  type: string;
  value: number;
  maxDiscount: number | null;
  minAmount: number | null;
  scope: string;
  validUntil: string | null;
}

export function DiscountInput({
  bookingId,
  bookingAmount,
  sport,
  scope = "SPORTS",
  userId,
  disabled,
  disabledMessage,
  onDiscountApplied,
}: DiscountInputProps) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{
    code: string;
    discountAmount: number;
    newTotal: number;
  } | null>(null);

  // Coupon drawer state
  const [showDrawer, setShowDrawer] = useState(false);
  const [coupons, setCoupons] = useState<CouponItem[]>([]);
  const [couponsLoading, setCouponsLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Fetch coupons when drawer opens
  useEffect(() => {
    if (showDrawer && coupons.length === 0) {
      setCouponsLoading(true);
      getAvailableCoupons(scope === "CAFE" ? "CAFE" : "SPORTS")
        .then((result) => {
          if (result.success) {
            setCoupons(
              (result.coupons as CouponItem[]).map((c) => ({
                ...c,
                validUntil: c.validUntil ? String(c.validUntil) : null,
              }))
            );
          }
        })
        .finally(() => setCouponsLoading(false));
    }
  }, [showDrawer, coupons.length, scope]);

  if (disabled) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
        <div className="flex items-center gap-2">
          <Check className="h-4 w-4 text-emerald-400" />
          <span className="text-sm text-emerald-400">{disabledMessage}</span>
        </div>
      </div>
    );
  }

  if (applied) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-400">
              {applied.code}
            </span>
            <span className="text-xs text-zinc-400">
              — {formatPrice(applied.discountAmount)} off
            </span>
          </div>
        </div>
      </div>
    );
  }

  const handleApply = async (couponCode?: string) => {
    const applyCode = couponCode || code.trim();
    if (!applyCode) return;
    setLoading(true);
    setError(null);
    setShowDrawer(false);

    const validation = await validateCoupon(applyCode, {
      scope,
      amount: bookingAmount,
      userId: userId || undefined,
      sport: sport || undefined,
    });

    if (
      !validation.valid ||
      !validation.couponId ||
      !validation.discountAmount
    ) {
      setError(validation.error || "Invalid code");
      setLoading(false);
      return;
    }

    // Apply the coupon
    if (userId && bookingId) {
      const applyResult = await applyCoupon(validation.couponId, userId, {
        bookingId,
        discountAmount: validation.discountAmount,
      });

      if (!applyResult.success) {
        setError(applyResult.error || "Failed to apply");
        setLoading(false);
        return;
      }
    }

    const newTotal = bookingAmount - validation.discountAmount;
    setApplied({
      code: applyCode.toUpperCase(),
      discountAmount: validation.discountAmount,
      newTotal,
    });
    setCode(applyCode.toUpperCase());
    onDiscountApplied(
      validation.discountAmount,
      newTotal,
      applyCode.toUpperCase()
    );
    setLoading(false);
  };

  const handleCopyAndApply = (couponCode: string) => {
    setCopiedCode(couponCode);
    setCode(couponCode);
    setTimeout(() => setCopiedCode(null), 1500);
    handleApply(couponCode);
  };

  function formatDiscount(coupon: CouponItem) {
    if (coupon.type === "PERCENTAGE") {
      const pct = coupon.value / 100;
      const maxStr = coupon.maxDiscount
        ? ` up to ${formatPrice(coupon.maxDiscount)}`
        : "";
      return `${pct}% OFF${maxStr}`;
    }
    return `${formatPrice(coupon.value)} OFF`;
  }

  return (
    <div className="space-y-2">
      {/* Input row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Ticket className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleApply()}
            placeholder="Enter coupon code"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2.5 pl-10 pr-3 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <button
          onClick={() => handleApply()}
          disabled={loading || !code.trim()}
          className="rounded-lg bg-zinc-700 px-4 text-sm font-medium text-white hover:bg-zinc-600 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
        </button>
      </div>

      {/* View all coupons CTA */}
      <button
        onClick={() => setShowDrawer(true)}
        className="flex w-full items-center justify-between rounded-lg border border-dashed border-amber-600/40 bg-amber-500/5 px-3 py-2.5 text-left transition hover:bg-amber-500/10"
      >
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-medium text-amber-400">
            View available coupons
          </span>
        </div>
        <ChevronRight className="h-4 w-4 text-amber-400" />
      </button>

      {error && (
        <p className="flex items-center gap-1 text-xs text-red-400">
          <X className="h-3 w-3" />
          {error}
        </p>
      )}

      {/* Coupon Drawer (slide-up modal) */}
      {showDrawer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowDrawer(false)}
          />

          {/* Drawer content */}
          <div className="relative z-10 w-full max-w-lg max-h-[80vh] rounded-t-2xl sm:rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden animate-in slide-in-from-bottom duration-300">
            {/* Header */}
            <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Available Coupons
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {coupons.length} offer{coupons.length !== 1 ? "s" : ""}{" "}
                  available
                </p>
              </div>
              <button
                onClick={() => setShowDrawer(false)}
                className="rounded-full p-1.5 bg-zinc-800 text-zinc-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Coupon list */}
            <div className="overflow-y-auto max-h-[60vh] p-4 space-y-3">
              {couponsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
                </div>
              ) : coupons.length === 0 ? (
                <div className="text-center py-12">
                  <Tag className="h-8 w-8 text-zinc-600 mx-auto mb-3" />
                  <p className="text-zinc-400 text-sm">
                    No coupons available right now
                  </p>
                </div>
              ) : (
                coupons.map((coupon) => {
                  const meetsMin =
                    !coupon.minAmount || bookingAmount >= coupon.minAmount;

                  return (
                    <div
                      key={coupon.id}
                      className={`rounded-xl border p-4 transition ${
                        meetsMin
                          ? "border-zinc-700 bg-zinc-800/50 hover:border-amber-600/50"
                          : "border-zinc-800 bg-zinc-900 opacity-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          {/* Discount badge */}
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="inline-flex items-center rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-400">
                              {formatDiscount(coupon)}
                            </span>
                            <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                              {coupon.scope}
                            </span>
                          </div>

                          {/* Code */}
                          <div className="flex items-center gap-2 mb-1">
                            <code className="text-sm font-mono font-bold text-white bg-zinc-700/50 px-2 py-0.5 rounded border border-dashed border-zinc-600">
                              {coupon.code}
                            </code>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(coupon.code);
                                setCopiedCode(coupon.code);
                                setTimeout(() => setCopiedCode(null), 1500);
                              }}
                              className="text-zinc-500 hover:text-white"
                            >
                              {copiedCode === coupon.code ? (
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>

                          {/* Description */}
                          {coupon.description && (
                            <p className="text-xs text-zinc-400 mt-1">
                              {coupon.description}
                            </p>
                          )}

                          {/* Min amount */}
                          {coupon.minAmount && !meetsMin && (
                            <p className="text-[11px] text-red-400 mt-1">
                              Min. order {formatPrice(coupon.minAmount)}
                            </p>
                          )}
                        </div>

                        {/* Apply button */}
                        <button
                          onClick={() => handleCopyAndApply(coupon.code)}
                          disabled={!meetsMin || loading}
                          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                            meetsMin
                              ? "bg-amber-500 text-black hover:bg-amber-400"
                              : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                          }`}
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
