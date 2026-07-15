"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gift, Loader2 } from "lucide-react";
import { giftCustomPass } from "@/actions/admin-passes";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";

interface Config {
  id: string;
  sport: string;
  label: string;
}

const sportName = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/**
 * Gift a bespoke pass to one specific customer — a private, made-up
 * pass for birthdays / occasions that never appears on the public
 * storefront (it isn't a PassPlan). Pick the recipient + court, set the
 * hours and validity, and it lands on their account, redeemable at
 * checkout like any pass. Free by default; a value can be recorded.
 */
export function GiftPass({ configs }: { configs: Config[] }) {
  const router = useRouter();
  const sortedConfigs = useMemo(
    () =>
      [...configs].sort((a, b) =>
        `${a.sport}${a.label}`.localeCompare(`${b.sport}${b.label}`),
      ),
    [configs],
  );

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [courtConfigId, setCourtConfigId] = useState(sortedConfigs[0]?.id ?? "");
  const [name, setName] = useState("");
  const [hours, setHours] = useState("5");
  const [validityDays, setValidityDays] = useState("30");
  const [timeType, setTimeType] = useState<"" | "PEAK" | "OFF_PEAK">("");
  const [value, setValue] = useState("0");
  const [note, setNote] = useState("");

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function submit() {
    if (!customer || !courtConfigId) return;
    setError(null);
    setDone(null);
    const totalHours = Number.parseFloat(hours);
    const days = Number.parseInt(validityDays, 10);
    const val = Number.parseInt(value || "0", 10);
    if (!Number.isFinite(totalHours) || totalHours <= 0) {
      setError("Enter valid hours.");
      return;
    }
    if (!Number.isInteger(days) || days < 1) {
      setError("Enter valid validity days.");
      return;
    }
    start(async () => {
      const res = await giftCustomPass({
        userId: customer.id,
        courtConfigId,
        totalHours,
        validityDays: days,
        timeType: timeType || null,
        name: name.trim() || undefined,
        value: Number.isNaN(val) ? 0 : val,
        note: note.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(
        `Gift pass sent to ${customer.name ?? customer.phone ?? "customer"}.`,
      );
      // Reset for the next gift; keep court + defaults.
      setCustomer(null);
      setName("");
      setNote("");
      router.refresh();
    });
  }

  if (sortedConfigs.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
        Add an active court to gift a custom pass.
      </div>
    );
  }

  const canSubmit = !!customer && !!courtConfigId && !pending;

  return (
    <section className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.03] p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-fuchsia-500/10 ring-1 ring-fuchsia-500/25">
          <Gift className="h-5 w-5 text-fuchsia-400" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-white">Gift a custom pass</h2>
          <p className="text-xs text-zinc-500">
            A private pass for one customer (birthdays, occasions). Not listed
            on the storefront — it just appears on their account.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Recipient */}
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Recipient
          </label>
          <CustomerPicker
            value={customer}
            onChange={setCustomer}
            onError={setError}
          />
        </div>

        {/* Court */}
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Court / sport
          </label>
          <select
            value={courtConfigId}
            onChange={(e) => setCourtConfigId(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-fuchsia-500 focus:outline-none"
          >
            {sortedConfigs.map((c) => (
              <option key={c.id} value={c.id}>
                {sportName(c.sport)} — {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Name */}
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Pass name (optional)
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Birthday Gift — 5h Cricket"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-fuchsia-500 focus:outline-none"
          />
        </div>

        {/* Hours + validity */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
              Hours
            </label>
            <input
              type="number"
              inputMode="decimal"
              min={0.5}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-fuchsia-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
              Valid (days)
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={validityDays}
              onChange={(e) => setValidityDays(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-fuchsia-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Redeemable hours */}
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Redeemable hours
          </label>
          <select
            value={timeType}
            onChange={(e) =>
              setTimeType(e.target.value as "" | "PEAK" | "OFF_PEAK")
            }
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-fuchsia-500 focus:outline-none"
          >
            <option value="">All hours</option>
            <option value="OFF_PEAK">Off-peak only</option>
            <option value="PEAK">Peak only</option>
          </select>
        </div>

        {/* Value */}
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Recorded value (₹)
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-fuchsia-500 focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-zinc-500">
            Free to the recipient — this is only for your records / reports.
          </p>
        </div>

        {/* Occasion note */}
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Occasion / note (optional)
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Diwali gift, loyalty reward"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-fuchsia-500 focus:outline-none"
          />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {done && <p className="mt-3 text-sm text-fuchsia-300">{done}</p>}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">
          Lands on the recipient&apos;s account immediately; expires after the
          validity window.
        </p>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white hover:bg-fuchsia-500 disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Gift className="h-4 w-4" />
          )}
          Gift pass
        </button>
      </div>
    </section>
  );
}
