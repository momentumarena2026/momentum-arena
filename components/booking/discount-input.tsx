"use client";

import { useState } from "react";
import { validateDiscountCode, applyDiscountCode } from "@/actions/discount-validation";
import { formatPrice } from "@/lib/pricing";
import { Ticket, Check, X, Loader2 } from "lucide-react";

interface DiscountInputProps {
  bookingId: string;
  disabled?: boolean;
  disabledMessage?: string;
  onDiscountApplied: (discountAmount: number, newTotal: number, code: string) => void;
}

export function DiscountInput({
  bookingId,
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

  const handleApply = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);

    // First validate
    const validation = await validateDiscountCode(code, bookingId);
    if (!validation.valid) {
      setError(validation.error || "Invalid code");
      setLoading(false);
      return;
    }

    // Then apply
    const result = await applyDiscountCode(code, bookingId);
    if (result.valid && result.discountAmount && result.newTotal !== undefined) {
      setApplied({
        code: result.codeName || code,
        discountAmount: result.discountAmount,
        newTotal: result.newTotal,
      });
      onDiscountApplied(result.discountAmount, result.newTotal, result.codeName || code);
    } else {
      setError(result.error || "Failed to apply");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-2">
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
            placeholder="Discount code"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2.5 pl-10 pr-3 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <button
          onClick={handleApply}
          disabled={loading || !code.trim()}
          className="rounded-lg bg-zinc-700 px-4 text-sm font-medium text-white hover:bg-zinc-600 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Apply"
          )}
        </button>
      </div>
      {error && (
        <p className="flex items-center gap-1 text-xs text-red-400">
          <X className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}
