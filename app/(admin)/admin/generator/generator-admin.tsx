"use client";

import { useState, useCallback, useEffect } from "react";
import {
  createGenerator,
  deleteGenerator,
  getGeneratorDashboard,
  addFuelLog,
  getFuelLogs,
  addOilChange,
  getOilChanges,
  startRunLog,
  stopRunLog,
  addManualRunLog,
  getRunLogs,
  updateGeneratorConfig,
  getGeneratorAnalytics,
  type GeneratorDashboardData,
  type GeneratorAnalyticsData,
} from "@/actions/generator";
import { formatPrice } from "@/lib/pricing";
import {
  Fuel,
  Droplets,
  Clock,
  Settings,
  BarChart3,
  Plus,
  Save,
  Loader2,
  Play,
  Square,
  AlertTriangle,
  ChevronDown,
  Timer,
  Trash2,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────

interface GeneratorItem {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ConfigData {
  id: string;
  petrolPricePerLitre: number;
  oilPricePerLitre: number;
  consumptionRate: number;
  firstOilChangeHours: number;
  secondOilChangeHours: number;
  regularOilChangeHours: number;
  oilChangeAlertHours: number;
  notificationEmails: string;
  oilChangeTemplateId: string;
  monthlyTemplateId: string;
  pinChangeTemplateId: string;
  generatorPin: string;
  hardwareApiKey: string;
}

type Tab = "dashboard" | "fuel" | "oil" | "runlog" | "config" | "analytics";

interface Props {
  initialGenerators: GeneratorItem[];
  initialConfig: ConfigData;
  initialDashboard: GeneratorDashboardData | null;
}

// ─── Main Component ──────────────────────────────────────────

export function GeneratorAdmin({
  initialGenerators,
  initialConfig,
  initialDashboard,
}: Props) {
  const [generators, setGenerators] = useState(initialGenerators);
  const [selectedGenId, setSelectedGenId] = useState(
    generators[0]?.id || ""
  );
  const [tab, setTab] = useState<Tab>("dashboard");
  const [dashboard, setDashboard] = useState<GeneratorDashboardData | null>(
    initialDashboard
  );
  const [config, setConfig] = useState(initialConfig);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const refreshDashboard = useCallback(
    async (genId?: string) => {
      const id = genId || selectedGenId;
      if (!id) return;
      try {
        const data = await getGeneratorDashboard(id);
        setDashboard(data);
      } catch {
        // ignore
      }
    },
    [selectedGenId]
  );

  const handleSelectGenerator = async (id: string) => {
    setSelectedGenId(id);
    setLoading(true);
    try {
      const data = await getGeneratorDashboard(id);
      setDashboard(data);
    } catch {
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGenerator = async () => {
    const id = prompt("Enter unique Generator ID (e.g. xgen_2026):");
    if (!id?.trim()) return;
    const name = prompt("Enter generator display name (e.g. Generator 1):");
    if (!name?.trim()) return;
    setLoading(true);
    const result = await createGenerator(id.trim(), name.trim());
    if (result.success && result.id) {
      const newGen: GeneratorItem = {
        id: result.id,
        name: name.trim(),
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setGenerators((prev) => [...prev, newGen]);
      setSelectedGenId(result.id);
      await refreshDashboard(result.id);
      showMessage("success", "Generator created");
    } else {
      showMessage("error", result.error || "Failed to create");
    }
    setLoading(false);
  };

  const handleDeleteGenerator = async () => {
    if (!selectedGenId) return;
    const gen = generators.find((g) => g.id === selectedGenId);
    if (!confirm(`Delete "${gen?.name}"? This will hide it from the list.`))
      return;
    setLoading(true);
    const result = await deleteGenerator(selectedGenId);
    if (result.success) {
      const remaining = generators.filter((g) => g.id !== selectedGenId);
      setGenerators(remaining);
      if (remaining.length > 0) {
        setSelectedGenId(remaining[0].id);
        await refreshDashboard(remaining[0].id);
      } else {
        setSelectedGenId("");
        setDashboard(null);
      }
      showMessage("success", "Generator deleted");
    } else {
      showMessage("error", result.error || "Failed to delete");
    }
    setLoading(false);
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "dashboard", label: "Dashboard", icon: <BarChart3 className="h-4 w-4" /> },
    { key: "fuel", label: "Log Fuel", icon: <Fuel className="h-4 w-4" /> },
    { key: "oil", label: "Oil Changes", icon: <Droplets className="h-4 w-4" /> },
    { key: "runlog", label: "Run Log", icon: <Timer className="h-4 w-4" /> },
    { key: "config", label: "Configuration", icon: <Settings className="h-4 w-4" /> },
    { key: "analytics", label: "Analytics", icon: <BarChart3 className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Message banner */}
      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm font-medium ${
            message.type === "success"
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              : "bg-red-500/10 text-red-400 border border-red-500/20"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Generator selector */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <select
            value={selectedGenId}
            onChange={(e) => handleSelectGenerator(e.target.value)}
            className="appearance-none rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 pr-10 text-white focus:border-emerald-500 focus:outline-none"
          >
            {generators.length === 0 && (
              <option value="">No generators</option>
            )}
            {generators.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        </div>
        <button
          onClick={handleCreateGenerator}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add Generator
        </button>
        {selectedGenId && (
          <button
            onClick={handleDeleteGenerator}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
            title="Delete generator"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/50 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {!selectedGenId ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center text-zinc-400">
          Create a generator to get started
        </div>
      ) : (
        <>
          {tab === "dashboard" && (
            <DashboardTab
              dashboard={dashboard}
              loading={loading}
              onRefresh={() => refreshDashboard()}
            />
          )}
          {tab === "fuel" && (
            <FuelTab
              generatorId={selectedGenId}
              config={config}
              onUpdate={() => refreshDashboard()}
              showMessage={showMessage}
            />
          )}
          {tab === "oil" && (
            <OilTab
              generatorId={selectedGenId}
              config={config}
              dashboard={dashboard}
              onUpdate={() => refreshDashboard()}
              showMessage={showMessage}
            />
          )}
          {tab === "runlog" && (
            <RunLogTab
              generatorId={selectedGenId}
              dashboard={dashboard}
              onUpdate={() => refreshDashboard()}
              showMessage={showMessage}
            />
          )}
          {tab === "config" && (
            <ConfigTab
              config={config}
              generators={generators}
              onSave={(c) => setConfig(c)}
              showMessage={showMessage}
            />
          )}
          {tab === "analytics" && (
            <AnalyticsTab
              generatorId={selectedGenId}
              showMessage={showMessage}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Dashboard Tab ───────────────────────────────────────────

function DashboardTab({
  dashboard,
  loading,
  onRefresh,
}: {
  dashboard: GeneratorDashboardData | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center text-zinc-400">
        No data available. Start by logging fuel.
      </div>
    );
  }

  const oilChangeProgress =
    dashboard.nextOilChangeAt > 0
      ? Math.min(
          100,
          ((dashboard.totalRunningHours /
            dashboard.nextOilChangeAt) *
            100)
        )
      : 0;

  const oilUrgent = dashboard.hoursUntilOilChange <= 10;
  const oilWarning = dashboard.hoursUntilOilChange <= 20;

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Running Hours"
          value={`${dashboard.totalRunningHours} hrs`}
          icon={<Clock className="h-5 w-5 text-emerald-400" />}
        />
        <StatCard
          label="Total Fuel Filled"
          value={`${dashboard.totalFuelFilled} L`}
          icon={<Fuel className="h-5 w-5 text-blue-400" />}
        />
        <StatCard
          label="Next Oil Change"
          value={`${dashboard.hoursUntilOilChange} hrs left`}
          icon={
            oilUrgent ? (
              <AlertTriangle className="h-5 w-5 text-red-400" />
            ) : (
              <Droplets className="h-5 w-5 text-purple-400" />
            )
          }
          color={
            oilUrgent
              ? "text-red-400"
              : oilWarning
                ? "text-amber-400"
                : undefined
          }
          subtitle={`at ${dashboard.nextOilChangeAt} hrs`}
        />
        <StatCard
          label="Monthly Cost"
          value={formatPrice(dashboard.monthlyCost / 100)}
          icon={<BarChart3 className="h-5 w-5 text-amber-400" />}
          subtitle={`Fuel: ${formatPrice(dashboard.monthlyFuelCost / 100)} | Oil: ${formatPrice(dashboard.monthlyOilCost / 100)}`}
        />
      </div>

      {/* Oil change progress */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-300">
            Oil Change Progress (Change #{dashboard.totalOilChanges + 1})
          </h3>
          <span className="text-xs text-zinc-500">
            {dashboard.totalRunningHours} / {dashboard.nextOilChangeAt} hrs
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all ${
              oilUrgent
                ? "bg-red-500"
                : oilWarning
                  ? "bg-amber-500"
                  : "bg-emerald-500"
            }`}
            style={{ width: `${oilChangeProgress}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-xs text-zinc-500">
          <span>0 hrs</span>
          <span>{dashboard.nextOilChangeAt} hrs</span>
        </div>
      </div>

      {/* Recent tables */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent fuel logs */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              Recent Fuel Logs
            </h3>
            <button
              onClick={onRefresh}
              className="text-xs text-zinc-400 hover:text-white"
            >
              Refresh
            </button>
          </div>
          {dashboard.recentFuelLogs.length === 0 ? (
            <p className="text-sm text-zinc-500">No fuel logs yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Litres</th>
                    <th className="pb-2">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.recentFuelLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-zinc-800/50"
                    >
                      <td className="py-2 text-zinc-300">
                        {new Date(log.date).toLocaleDateString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })}
                      </td>
                      <td className="py-2 text-zinc-300">{log.litres} L</td>
                      <td className="py-2 text-zinc-300">
                        {formatPrice(log.totalCost / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent oil changes */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h3 className="mb-4 text-sm font-semibold text-white">
            Recent Oil Changes
          </h3>
          {dashboard.recentOilChanges.length === 0 ? (
            <p className="text-sm text-zinc-500">No oil changes logged</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                    <th className="pb-2">#</th>
                    <th className="pb-2">Date</th>
                    <th className="pb-2">At Hours</th>
                    <th className="pb-2">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.recentOilChanges.map((oc) => (
                    <tr
                      key={oc.id}
                      className="border-b border-zinc-800/50"
                    >
                      <td className="py-2 text-zinc-400">
                        #{oc.sequenceNumber}
                      </td>
                      <td className="py-2 text-zinc-300">
                        {new Date(oc.date).toLocaleDateString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })}
                      </td>
                      <td className="py-2 text-zinc-300">
                        {oc.runningHoursAtChange} hrs
                      </td>
                      <td className="py-2 text-zinc-300">
                        {formatPrice(oc.totalCost / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
  subtitle,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color?: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <span className="text-xs text-zinc-500">{label}</span>
      </div>
      <div className={`text-xl font-bold ${color || "text-white"}`}>
        {value}
      </div>
      {subtitle && (
        <div className="mt-1 text-xs text-zinc-500">{subtitle}</div>
      )}
    </div>
  );
}

// ─── Fuel Tab ────────────────────────────────────────────────

function FuelTab({
  generatorId,
  config,
  onUpdate,
  showMessage,
}: {
  generatorId: string;
  config: ConfigData;
  onUpdate: () => void;
  showMessage: (type: "success" | "error", text: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [litres, setLitres] = useState("");
  const [pricePerLitre, setPricePerLitre] = useState(
    String(config.petrolPricePerLitre / 100)
  );
  const isStock = false;
  const [notes, setNotes] = useState("");

  // Fuel log history
  const [logs, setLogs] = useState<
    Array<{
      id: string;
      date: string;
      litres: number;
      pricePerLitre: number;
      totalCost: number;
      isStockPurchase: boolean;
      notes: string | null;
    }>
  >([]);
  const [filterMonth, setFilterMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [logsLoaded, setLogsLoaded] = useState(false);

  const loadLogs = async (month?: string) => {
    try {
      const data = await getFuelLogs(generatorId, month || filterMonth);
      setLogs(JSON.parse(JSON.stringify(data)));
      setLogsLoaded(true);
    } catch {
      // ignore
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!litres || parseFloat(litres) <= 0) {
      showMessage("error", "Enter valid litres");
      return;
    }
    setSaving(true);
    const result = await addFuelLog({
      generatorId,
      date,
      litres: parseFloat(litres),
      pricePerLitre: Math.round(parseFloat(pricePerLitre) * 100),
      isStockPurchase: isStock,
      notes: notes || undefined,
    });
    if (result.success) {
      showMessage("success", "Fuel logged successfully");
      setLitres("");
      setNotes("");
      onUpdate();
      loadLogs();
    } else {
      showMessage("error", result.error || "Failed");
    }
    setSaving(false);
  };

  // Load logs on first render
  useEffect(() => {
    if (!logsLoaded) loadLogs();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      {/* Form */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h3 className="mb-4 text-sm font-semibold text-white">
          Log Fuel Entry
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                Litres
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={litres}
                onChange={(e) => setLitres(e.target.value)}
                placeholder="e.g. 10"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                Price per Litre (₹)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={pricePerLitre}
                onChange={(e) => setPricePerLitre(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>


          {litres && pricePerLitre && (
            <div className="text-sm text-zinc-400">
              Total cost:{" "}
              <span className="font-semibold text-white">
                {formatPrice(
                  parseFloat(litres) * parseFloat(pricePerLitre)
                )}
              </span>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Log Fuel
          </button>
        </form>
      </div>

      {/* History */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Fuel Log History</h3>
          <input
            type="month"
            value={filterMonth}
            onChange={(e) => {
              setFilterMonth(e.target.value);
              loadLogs(e.target.value);
            }}
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1 text-sm text-white focus:border-emerald-500 focus:outline-none"
          />
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-zinc-500">No logs for this month</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Litres</th>
                  <th className="pb-2">Rate</th>
                  <th className="pb-2">Cost</th>
                  <th className="pb-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-zinc-800/50"
                  >
                    <td className="py-2 text-zinc-300">
                      {new Date(log.date).toLocaleDateString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}
                    </td>
                    <td className="py-2 text-zinc-300">{log.litres} L</td>
                    <td className="py-2 text-zinc-300">
                      {formatPrice(log.pricePerLitre / 100)}/L
                    </td>
                    <td className="py-2 text-zinc-300">
                      {formatPrice(log.totalCost / 100)}
                    </td>
                    <td className="py-2 text-zinc-500">
                      {log.notes || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Oil Change Tab ──────────────────────────────────────────

function OilTab({
  generatorId,
  config,
  dashboard,
  onUpdate,
  showMessage,
}: {
  generatorId: string;
  config: ConfigData;
  dashboard: GeneratorDashboardData | null;
  onUpdate: () => void;
  showMessage: (type: "success" | "error", text: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [oilLitres, setOilLitres] = useState("1");
  const [costPerLitre, setCostPerLitre] = useState(
    String(config.oilPricePerLitre / 100)
  );
  const [notes, setNotes] = useState("");

  const [changes, setChanges] = useState<
    Array<{
      id: string;
      date: string;
      runningHoursAtChange: number;
      litres: number;
      costPerLitre: number;
      totalCost: number;
      sequenceNumber: number;
      notes: string | null;
    }>
  >([]);
  const [loaded, setLoaded] = useState(false);

  const loadChanges = async () => {
    try {
      const data = await getOilChanges(generatorId);
      setChanges(JSON.parse(JSON.stringify(data)));
      setLoaded(true);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!loaded) loadChanges();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const result = await addOilChange({
      generatorId,
      date,
      litres: parseFloat(oilLitres),
      costPerLitre: Math.round(parseFloat(costPerLitre) * 100),
      notes: notes || undefined,
    });
    if (result.success) {
      showMessage("success", "Oil change logged");
      setNotes("");
      onUpdate();
      loadChanges();
    } else {
      showMessage("error", result.error || "Failed");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* Next oil change info */}
      {dashboard && (
        <div
          className={`rounded-xl border p-6 ${
            dashboard.hoursUntilOilChange <= 10
              ? "border-red-500/30 bg-red-500/5"
              : dashboard.hoursUntilOilChange <= 20
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-zinc-800 bg-zinc-900"
          }`}
        >
          <div className="flex items-center gap-3">
            {dashboard.hoursUntilOilChange <= 10 && (
              <AlertTriangle className="h-5 w-5 text-red-400" />
            )}
            <div>
              <h3 className="text-sm font-semibold text-white">
                Next Oil Change: #{dashboard.totalOilChanges + 1}
              </h3>
              <p className="text-sm text-zinc-400">
                Due at{" "}
                <span className="text-white">
                  {dashboard.nextOilChangeAt} hrs
                </span>{" "}
                — Currently at{" "}
                <span className="text-white">
                  {dashboard.totalRunningHours} hrs
                </span>{" "}
                —{" "}
                <span
                  className={
                    dashboard.hoursUntilOilChange <= 10
                      ? "font-semibold text-red-400"
                      : dashboard.hoursUntilOilChange <= 20
                        ? "font-semibold text-amber-400"
                        : "text-emerald-400"
                  }
                >
                  {dashboard.hoursUntilOilChange} hrs remaining
                </span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Form */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h3 className="mb-4 text-sm font-semibold text-white">
          Log Oil Change
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                Oil Quantity (Litres)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={oilLitres}
                onChange={(e) => setOilLitres(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                Cost per Litre (₹)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={costPerLitre}
                onChange={(e) => setCostPerLitre(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {oilLitres && costPerLitre && (
            <div className="text-sm text-zinc-400">
              Total cost:{" "}
              <span className="font-semibold text-white">
                {formatPrice(
                  parseFloat(oilLitres) * parseFloat(costPerLitre)
                )}
              </span>
              {dashboard && (
                <span className="ml-4">
                  Running hours at change:{" "}
                  <span className="text-white">
                    {dashboard.totalRunningHours} hrs
                  </span>
                </span>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-6 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Droplets className="h-4 w-4" />
            )}
            Log Oil Change
          </button>
        </form>
      </div>

      {/* History */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h3 className="mb-4 text-sm font-semibold text-white">
          Oil Change History
        </h3>
        {changes.length === 0 ? (
          <p className="text-sm text-zinc-500">No oil changes logged</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="pb-2">#</th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">At Hours</th>
                  <th className="pb-2">Oil (L)</th>
                  <th className="pb-2">Rate</th>
                  <th className="pb-2">Cost</th>
                  <th className="pb-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((oc) => (
                  <tr
                    key={oc.id}
                    className="border-b border-zinc-800/50"
                  >
                    <td className="py-2 text-zinc-400">
                      #{oc.sequenceNumber}
                    </td>
                    <td className="py-2 text-zinc-300">
                      {new Date(oc.date).toLocaleDateString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}
                    </td>
                    <td className="py-2 text-zinc-300">
                      {oc.runningHoursAtChange} hrs
                    </td>
                    <td className="py-2 text-zinc-300">{oc.litres} L</td>
                    <td className="py-2 text-zinc-300">
                      {formatPrice(oc.costPerLitre / 100)}/L
                    </td>
                    <td className="py-2 text-zinc-300">
                      {formatPrice(oc.totalCost / 100)}
                    </td>
                    <td className="py-2 text-zinc-500">
                      {oc.notes || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Run Log Tab ─────────────────────────────────────────────

function RunLogTab({
  generatorId,
  dashboard,
  onUpdate,
  showMessage,
}: {
  generatorId: string;
  dashboard: GeneratorDashboardData | null;
  onUpdate: () => void;
  showMessage: (type: "success" | "error", text: string) => void;
}) {
  const [activeRunId, setActiveRunId] = useState(
    dashboard?.activeRunLog?.id || null
  );
  const [activeStart, setActiveStart] = useState(
    dashboard?.activeRunLog?.startTime
      ? new Date(dashboard.activeRunLog.startTime)
      : null
  );
  const [acting, setActing] = useState(false);

  // Manual entry
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");
  const [manualDuration, setManualDuration] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Run log history
  const [runLogList, setRunLogList] = useState<
    Array<{
      id: string;
      startTime: string;
      endTime: string | null;
      durationHours: number | null;
      notes: string | null;
    }>
  >([]);
  const [loaded, setLoaded] = useState(false);

  const loadRunLogs = async () => {
    try {
      const data = await getRunLogs(generatorId);
      // Filter out oil change alert markers
      const filtered = data.filter(
        (r) => !r.notes?.startsWith("oil_change_alert_")
      );
      setRunLogList(JSON.parse(JSON.stringify(filtered)));
      setLoaded(true);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!loaded) loadRunLogs();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = async () => {
    setActing(true);
    const result = await startRunLog(generatorId);
    if (result.success && result.id) {
      setActiveRunId(result.id);
      setActiveStart(new Date());
      showMessage("success", "Generator started");
      onUpdate();
    } else {
      showMessage("error", result.error || "Failed to start");
    }
    setActing(false);
  };

  const handleStop = async () => {
    if (!activeRunId) return;
    setActing(true);
    const result = await stopRunLog(activeRunId);
    if (result.success) {
      setActiveRunId(null);
      setActiveStart(null);
      showMessage("success", "Generator stopped");
      onUpdate();
      loadRunLogs();
    } else {
      showMessage("error", result.error || "Failed to stop");
    }
    setActing(false);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualStart) {
      showMessage("error", "Start time is required");
      return;
    }
    setSaving(true);
    const result = await addManualRunLog({
      generatorId,
      startTime: manualStart,
      endTime: manualEnd || undefined,
      durationHours: manualDuration
        ? parseFloat(manualDuration)
        : undefined,
      notes: manualNotes || undefined,
    });
    if (result.success) {
      showMessage("success", "Run log added");
      setManualStart("");
      setManualEnd("");
      setManualDuration("");
      setManualNotes("");
      onUpdate();
      loadRunLogs();
    } else {
      showMessage("error", result.error || "Failed");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* Start/Stop Timer */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h3 className="mb-4 text-sm font-semibold text-white">
          Generator Timer
        </h3>
        {activeRunId ? (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 animate-pulse rounded-full bg-emerald-500" />
              <span className="text-sm text-emerald-400">Running</span>
            </div>
            {activeStart && (
              <span className="text-sm text-zinc-400">
                Started at{" "}
                {new Date(activeStart).toLocaleTimeString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}
              </span>
            )}
            <button
              onClick={handleStop}
              disabled={acting}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {acting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              Stop
            </button>
          </div>
        ) : (
          <button
            onClick={handleStart}
            disabled={acting}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {acting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Start Generator
          </button>
        )}
      </div>

      {/* Manual entry */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h3 className="mb-4 text-sm font-semibold text-white">
          Manual Entry
        </h3>
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                Start Time
              </label>
              <input
                type="datetime-local"
                value={manualStart}
                onChange={(e) => setManualStart(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                End Time (optional)
              </label>
              <input
                type="datetime-local"
                value={manualEnd}
                onChange={(e) => setManualEnd(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">
                Duration (hrs, if no end time)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={manualDuration}
                onChange={(e) => setManualDuration(e.target.value)}
                placeholder="e.g. 2.5"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Notes</label>
              <input
                type="text"
                value={manualNotes}
                onChange={(e) => setManualNotes(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-zinc-700 px-6 py-2 text-sm font-medium text-white hover:bg-zinc-600 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add Manual Entry
          </button>
        </form>
      </div>

      {/* History */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h3 className="mb-4 text-sm font-semibold text-white">
          Run Log History
        </h3>
        {runLogList.length === 0 ? (
          <p className="text-sm text-zinc-500">No run logs recorded</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="pb-2 pr-3">ID</th>
                  <th className="pb-2 pr-3">Source</th>
                  <th className="pb-2 pr-3">Start</th>
                  <th className="pb-2 pr-3">End</th>
                  <th className="pb-2 pr-3">Duration</th>
                  <th className="pb-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {runLogList.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-zinc-800/50"
                  >
                    <td className="py-2 pr-3 font-mono text-zinc-400">
                      {log.entryId ?? "-"}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                          log.source === "hardware"
                            ? "bg-blue-500/10 text-blue-400"
                            : "bg-emerald-500/10 text-emerald-400"
                        }`}
                      >
                        {log.source === "hardware" ? "Device" : "Web"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-zinc-300">
                      {new Date(log.startTime).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="py-2 pr-3 text-zinc-300">
                      {log.endTime
                        ? new Date(log.endTime).toLocaleString("en-IN", {
                            timeZone: "Asia/Kolkata",
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "Running..."}
                    </td>
                    <td className="py-2 pr-3 text-zinc-300">
                      {log.durationHours
                        ? `${log.durationHours} hrs`
                        : "-"}
                    </td>
                    <td className="py-2 text-zinc-500">
                      {log.notes || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Configuration Tab ───────────────────────────────────────

function ConfigTab({
  config,
  generators,
  onSave,
  showMessage,
}: {
  config: ConfigData;
  generators: GeneratorItem[];
  onSave: (c: ConfigData) => void;
  showMessage: (type: "success" | "error", text: string) => void;
}) {
  const [form, setForm] = useState({
    petrolPricePerLitre: String(config.petrolPricePerLitre / 100),
    oilPricePerLitre: String(config.oilPricePerLitre / 100),
    consumptionRate: String(config.consumptionRate),
    firstOilChangeHours: String(config.firstOilChangeHours),
    secondOilChangeHours: String(config.secondOilChangeHours),
    regularOilChangeHours: String(config.regularOilChangeHours),
    oilChangeAlertHours: String(config.oilChangeAlertHours),
    notificationEmails: config.notificationEmails,
    oilChangeTemplateId: config.oilChangeTemplateId,
    monthlyTemplateId: config.monthlyTemplateId,
    pinChangeTemplateId: config.pinChangeTemplateId,
    generatorPin: config.generatorPin,
    hardwareApiKey: config.hardwareApiKey,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    // Validate PIN is 6 digits
    if (!/^\d{6}$/.test(form.generatorPin)) {
      showMessage("error", "PIN must be exactly 6 digits");
      return;
    }
    setSaving(true);
    const pinChanged = form.generatorPin !== config.generatorPin;
    const data = {
      petrolPricePerLitre: Math.round(parseFloat(form.petrolPricePerLitre) * 100),
      oilPricePerLitre: Math.round(parseFloat(form.oilPricePerLitre) * 100),
      consumptionRate: parseFloat(form.consumptionRate),
      firstOilChangeHours: parseInt(form.firstOilChangeHours),
      secondOilChangeHours: parseInt(form.secondOilChangeHours),
      regularOilChangeHours: parseInt(form.regularOilChangeHours),
      oilChangeAlertHours: parseInt(form.oilChangeAlertHours),
      notificationEmails: form.notificationEmails,
      oilChangeTemplateId: form.oilChangeTemplateId,
      monthlyTemplateId: form.monthlyTemplateId,
      pinChangeTemplateId: form.pinChangeTemplateId,
      generatorPin: form.generatorPin,
      hardwareApiKey: form.hardwareApiKey,
      pinChanged,
    };
    const result = await updateGeneratorConfig(data);
    if (result.success) {
      onSave({
        ...config,
        ...data,
      });
      showMessage("success", pinChanged ? "Configuration saved — PIN change email sent" : "Configuration saved");
    } else {
      showMessage("error", result.error || "Failed to save");
    }
    setSaving(false);
  };

  const field = (
    label: string,
    key: keyof typeof form,
    type: string = "text",
    hint?: string
  ) => (
    <div>
      <label className="mb-1 block text-xs text-zinc-400">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
      />
      {hint && <p className="mt-1 text-xs text-zinc-600">{hint}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h3 className="mb-6 text-sm font-semibold text-white">
          Generator Configuration
        </h3>

        <div className="space-y-6">
          {/* Pricing */}
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Pricing
            </h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {field("Petrol Price per Litre (₹)", "petrolPricePerLitre", "number", "Default price for fuel logs")}
              {field("Oil Price per Litre (₹)", "oilPricePerLitre", "number", "Default price for oil changes")}
              {field("Consumption Rate (L/hr)", "consumptionRate", "number", "Litres consumed per running hour")}
            </div>
          </div>

          {/* Oil change schedule */}
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Oil Change Schedule
            </h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {field("First Oil Change (hrs)", "firstOilChangeHours", "number", "Hours until first oil change")}
              {field("Second Interval (hrs)", "secondOilChangeHours", "number", "Additional hours after first")}
              {field("Regular Interval (hrs)", "regularOilChangeHours", "number", "Repeating interval after second")}
            </div>
            <div className="mt-3 rounded-lg bg-zinc-800/50 p-3 text-xs text-zinc-400">
              Schedule preview: 1st at {form.firstOilChangeHours} hrs, 2nd at{" "}
              {parseInt(form.firstOilChangeHours) +
                parseInt(form.secondOilChangeHours)}{" "}
              hrs, then every {form.regularOilChangeHours} hrs (
              {parseInt(form.firstOilChangeHours) +
                parseInt(form.secondOilChangeHours) +
                parseInt(form.regularOilChangeHours)}
              ,{" "}
              {parseInt(form.firstOilChangeHours) +
                parseInt(form.secondOilChangeHours) +
                2 * parseInt(form.regularOilChangeHours)}
              , ...)
            </div>
          </div>

          {/* Alerts */}
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Alerts
            </h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field("Alert Threshold (hrs before oil change)", "oilChangeAlertHours", "number")}
            </div>
          </div>

          {/* Notification */}
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Notifications
            </h4>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-zinc-400">
                  Notification Emails (comma-separated)
                </label>
                <textarea
                  value={form.notificationEmails}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      notificationEmails: e.target.value,
                    }))
                  }
                  rows={2}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {field("Oil Change Template ID", "oilChangeTemplateId")}
                {field("Monthly Summary Template ID", "monthlyTemplateId")}
                {field("PIN Change Template ID", "pinChangeTemplateId")}
              </div>
            </div>
          </div>

          {/* Mobile Access PIN */}
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Mobile Access PIN
            </h4>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">
                    6-Digit PIN
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={form.generatorPin}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setForm((prev) => ({ ...prev, generatorPin: val }));
                    }}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-mono tracking-widest text-white focus:border-emerald-500 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-zinc-600">
                    Required to access mobile Start/Stop and Fuel Log pages
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">
                    Mobile URLs
                  </label>
                  <div className="space-y-1.5">
                    {generators.map((g) => (
                      <div key={g.id} className="text-xs text-zinc-500 font-mono break-all">
                        <span className="text-zinc-400">{g.name}:</span>{" "}
                        /generator/run/{g.id}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {form.generatorPin !== config.generatorPin && (
                <p className="text-xs text-amber-400">
                  PIN has been changed — an email notification will be sent on save.
                </p>
              )}
            </div>
          </div>

          {/* Hardware API */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Hardware API
            </h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-zinc-400">
                  API Key (x-api-key)
                </label>
                <input
                  type="text"
                  value={form.hardwareApiKey}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, hardwareApiKey: e.target.value }))
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 font-mono text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-zinc-600">
                  Used by hardware devices to POST bulk start/stop data
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">
                  Bulk Log Endpoint
                </label>
                <div className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 font-mono text-xs text-zinc-400 break-all">
                  POST /api/generator/bulk-log
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Analytics Tab ───────────────────────────────────────────

function AnalyticsTab({
  generatorId,
  showMessage,
}: {
  generatorId: string;
  showMessage: (type: "success" | "error", text: string) => void;
}) {
  const now = new Date();
  const [from, setFrom] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split("T")[0]
  );
  const [to, setTo] = useState(
    new Date(now.getFullYear(), now.getMonth() + 1, 1)
      .toISOString()
      .split("T")[0]
  );
  const [data, setData] = useState<GeneratorAnalyticsData | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  const load = async () => {
    setLoadingData(true);
    try {
      const result = await getGeneratorAnalytics(generatorId, { from, to });
      setData(result);
    } catch {
      showMessage("error", "Failed to load analytics");
    }
    setLoadingData(false);
  };

  // Auto-load on mount
  useEffect(() => {
    if (!data && !loadingData) load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      {/* Date range */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-xs text-zinc-400">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <button
          onClick={load}
          disabled={loadingData}
          className="flex items-center gap-2 rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-600 disabled:opacity-50"
        >
          {loadingData ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <BarChart3 className="h-4 w-4" />
          )}
          Load
        </button>
      </div>

      {loadingData && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      )}

      {data && !loadingData && (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total Hours"
              value={`${data.totalHours} hrs`}
              icon={<Clock className="h-5 w-5 text-emerald-400" />}
            />
            <StatCard
              label="Total Fuel Cost"
              value={formatPrice(data.totalFuelCost / 100)}
              icon={<Fuel className="h-5 w-5 text-blue-400" />}
            />
            <StatCard
              label="Total Oil Cost"
              value={formatPrice(data.totalOilCost / 100)}
              icon={<Droplets className="h-5 w-5 text-purple-400" />}
              subtitle={`${data.oilChangesInPeriod} changes`}
            />
            <StatCard
              label="Cost per Booking Hour"
              value={
                data.costPerBookingHour > 0
                  ? formatPrice(data.costPerBookingHour / 100)
                  : "N/A"
              }
              icon={<BarChart3 className="h-5 w-5 text-amber-400" />}
              subtitle="Generator cost / booking hours"
            />
          </div>

          {/* Totals */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h3 className="mb-4 text-sm font-semibold text-white">
              Period Summary
            </h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <span className="text-xs text-zinc-500">Total Litres</span>
                <div className="text-lg font-bold text-white">
                  {data.totalLitres} L
                </div>
              </div>
              <div>
                <span className="text-xs text-zinc-500">Total Cost</span>
                <div className="text-lg font-bold text-white">
                  {formatPrice(data.totalCost / 100)}
                </div>
              </div>
              <div>
                <span className="text-xs text-zinc-500">Fuel Cost</span>
                <div className="text-lg font-bold text-blue-400">
                  {formatPrice(data.totalFuelCost / 100)}
                </div>
              </div>
              <div>
                <span className="text-xs text-zinc-500">Oil Cost</span>
                <div className="text-lg font-bold text-purple-400">
                  {formatPrice(data.totalOilCost / 100)}
                </div>
              </div>
            </div>
          </div>

          {/* Monthly breakdown */}
          {data.monthlyBreakdown.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
              <h3 className="mb-4 text-sm font-semibold text-white">
                Monthly Breakdown
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                      <th className="pb-2">Month</th>
                      <th className="pb-2">Hours</th>
                      <th className="pb-2">Litres</th>
                      <th className="pb-2">Fuel Cost</th>
                      <th className="pb-2">Oil Cost</th>
                      <th className="pb-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.monthlyBreakdown.map((m) => (
                      <tr
                        key={m.month}
                        className="border-b border-zinc-800/50"
                      >
                        <td className="py-2 text-zinc-300">{m.month}</td>
                        <td className="py-2 text-zinc-300">{m.hours} hrs</td>
                        <td className="py-2 text-zinc-300">{m.litres} L</td>
                        <td className="py-2 text-blue-400">
                          {formatPrice(m.fuelCost / 100)}
                        </td>
                        <td className="py-2 text-purple-400">
                          {formatPrice(m.oilCost / 100)}
                        </td>
                        <td className="py-2 font-semibold text-white">
                          {formatPrice(m.totalCost / 100)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
