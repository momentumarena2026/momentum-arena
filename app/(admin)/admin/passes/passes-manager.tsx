"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createPassPlan,
  updatePassPlan,
  deletePassPlan,
  setPassesEnabled,
  togglePassPlan,
  type PassConfigOption,
} from "@/actions/admin-passes";
import { Plus, Ticket, Trash2, Pencil, X, Loader2, AlertTriangle } from "lucide-react";
import { bandsSummary, type Band } from "@/lib/pass-bands";
import { BandPicker, anchorPerHour } from "./band-picker";

interface Plan {
  id: string;
  name: string;
  sport: string;
  courtConfigId: string;
  totalMinutes: number;
  anchorPricePerHour: number;
  anchorPrice: number | null;
  bands: Band[];
  pricingValid: boolean;
  baseAmount: number;
  discountPercent: number;
  price: number;
  validityDays: number;
  isActive: boolean;
  soldCount: number;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * Plan wizard + list. Flow: sport → court → hours → pricing bands (the
 * price tier the pass redeems on; anchor derived) → discount → validity.
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
  const [editing, setEditing] = useState<Plan | null>(null);

  const sports = useMemo(
    () => [...new Set(configs.map((c) => c.sport))],
    [configs],
  );
  const [sport, setSport] = useState<string>("");
  const sportConfigs = configs.filter((c) => c.sport === sport);
  const [configId, setConfigId] = useState<string>("");
  const config = configs.find((c) => c.id === configId) ?? null;

  const [hours, setHours] = useState(5);
  const [bands, setBands] = useState<Band[]>([]);
  const [discount, setDiscount] = useState(5);
  const [validity, setValidity] = useState(30);
  const [name, setName] = useState("");

  const anchor = anchorPerHour(config ?? undefined, bands);
  const baseAmount = Math.round(anchor * hours);
  const finalPrice = Math.round(baseAmount * (1 - discount / 100));
  const effectiveHourly = hours > 0 ? Math.round(finalPrice / hours) : 0;

  function pickConfig(id: string) {
    setConfigId(id);
    setBands([]); // bands belong to a court; reset on court change
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createPassPlan({
        courtConfigId: configId,
        totalHours: hours,
        bands,
        discountPercent: discount,
        validityDays: validity,
        name: name || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      setBands([]);
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
                setBands([]);
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
            <label className={labelClass}>5 · Validity (days)</label>
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
          <div className="flex flex-col gap-1">
            <label className={labelClass}>Name (optional)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                config ? `${config.label} — ${hours} Hour Pass` : "Auto-generated"
              }
              className={inputClass}
            />
          </div>
        </div>

        {/* 6. Pricing bands (determines the anchor) */}
        <div className="mt-4">
          <label className={labelClass}>
            6 · Pricing bands — the price tier this pass redeems on
          </label>
          <div className="mt-1.5">
            <BandPicker config={config ?? undefined} selected={bands} onChange={setBands} />
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
            disabled={
              pending || !configId || bands.length === 0 || !hours || !validity
            }
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
                <th className="px-4 py-3">Bands</th>
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
                    <td className="px-4 py-3">
                      <span className="text-zinc-300">{bandsSummary(p.bands)}</span>
                      {!p.pricingValid && (
                        <span className="mt-1 flex items-center gap-1 text-[11px] text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> Pricing changed —
                          not sellable
                        </span>
                      )}
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
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditing(p)}
                          disabled={pending}
                          title="Edit plan"
                          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-400 disabled:opacity-30"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
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

      {editing && (
        <EditPlanModal
          plan={editing}
          config={configs.find((c) => c.id === editing.courtConfigId)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Edit-plan modal. Court + sport are fixed (shown read-only); bands +
 *  the rest mirror the create wizard. Saving never touches sold passes. */
function EditPlanModal({
  plan,
  config,
  onClose,
}: {
  plan: Plan;
  config: PassConfigOption | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(plan.name);
  const [hours, setHours] = useState(plan.totalMinutes / 60);
  const [discount, setDiscount] = useState(plan.discountPercent);
  const [validity, setValidity] = useState(plan.validityDays);
  const [bands, setBands] = useState<Band[]>(plan.bands);

  const anchor = anchorPerHour(config, bands);
  const baseAmount = Math.round(anchor * hours);
  const finalPrice = Math.round(baseAmount * (1 - discount / 100));
  const step = config?.slotDurationMinutes === 30 ? 0.5 : 1;

  const inputClass =
    "rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-600 focus:outline-none";
  const labelClass = "text-xs text-zinc-400";

  function save() {
    setError(null);
    start(async () => {
      const res = await updatePassPlan(plan.id, {
        totalHours: hours,
        bands,
        discountPercent: discount,
        validityDays: validity,
        name: name.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-white">
              <Pencil className="h-4 w-4 text-emerald-400" /> Edit pass plan
            </h3>
            <p className="text-xs text-zinc-500">
              {config
                ? `${config.sport.charAt(0)}${config.sport.slice(1).toLowerCase()} · ${config.label}`
                : plan.sport.charAt(0) + plan.sport.slice(1).toLowerCase()}{" "}
              — court is fixed; make a new plan to change it.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className="rounded-full p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {plan.soldCount > 0 && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
            {plan.soldCount} pass(es) already sold — edits apply only to
            future purchases; existing passes keep their original terms.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className={labelClass}>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelClass}>Total hours</label>
            <input
              type="number"
              min={step}
              max={200}
              step={step}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelClass}>Discount %</label>
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
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className={labelClass}>Validity (days)</label>
            <input
              type="number"
              min={1}
              max={365}
              value={validity}
              onChange={(e) => setValidity(Number(e.target.value))}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Pricing bands</label>
          <div className="mt-1.5">
            <BandPicker config={config} selected={bands} onChange={setBands} />
          </div>
        </div>

        {anchor > 0 && hours > 0 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm">
            <span className="text-zinc-400">
              Actual:{" "}
              <span className="text-zinc-300 line-through">{inr(baseAmount)}</span>
            </span>
            <span className="font-semibold text-emerald-400">
              Pass: {inr(finalPrice)}
            </span>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={pending || bands.length === 0 || !hours || !validity}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
