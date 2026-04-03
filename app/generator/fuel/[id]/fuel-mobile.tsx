"use client";

import { useState, useEffect } from "react";
import {
  pinAddFuelLog,
  pinGetFuelLogs,
  pinGetConfig,
  pinGetGenerator,
} from "@/actions/generator";
import { Fuel, Loader2, Check } from "lucide-react";

interface FuelLogItem {
  id: string;
  date: string;
  litres: number;
  pricePerLitre: number;
  totalCost: number;
  notes: string | null;
}

export function GeneratorFuelMobile({
  generatorId,
}: {
  generatorId: string;
}) {
  const [genName, setGenName] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [litres, setLitres] = useState("");
  const [pricePerLitre, setPricePerLitre] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [recentLogs, setRecentLogs] = useState<FuelLogItem[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [gen, config, logs] = await Promise.all([
          pinGetGenerator(generatorId),
          pinGetConfig(),
          pinGetFuelLogs(generatorId, new Date().toISOString().slice(0, 7)),
        ]);
        if (gen) setGenName(gen.name);
        setPricePerLitre(String(config.petrolPricePerLitre / 100));
        setRecentLogs(JSON.parse(JSON.stringify(logs)));
      } catch {
        // ignore
      }
      setLoading(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLogs = async () => {
    try {
      const month = new Date().toISOString().slice(0, 7);
      const data = await pinGetFuelLogs(generatorId, month);
      setRecentLogs(JSON.parse(JSON.stringify(data)));
    } catch {
      // ignore
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!litres || parseFloat(litres) <= 0) {
      setMsg({ type: "error", text: "Enter valid litres" });
      return;
    }
    setSaving(true);
    setMsg(null);
    const result = await pinAddFuelLog({
      generatorId,
      date,
      litres: parseFloat(litres),
      pricePerLitre: Math.round(parseFloat(pricePerLitre) * 100),
      notes: notes || undefined,
    });
    if (result.success) {
      setMsg({ type: "success", text: "Fuel logged!" });
      setLitres("");
      setNotes("");
      loadLogs();
    } else {
      setMsg({ type: "error", text: result.error || "Failed to log" });
    }
    setSaving(false);
  };

  const totalCost =
    litres && pricePerLitre
      ? (parseFloat(litres) * parseFloat(pricePerLitre)).toFixed(0)
      : null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black px-4 py-6">
      <div className="mx-auto max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <Fuel className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
          <h1 className="text-xl font-bold text-white">
            {genName || "Generator"} — Log Fuel
          </h1>
          <p className="text-sm text-zinc-500">Quick fuel entry</p>
        </div>

        {/* Status message */}
        {msg && (
          <div
            className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium ${
              msg.type === "success"
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-red-500/10 text-red-400 border border-red-500/20"
            }`}
          >
            {msg.type === "success" && <Check className="h-4 w-4" />}
            {msg.text}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Litres
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                value={litres}
                onChange={(e) => setLitres(e.target.value)}
                placeholder="e.g. 10"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-lg text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Price per Litre (₹)
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={pricePerLitre}
                onChange={(e) => setPricePerLitre(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Notes (optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {totalCost && (
              <div className="rounded-lg bg-zinc-950 px-4 py-3 text-center">
                <span className="text-sm text-zinc-400">Total: </span>
                <span className="text-lg font-bold text-white">
                  ₹{parseInt(totalCost).toLocaleString("en-IN")}
                </span>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={saving || !litres}
            className="w-full rounded-xl bg-emerald-600 py-4 text-base font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Saving...
              </span>
            ) : (
              "+ Log Fuel"
            )}
          </button>
        </form>

        {/* Recent logs */}
        {recentLogs.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Recent Entries
            </h3>
            <div className="space-y-2">
              {recentLogs.slice(0, 5).map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between rounded-lg bg-zinc-950 px-3 py-2.5"
                >
                  <div>
                    <span className="text-sm font-medium text-white">
                      {log.litres} L
                    </span>
                    <span className="ml-2 text-xs text-zinc-500">
                      {new Date(log.date).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        timeZone: "Asia/Kolkata",
                      })}
                    </span>
                  </div>
                  <span className="text-sm text-zinc-400">
                    ₹{(log.totalCost / 100).toLocaleString("en-IN")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick links */}
        <div className="flex gap-3">
          <a
            href={`/generator/run/${generatorId}`}
            className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 py-3 text-center text-sm font-medium text-zinc-300 transition-colors active:bg-zinc-800"
          >
            Start / Stop
          </a>
          <a
            href="/admin/generator"
            className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 py-3 text-center text-sm font-medium text-zinc-300 transition-colors active:bg-zinc-800"
          >
            Full Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
