"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDiscountCode, updateDiscountCode, deleteDiscountCode } from "@/actions/admin-discounts";
import { DiscountType, Sport } from "@prisma/client";
import { Plus, X, Loader2, Ticket, Percent, IndianRupee, Tag } from "lucide-react";
import { formatPrice } from "@/lib/pricing";

interface DiscountCodeRow {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  maxUses: number | null;
  usedCount: number;
  maxUsesPerUser: number;
  minBookingAmount: number | null;
  sportFilter: Sport[];
  validFrom: string;
  validUntil: string;
  isSystemCode: boolean;
  isActive: boolean;
  usageCount: number;
}

export function DiscountManager({ codes }: { codes: DiscountCodeRow[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    type: "PERCENTAGE" as DiscountType,
    value: "",
    maxUses: "",
    maxUsesPerUser: "1",
    minBookingAmount: "",
    sportFilter: [] as Sport[],
    validFrom: new Date().toISOString().split("T")[0],
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
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

    const result = await createDiscountCode({
      code: form.code,
      type: form.type,
      value,
      maxUses: form.maxUses ? parseInt(form.maxUses) : undefined,
      maxUsesPerUser: parseInt(form.maxUsesPerUser) || 1,
      minBookingAmount: form.minBookingAmount ? parseInt(form.minBookingAmount) : undefined,
      sportFilter: form.sportFilter.length > 0 ? form.sportFilter : undefined,
      validFrom: form.validFrom,
      validUntil: form.validUntil,
    });

    if (result.success) {
      setShowForm(false);
      setForm({ code: "", type: "PERCENTAGE", value: "", maxUses: "", maxUsesPerUser: "1", minBookingAmount: "", sportFilter: [], validFrom: form.validFrom, validUntil: form.validUntil });
      router.refresh();
    } else {
      setError(result.error || "Failed");
    }
    setSaving(false);
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await updateDiscountCode(id, { isActive: !isActive });
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Deactivate this code?")) return;
    await deleteDiscountCode(id);
    router.refresh();
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
          Create Discount Code
        </button>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-white">New Discount Code</h3>
            <button onClick={() => setShowForm(false)}>
              <X className="h-4 w-4 text-zinc-500" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input type="text" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="CODE (e.g., SUMMER20)" className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500 uppercase" />
            <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as DiscountType }))} className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white">
              <option value="PERCENTAGE">Percentage (basis points, 1000 = 10%)</option>
              <option value="FLAT">Flat (in ₹)</option>
            </select>
            <input type="number" value={form.value} onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))} placeholder={form.type === "PERCENTAGE" ? "Value (1000 = 10%)" : "Value in ₹ (e.g., 100)"} className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500" />
            <input type="number" value={form.maxUses} onChange={(e) => setForm((p) => ({ ...p, maxUses: e.target.value }))} placeholder="Max uses (empty = unlimited)" className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500" />
            <input type="date" value={form.validFrom} onChange={(e) => setForm((p) => ({ ...p, validFrom: e.target.value }))} className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white" />
            <input type="date" value={form.validUntil} onChange={(e) => setForm((p) => ({ ...p, validUntil: e.target.value }))} className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white" />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button onClick={handleCreate} disabled={saving || !form.code || !form.value} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : null}
            Create Code
          </button>
        </div>
      )}

      {/* Codes List */}
      <div className="space-y-2">
        {codes.map((code) => (
          <div
            key={code.id}
            className={`rounded-xl border p-4 ${
              code.isActive
                ? "border-zinc-800 bg-zinc-900"
                : "border-zinc-800/50 bg-zinc-900/50 opacity-60"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 ${code.type === "PERCENTAGE" ? "bg-purple-500/10" : "bg-emerald-500/10"}`}>
                  {code.type === "PERCENTAGE" ? (
                    <Percent className="h-4 w-4 text-purple-400" />
                  ) : (
                    <IndianRupee className="h-4 w-4 text-emerald-400" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-white">{code.code}</span>
                    {code.isSystemCode && (
                      <span className="rounded-full bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 text-[10px] text-blue-400">
                        System
                      </span>
                    )}
                    <span className="text-sm font-medium text-emerald-400">
                      {formatValue(code.type, code.value)} off
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {code.usedCount}/{code.maxUses ?? "∞"} used • Valid {code.validFrom} to {code.validUntil}
                    {code.sportFilter.length > 0 && ` • ${code.sportFilter.join(", ")}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggle(code.id, code.isActive)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    code.isActive ? "bg-emerald-600" : "bg-zinc-700"
                  }`}
                >
                  <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${code.isActive ? "translate-x-5" : "translate-x-1"}`} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {codes.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
            <Ticket className="mx-auto h-8 w-8 text-zinc-600" />
            <p className="mt-2 text-sm text-zinc-500">No discount codes yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
