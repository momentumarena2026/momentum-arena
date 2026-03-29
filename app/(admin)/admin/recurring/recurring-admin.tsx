"use client";

import { useState } from "react";
import { updateRecurringConfig, type RecurringConfigData, type RecurringTier, type DailyTier } from "@/actions/admin-recurring";
import { Plus, Trash2, Save, Loader2, RotateCcw, Calendar } from "lucide-react";

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

  const addDailyTier = () => {
    const lastDays = config.dailyTiers.length > 0 ? config.dailyTiers[config.dailyTiers.length - 1].days : 0;
    setConfig((prev) => ({
      ...prev,
      dailyTiers: [...prev.dailyTiers, { days: lastDays + 5, discountPercent: 3 }],
    }));
  };

  const removeDailyTier = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      dailyTiers: prev.dailyTiers.filter((_, i) => i !== index),
    }));
  };

  const updateDailyTier = (index: number, field: keyof DailyTier, value: number) => {
    setConfig((prev) => ({
      ...prev,
      dailyTiers: prev.dailyTiers.map((t, i) => (i === index ? { ...t, [field]: value } : t)),
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateRecurringConfig({
        tiers: config.tiers,
        allowedDays: [0, 1, 2, 3, 4, 5, 6], // All days allowed — day is auto-derived from booking date
        maxWeeks: config.maxWeeks,
        minWeeks: config.minWeeks,
        dailyTiers: config.dailyTiers,
        maxDays: config.maxDays,
        minDays: config.minDays,
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
              Allow customers to create recurring weekly or daily bookings with discounts
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
          {/* Weekly Discount Tiers */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-white flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-emerald-400" />
                  Weekly Discount Tiers
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
                No weekly discount tiers configured. Customers will pay full price for weekly recurring bookings.
              </p>
            ) : (
              <div className="space-y-2">
                {config.tiers.map((tier, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-3 py-2.5"
                  >
                    <span className="text-xs font-medium text-zinc-500 w-4 shrink-0">
                      {index + 1}.
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={52}
                        value={tier.weeks}
                        onChange={(e) => updateTier(index, "weeks", parseInt(e.target.value) || 0)}
                        className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white text-center"
                      />
                      <span className="text-xs text-zinc-500">weeks</span>
                    </div>
                    <span className="text-zinc-600">&rarr;</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={50}
                        value={tier.discountPercent}
                        onChange={(e) => updateTier(index, "discountPercent", parseInt(e.target.value) || 0)}
                        className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white text-center"
                      />
                      <span className="text-xs text-zinc-500">% off</span>
                    </div>
                    <span className="ml-auto text-xs text-zinc-600">
                      e.g. {"\u20B9"}1000/wk = {"\u20B9"}{(1000 * tier.weeks * (1 - tier.discountPercent / 100)).toFixed(0)}
                    </span>
                    <button
                      onClick={() => removeTier(index)}
                      className="shrink-0 rounded-md p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Limits inline */}
            <div className="flex items-center gap-4 pt-2 border-t border-zinc-800">
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500">Min</label>
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={config.minWeeks}
                  onChange={(e) => setConfig((prev) => ({ ...prev, minWeeks: parseInt(e.target.value) || 1 }))}
                  className="w-16 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-white text-center"
                />
                <span className="text-xs text-zinc-500">weeks</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500">Max</label>
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={config.maxWeeks}
                  onChange={(e) => setConfig((prev) => ({ ...prev, maxWeeks: parseInt(e.target.value) || 12 }))}
                  className="w-16 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-white text-center"
                />
                <span className="text-xs text-zinc-500">weeks</span>
              </div>
            </div>
          </div>

          {/* Daily Discount Tiers */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-white flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-blue-400" />
                  Daily Discount Tiers
                </h2>
                <p className="text-sm text-zinc-400 mt-0.5">
                  Set discount percentages for consecutive daily bookings
                </p>
              </div>
              <button
                onClick={addDailyTier}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-600 hover:text-white transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Tier
              </button>
            </div>

            {config.dailyTiers.length === 0 ? (
              <p className="text-sm text-zinc-500 italic py-4 text-center">
                No daily discount tiers configured. Customers will pay full price for daily recurring bookings.
              </p>
            ) : (
              <div className="space-y-2">
                {config.dailyTiers.map((tier, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-3 py-2.5"
                  >
                    <span className="text-xs font-medium text-zinc-500 w-4 shrink-0">
                      {index + 1}.
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={tier.days}
                        onChange={(e) => updateDailyTier(index, "days", parseInt(e.target.value) || 0)}
                        className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white text-center"
                      />
                      <span className="text-xs text-zinc-500">days</span>
                    </div>
                    <span className="text-zinc-600">&rarr;</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={50}
                        value={tier.discountPercent}
                        onChange={(e) => updateDailyTier(index, "discountPercent", parseInt(e.target.value) || 0)}
                        className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white text-center"
                      />
                      <span className="text-xs text-zinc-500">% off</span>
                    </div>
                    <span className="ml-auto text-xs text-zinc-600">
                      e.g. {"\u20B9"}1000/day = {"\u20B9"}{(1000 * tier.days * (1 - tier.discountPercent / 100)).toFixed(0)}
                    </span>
                    <button
                      onClick={() => removeDailyTier(index)}
                      className="shrink-0 rounded-md p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Limits inline */}
            <div className="flex items-center gap-4 pt-2 border-t border-zinc-800">
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500">Min</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={config.minDays}
                  onChange={(e) => setConfig((prev) => ({ ...prev, minDays: parseInt(e.target.value) || 1 }))}
                  className="w-16 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-white text-center"
                />
                <span className="text-xs text-zinc-500">days</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500">Max</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={config.maxDays}
                  onChange={(e) => setConfig((prev) => ({ ...prev, maxDays: parseInt(e.target.value) || 30 }))}
                  className="w-16 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-white text-center"
                />
                <span className="text-xs text-zinc-500">days</span>
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
