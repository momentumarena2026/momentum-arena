"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCafeCoupon,
  updateCafeCoupon,
  deleteCafeCoupon,
} from "@/actions/admin-cafe-discounts";
import { CafeItemCategory, DiscountType } from "@prisma/client";
import {
  Plus,
  X,
  Loader2,
  Ticket,
  Percent,
  IndianRupee,
} from "lucide-react";
import { formatPrice } from "@/lib/pricing";

interface CafeCouponRow {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  maxUses: number | null;
  usedCount: number;
  maxUsesPerUser: number;
  minOrderAmount: number | null;
  categoryFilter: CafeItemCategory[];
  validFrom: string;
  validUntil: string;
  isActive: boolean;
  usageCount: number;
}

const CATEGORIES: CafeItemCategory[] = [
  "SNACKS",
  "BEVERAGES",
  "MEALS",
  "DESSERTS",
  "COMBOS",
];

export function CafeCouponsClient({
  coupons,
}: {
  coupons: CafeCouponRow[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [form, setForm] = useState({
    code: "",
    type: "PERCENTAGE" as DiscountType,
    value: "",
    maxUses: "",
    maxUsesPerUser: "1",
    minOrderAmount: "",
    categoryFilter: [] as CafeItemCategory[],
    validFrom: new Date().toISOString().split("T")[0],
    validUntil: new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .split("T")[0],
  });

  const handleCreate = async () => {
    setSaving(true);
    setError(null);

    const value = parseInt(form.value);
    if (isNaN(value) || value <= 0) {
      setError("Value must be positive");
      setSaving(false);
      return;
    }

    const result = await createCafeCoupon({
      code: form.code,
      type: form.type,
      value,
      maxUses: form.maxUses ? parseInt(form.maxUses) : undefined,
      maxUsesPerUser: parseInt(form.maxUsesPerUser) || 1,
      minOrderAmount: form.minOrderAmount
        ? parseInt(form.minOrderAmount) * 100
        : undefined,
      categoryFilter:
        form.categoryFilter.length > 0 ? form.categoryFilter : undefined,
      validFrom: form.validFrom,
      validUntil: form.validUntil,
    });

    if (result.success) {
      setShowForm(false);
      setForm({
        code: "",
        type: "PERCENTAGE",
        value: "",
        maxUses: "",
        maxUsesPerUser: "1",
        minOrderAmount: "",
        categoryFilter: [],
        validFrom: form.validFrom,
        validUntil: form.validUntil,
      });
      router.refresh();
    } else {
      setError(result.error || "Failed");
    }
    setSaving(false);
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    setTogglingId(id);
    try {
      await updateCafeCoupon(id, { isActive: !isActive });
      startTransition(() => router.refresh());
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Deactivate this coupon?")) return;
    setTogglingId(id);
    try {
      await deleteCafeCoupon(id);
      startTransition(() => router.refresh());
    } finally {
      setTogglingId(null);
    }
  };

  const toggleCategory = (cat: CafeItemCategory) => {
    setForm((prev) => ({
      ...prev,
      categoryFilter: prev.categoryFilter.includes(cat)
        ? prev.categoryFilter.filter((c) => c !== cat)
        : [...prev.categoryFilter, cat],
    }));
  };

  const formatValue = (type: DiscountType, value: number) => {
    if (type === "PERCENTAGE") return `${(value / 100).toFixed(0)}%`;
    return formatPrice(value);
  };

  return (
    <div className="space-y-4">
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl bg-emerald-600/10 border border-emerald-500/30 px-4 py-3 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20"
        >
          <Plus className="h-4 w-4" />
          Create Cafe Coupon
        </button>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-white">New Cafe Coupon</h3>
            <button onClick={() => setShowForm(false)}>
              <X className="h-4 w-4 text-zinc-500" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={form.code}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  code: e.target.value.toUpperCase(),
                }))
              }
              placeholder="CODE (e.g., CAFEFREE)"
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500 uppercase"
            />
            <select
              value={form.type}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  type: e.target.value as DiscountType,
                }))
              }
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
            >
              <option value="PERCENTAGE">
                Percentage (basis points, 1000 = 10%)
              </option>
              <option value="FLAT">Flat (in paise, 10000 = ₹100)</option>
            </select>
            <input
              type="number"
              value={form.value}
              onChange={(e) =>
                setForm((p) => ({ ...p, value: e.target.value }))
              }
              placeholder={
                form.type === "PERCENTAGE"
                  ? "Value (1000 = 10%)"
                  : "Value (paise, 10000 = ₹100)"
              }
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <input
              type="number"
              value={form.maxUses}
              onChange={(e) =>
                setForm((p) => ({ ...p, maxUses: e.target.value }))
              }
              placeholder="Max uses (empty = unlimited)"
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <input
              type="number"
              value={form.maxUsesPerUser}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  maxUsesPerUser: e.target.value,
                }))
              }
              placeholder="Max uses per user"
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <input
              type="number"
              value={form.minOrderAmount}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  minOrderAmount: e.target.value,
                }))
              }
              placeholder="Min order amount (₹)"
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <input
              type="date"
              value={form.validFrom}
              onChange={(e) =>
                setForm((p) => ({ ...p, validFrom: e.target.value }))
              }
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
            />
            <input
              type="date"
              value={form.validUntil}
              onChange={(e) =>
                setForm((p) => ({ ...p, validUntil: e.target.value }))
              }
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
            />
          </div>

          {/* Category filter */}
          <div>
            <p className="text-xs text-zinc-500 mb-2">
              Category filter (empty = all categories)
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    form.categoryFilter.includes(cat)
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={handleCreate}
            disabled={saving || !form.code || !form.value}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin inline mr-1" />
            ) : null}
            Create Coupon
          </button>
        </div>
      )}

      {/* Coupons List */}
      <div className="space-y-2">
        {coupons.map((coupon) => (
          <div
            key={coupon.id}
            className={`rounded-xl border p-4 ${
              coupon.isActive
                ? "border-zinc-800 bg-zinc-900"
                : "border-zinc-800/50 bg-zinc-900/50 opacity-60"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`rounded-lg p-2 ${
                    coupon.type === "PERCENTAGE"
                      ? "bg-purple-500/10"
                      : "bg-emerald-500/10"
                  }`}
                >
                  {coupon.type === "PERCENTAGE" ? (
                    <Percent className="h-4 w-4 text-purple-400" />
                  ) : (
                    <IndianRupee className="h-4 w-4 text-emerald-400" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-white">
                      {coupon.code}
                    </span>
                    <span className="text-sm font-medium text-emerald-400">
                      {formatValue(coupon.type, coupon.value)} off
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {coupon.usedCount}/{coupon.maxUses ?? "\u221E"} used
                    &middot; Valid {coupon.validFrom} to {coupon.validUntil}
                    {coupon.categoryFilter.length > 0 &&
                      ` \u00B7 ${coupon.categoryFilter.join(", ")}`}
                    {coupon.minOrderAmount &&
                      ` \u00B7 Min ${formatPrice(coupon.minOrderAmount)}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggle(coupon.id, coupon.isActive)}
                  disabled={togglingId === coupon.id}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                    coupon.isActive ? "bg-emerald-600" : "bg-zinc-700"
                  }`}
                >
                  {togglingId === coupon.id ? (
                    <Loader2 className="mx-auto h-3 w-3 animate-spin text-white" />
                  ) : (
                    <span
                      className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                        coupon.isActive
                          ? "translate-x-5"
                          : "translate-x-1"
                      }`}
                    />
                  )}
                </button>
              </div>
            </div>
          </div>
        ))}
        {coupons.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
            <Ticket className="mx-auto h-8 w-8 text-zinc-600" />
            <p className="mt-2 text-sm text-zinc-500">
              No cafe coupons yet
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
