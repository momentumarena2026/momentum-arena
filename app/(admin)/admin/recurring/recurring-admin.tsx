"use client";

import { useState } from "react";
import { updateRecurringConfig, type RecurringConfigData, type RecurringTier } from "@/actions/admin-recurring";
import { Plus, Trash2, Save, Loader2, RotateCcw } from "lucide-react";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function RecurringAdmin({ initialConfig }: { initialConfig: RecurringConfigData }) {
  const [config, setConfig] = useState(initialConfig);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const addTier = () => {
    const lastWeeks = config.tiers.length > 0 ? config.tiers[config.tiers.length - 1].weeks : 0;
    setConfig((prev) => ({
      ...prev,
      tiers: [...prev.tiers, { weeks: lastWeeks + 4, discountPercent: 5 }],
    }));
  };

  const removeTier = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      tiers: prev.tiers.filter((_, i) => i !== index),
    }));
  };

  const updateTier = (index: number, field: keyof RecurringTier, value: number) => {
    setConfig((prev) => ({
      ...prev,
      tiers: prev.tiers.map((t, i) => (i === index ? { ...t, [field]: value } : t)),
    }));
  };

  const toggleDay = (day: number) => {
    setConfig((prev) => ({
      ...prev,
      allowedDays: prev.allowedDays.includes(day)
        ? prev.allowedDays.filter((d) => d !== day)
        : [...prev.allowedDays, day].sort((a, b) => a - b),
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateRecurringConfig({
        tiers: config.tiers,
        allowedDays: config.allowedDays,
        maxWeeks: config.maxWeeks,
        minWeeks: config.minWeeks,
        enabled: config.enabled,
      });
      if (result.success) {
        setMessage({ type: "success", text: "Recurring config saved successfully!" });
      } else {
        setMessage({ type: "error", text: result.error || "Failed to save" });
      }
    } catch {
      setMessage({ type: "error", text: "Something went wrong" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Enable/Disable Toggle */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <p className="font-medium text-white">Enable Recurring Bookings</p>
            <p className="text-sm text-zinc-400 mt-0.5">
              Allow customers to create recurring weekly bookings with discounts
            </p>
          </div>
          <button
            role="switch"
            aria-checked={config.enabled}
            onClick={() => setConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              config.enabled ? "bg-emerald-600" : "bg-zinc-700"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                config.enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </label>
      </div>

      {config.enabled && (
        <>
          {/* Discount Tiers */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-white flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-emerald-400" />
                  Discount Tiers
                </h2>
                <p className="text-sm text-zinc-400 mt-0.5">
                  Set discount percentages based on number of weeks booked
                </p>
              </div>
              <button
                onClick={addTier}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-600 hover:text-white transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Tier
              </button>
            </div>

            {config.tiers.length === 0 ? (
              <p className="text-sm text-zinc-500 italic py-4 text-center">
                No discount tiers configured. Customers will pay full price for recurring bookings.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-[1fr,1fr,40px] gap-3 text-xs font-medium text-zinc-500 uppercase tracking-wider px-1">
                  <span>Weeks</span>
                  <span>Discount %</span>
                  <span />
                </div>
                {config.tiers.map((tier, index) => (
                  <div key={index} className="grid grid-cols-[1fr,1fr,40px] gap-3 items-center">
                    <div className="relative">
                      <input
                        type="number"
                        min={1}
                        max={52}
                        value={tier.weeks}
                        onChange={(e) => updateTier(index, "weeks", parseInt(e.target.value) || 0)}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">wks</span>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        max={50}
                        value={tier.discountPercent}
                        onChange={(e) => updateTier(index, "discountPercent", parseInt(e.target.value) || 0)}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">%</span>
                    </div>
                    <button
                      onClick={() => removeTier(index)}
                      className="flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-zinc-500 hover:border-red-500/50 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Preview */}
            {config.tiers.length > 0 && (
              <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3 space-y-1.5">
                <p className="text-xs font-medium text-zinc-400">Customer will see:</p>
                {config.tiers.map((tier, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-white">{tier.weeks} weeks</span>
                    <span className="text-zinc-500">—</span>
                    <span className="text-emerald-400 font-medium">{tier.discountPercent}% off</span>
                    <span className="text-zinc-600 text-xs">
                      (e.g. {"\u20B9"}1000/wk → {"\u20B9"}{(1000 * tier.weeks * (1 - tier.discountPercent / 100)).toFixed(0)} total)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Allowed Days */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-white">Allowed Recurring Days</h2>
              <p className="text-sm text-zinc-400 mt-0.5">
                Which days of the week customers can set up recurring bookings
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {DAY_NAMES.map((name, index) => {
                const isSelected = config.allowedDays.includes(index);
                return (
                  <button
                    key={index}
                    onClick={() => toggleDay(index)}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                      isSelected
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                        : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() =>
                setConfig((prev) => ({
                  ...prev,
                  allowedDays: prev.allowedDays.length === 7 ? [] : [0, 1, 2, 3, 4, 5, 6],
                }))
              }
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {config.allowedDays.length === 7 ? "Deselect All" : "Select All"}
            </button>
          </div>

          {/* Limits */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-white">Booking Limits</h2>
              <p className="text-sm text-zinc-400 mt-0.5">
                Min and max weeks for recurring bookings
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-zinc-400">Minimum Weeks</label>
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={config.minWeeks}
                  onChange={(e) => setConfig((prev) => ({ ...prev, minWeeks: parseInt(e.target.value) || 1 }))}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-sm text-zinc-400">Maximum Weeks</label>
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={config.maxWeeks}
                  onChange={(e) => setConfig((prev) => ({ ...prev, maxWeeks: parseInt(e.target.value) || 12 }))}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Save Button */}
      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save Configuration
      </button>
    </div>
  );
}
