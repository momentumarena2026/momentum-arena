"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createPassPlan,
  deletePassPlan,
  setPassesEnabled,
  togglePassPlan,
  type PassConfigOption,
} from "@/actions/admin-passes";
import { Plus, Ticket, Trash2 } from "lucide-react";

interface Plan {
  id: string;
  name: string;
  sport: string;
  courtConfigId: string;
  totalMinutes: number;
  anchorPricePerHour: number;
  baseAmount: number;
  discountPercent: number;
  price: number;
  validityDays: number;
  isActive: boolean;
  soldCount: number;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const RATE_LABEL: Record<string, string> = {
  "WEEKDAY-OFF_PEAK": "Weekday · Off-peak",
  "WEEKDAY-PEAK": "Weekday · Peak",
  "WEEKEND-OFF_PEAK": "Weekend · Off-peak",
  "WEEKEND-PEAK": "Weekend · Peak",
};

/**
 * Plan wizard + list. The wizard follows the agreed flow: sport →
 * court/sub-sport → hours (live "actual price") → discount % → validity
 * → create. The anchor rate defaults to the config's HIGHEST hourly
 * rate (marketing story: "₹2,000/hr → ₹1,900/hr with the pass") but
 * stays editable so the venue controls the economics.
 */
export function PassesManager({
  configs,
  plans,
  salesEnabled,
}: {
  configs: PassConfigOption[];
  plans: Plan[];
  salesEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const sports = useMemo(
    () => [...new Set(configs.map((c) => c.sport))],
    [configs],
  );
  const [sport, setSport] = useState<string>("");
  const sportConfigs = configs.filter((c) => c.sport === sport);
  const [configId, setConfigId] = useState<string>("");
  const config = configs.find((c) => c.id === configId) ?? null;

  const [hours, setHours] = useState(5);
  const [anchor, setAnchor] = useState<number>(0);
  const [discount, setDiscount] = useState(5);
  const [validity, setValidity] = useState(30);
  const [name, setName] = useState("");

  // Per-hour rates for the selected config (normalise 30-min slots ×2).
  const hourlyRates = useMemo(() => {
    if (!config) return [];
    const perHour = config.slotDurationMinutes === 30 ? 2 : 1;
    return config.rates
      .map((r) => ({
        key: `${r.dayType}-${r.timeType}`,
        label: RATE_LABEL[`${r.dayType}-${r.timeType}`] ?? `${r.dayType} ${r.timeType}`,
        perHour: r.pricePerSlot * perHour,
      }))
      .sort((a, b) => b.perHour - a.perHour);
  }, [config]);

  function pickConfig(id: string) {
    setConfigId(id);
    const c = configs.find((x) => x.id === id);
    if (c) {
      const perHour = c.slotDurationMinutes === 30 ? 2 : 1;
      const max = Math.max(0, ...c.rates.map((r) => r.pricePerSlot * perHour));
      setAnchor(max);
    }
  }

  const baseAmount = Math.round(anchor * hours);
  const finalPrice = Math.round(baseAmount * (1 - discount / 100));
  const effectiveHourly = hours > 0 ? Math.round(finalPrice / hours) : 0;
  const autoName = config
    ? `${config.label} — ${hours} Hour Pass`
    : "";

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createPassPlan({
        courtConfigId: configId,
        totalHours: hours,
        anchorPricePerHour: anchor,
        discountPercent: discount,
        validityDays: validity,
        name: name || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      router.refresh();
    });
  }

  const inputClass =
    "rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-600 focus:outline-none";
  const labelClass = "text-xs text-zinc-400";

  return (
    <div className="space-y-6">
      {/* ── Storefront master switch ───────────────────────────── */}
      <div
        className={`flex items-center justify-between rounded-xl border p-4 ${
          salesEnabled
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-amber-500/30 bg-amber-500/10"
        }`}
      >
        <div>
          <p className="text-sm font-semibold text-white">Customer sales</p>
          <p className="text-xs text-zinc-400">
            {salesEnabled
              ? "The /passes page is live — customers can browse and buy."
              : "Sales are OFF — the buying page and purchase API are hidden. Already-sold passes keep redeeming at checkout."}
          </p>
        </div>
        <button
          onClick={() =>
            startTransition(async () => {
              await setPassesEnabled(!salesEnabled);
              router.refresh();
            })
          }
          disabled={pending}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            salesEnabled
              ? "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              : "bg-emerald-600 text-white hover:bg-emerald-500"
          }`}
        >
          {salesEnabled ? "Disable sales" : "Enable sales"}
        </button>
      </div>

      {/* ── Wizard ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
          <Ticket className="h-4 w-4 text-emerald-400" /> Create a pass plan
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* 1. Sport */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>1 · Sport</label>
            <select
              value={sport}
              onChange={(e) => {
                setSport(e.target.value);
                setConfigId("");
                setAnchor(0);
              }}
              className={inputClass}
            >
              <option value="">Select sport…</option>
              {sports.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Court / sub-sport */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>2 · Court / sub-sport</label>
            <select
              value={configId}
              onChange={(e) => pickConfig(e.target.value)}
              disabled={!sport}
              className={inputClass}
            >
              <option value="">Select court…</option>
              {sportConfigs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.category === "BOWLING_MACHINE" ? " (Bowling Machine)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* 3. Hours */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>3 · Total hours</label>
            <input
              type="number"
              min={1}
              max={200}
              step={config?.slotDurationMinutes === 30 ? 0.5 : 1}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className={inputClass}
            />
          </div>

          {/* Anchor rate */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>
              Anchor rate (₹/hour) — pre-filled with the highest
            </label>
            <input
              type="number"
              min={1}
              value={anchor || ""}
              onChange={(e) => setAnchor(Number(e.target.value))}
              className={inputClass}
            />
            {hourlyRates.length > 0 && (
              <p className="text-[11px] text-zinc-500">
                {hourlyRates
                  .map((r) => `${r.label}: ${inr(r.perHour)}`)
                  .join(" · ")}
              </p>
            )}
          </div>

          {/* 4. Discount */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>4 · Discount %</label>
            <input
              type="number"
              min={0}
              max={99}
              step={0.5}
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
              className={inputClass}
            />
          </div>

          {/* 5. Validity */}
          <div className="flex flex-col gap-1">
            <label className={labelClass}>5 · Validity (days from purchase)</label>
            <input
              type="number"
              min={1}
              max={365}
              value={validity}
              onChange={(e) => setValidity(Number(e.target.value))}
              className={inputClass}
            />
          </div>

          {/* Name */}
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className={labelClass}>Name (optional)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={autoName || "Auto-generated from court + hours"}
              className={inputClass}
            />
          </div>
        </div>

        {/* Live price summary */}
        {config && anchor > 0 && hours > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm">
            <span className="text-zinc-400">
              Actual price:{" "}
              <span className="text-zinc-300 line-through">{inr(baseAmount)}</span>
            </span>
            <span className="font-semibold text-emerald-400">
              Pass price: {inr(finalPrice)}
            </span>
            <span className="text-zinc-400">
              Effective{" "}
              <span className="font-semibold text-white">
                {inr(effectiveHourly)}/hr
              </span>{" "}
              instead of {inr(anchor)}/hr
            </span>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={pending || !configId || !anchor || !hours || !validity}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Create pass
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>

      {/* ── Existing plans ────────────────────────────────────── */}
      {plans.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
          No pass plans yet — create the first one above. Plans appear on
          the customer /passes page once active.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Hours</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Effective/hr</th>
                <th className="px-4 py-3">Validity</th>
                <th className="px-4 py-3">Sold</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const hrs = p.totalMinutes / 60;
                return (
                  <tr key={p.id} className="border-b border-zinc-800/60 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{p.name}</p>
                      <p className="text-xs text-zinc-500">
                        {p.sport.charAt(0) + p.sport.slice(1).toLowerCase()} ·{" "}
                        {p.discountPercent}% off
                      </p>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{hrs}h</td>
                    <td className="px-4 py-3">
                      <span className="text-zinc-500 line-through">{inr(p.baseAmount)}</span>{" "}
                      <span className="font-semibold text-emerald-400">{inr(p.price)}</span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      {inr(Math.round(p.price / hrs))}
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{p.validityDays}d</td>
                    <td className="px-4 py-3 text-zinc-300">{p.soldCount}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() =>
                          startTransition(async () => {
                            await togglePassPlan(p.id, !p.isActive);
                            router.refresh();
                          })
                        }
                        disabled={pending}
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                          p.isActive
                            ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                        }`}
                      >
                        {p.isActive ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          onClick={() => {
                            if (!window.confirm(`Delete “${p.name}”?`)) return;
                            startTransition(async () => {
                              const res = await deletePassPlan(p.id);
                              if (!res.ok) setError(res.error);
                              router.refresh();
                            });
                          }}
                          disabled={pending || p.soldCount > 0}
                          title={
                            p.soldCount > 0
                              ? "Has sold passes — deactivate instead"
                              : "Delete"
                          }
                          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
