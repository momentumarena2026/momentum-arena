"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Trophy, AlertTriangle, Upload } from "lucide-react";
import {
  createTournament,
  updateTournament,
  type TournamentWizardInput,
} from "@/actions/admin-tournaments";
import {
  DEFAULT_STAT_FIELDS,
  structureWarnings,
  onlinePayable,
} from "@/lib/tournament-config";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-zinc-400";
const sectionCls = "rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4";

const SPORTS = [
  { value: "CRICKET", label: "Cricket" },
  { value: "FOOTBALL", label: "Football" },
  { value: "PICKLEBALL", label: "Pickleball" },
] as const;

const TIEBREAKER_LABELS: Record<string, string> = {
  H2H: "Head-to-head",
  SCORE_DIFF: "Score difference",
  SCORE_FOR: "Scores for",
  NAME: "Team name (A–Z)",
};

export type WizardInitial = TournamentWizardInput & { id?: string };

export function defaultWizardState(): TournamentWizardInput {
  return {
    name: "",
    sport: "CRICKET",
    format: "POOLS_KNOCKOUT",
    description: "",
    rules: "",
    bannerImageUrl: "",
    totalTeams: 8,
    poolCount: 2,
    teamsPerPool: 4,
    advancePerPool: 2,
    thirdPlaceMatch: false,
    membersPerTeamMin: 1,
    membersPerTeamMax: 11,
    maxOversPerBowler: 0,
    entryFee: 2000,
    feeMode: "FULL",
    advancePct: 50,
    allowCoupons: true,
    allowRewardPoints: true,
    waitlistEnabled: true,
    regOpenAt: "",
    regCloseAt: "",
    revealAt: "",
    startDate: "",
    endDate: "",
    pointsWin: 2,
    pointsDraw: 1,
    pointsLoss: 0,
    tiebreakers: ["H2H", "SCORE_DIFF", "SCORE_FOR"],
    statFields: DEFAULT_STAT_FIELDS.CRICKET,
    prizePool: null,
    prizes: [
      { place: "Winner", label: "" },
      { place: "Runner-up", label: "" },
    ],
    liveScoringEnabled: false,
    liveScreenPlatform: "BOTH",
  };
}

export function TournamentWizard({ initial }: { initial?: WizardInitial }) {
  const router = useRouter();
  const [form, setForm] = useState<TournamentWizardInput>(
    initial ? { ...initial } : defaultWizardState()
  );
  const [saving, setSaving] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof TournamentWizardInput>(k: K, v: TournamentWizardInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const uploadBanner = async (file: File) => {
    setUploadingBanner(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/tournaments/banner-upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      set("bannerImageUrl", data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingBanner(false);
    }
  };

  const num = (v: string) => (v === "" ? 0 : parseInt(v.replace(/[^\d]/g, ""), 10) || 0);

  const warnings = useMemo(() => structureWarnings(form), [form]);
  const payable = onlinePayable(form.entryFee, form.feeMode, form.advancePct);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = initial?.id
        ? await updateTournament(initial.id, form)
        : await createTournament(form);
      if (!res.success) {
        setError(res.error || "Failed to save");
        return;
      }
      router.push(
        initial?.id ? `/admin/tournaments/${initial.id}` : `/admin/tournaments/${(res as { id?: string }).id}`
      );
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const moveTiebreaker = (i: number, dir: -1 | 1) => {
    const arr = [...form.tiebreakers];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set("tiebreakers", arr);
  };

  return (
    <div className="max-w-3xl space-y-5">
      {/* 1 · Basics */}
      <div className={sectionCls}>
        <h3 className="flex items-center gap-2 font-medium text-white">
          <Trophy className="h-4 w-4 text-emerald-400" /> 1 · Basics
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelCls}>Tournament Name *</label>
            <input className={inputCls} placeholder="Momentum Premier League 2026" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Sport *</label>
            <select className={inputCls} value={form.sport} onChange={(e) => {
              const sport = e.target.value as TournamentWizardInput["sport"];
              setForm((f) => ({ ...f, sport, statFields: DEFAULT_STAT_FIELDS[sport] || [] }));
            }}>
              {SPORTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Hero Banner Image</label>
            <div className="flex items-center gap-3">
              {form.bannerImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.bannerImageUrl} alt="" className="h-12 w-24 rounded-lg border border-zinc-700 object-cover" />
              ) : (
                <div className="flex h-12 w-24 items-center justify-center rounded-lg border border-dashed border-zinc-700 text-xs text-zinc-600">
                  none
                </div>
              )}
              <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">
                {uploadingBanner ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {form.bannerImageUrl ? "Change" : "Upload"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && uploadBanner(e.target.files[0])}
                />
              </label>
              {form.bannerImageUrl && (
                <button onClick={() => set("bannerImageUrl", "")} className="text-xs text-zinc-500 hover:text-red-400">
                  Remove
                </button>
              )}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Description (public page)</label>
            <textarea className={inputCls} rows={2} value={form.description || ""} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Rules (markdown, public page)</label>
            <textarea className={inputCls} rows={4} placeholder={"- 6 overs per innings\n- Umpire's decision is final"} value={form.rules || ""} onChange={(e) => set("rules", e.target.value)} />
          </div>
        </div>
      </div>

      {/* 2 · Format & structure */}
      <div className={sectionCls}>
        <h3 className="font-medium text-white">2 · Format &amp; Structure</h3>
        <div className="grid grid-cols-3 gap-2">
          {(["POOLS_KNOCKOUT", "LEAGUE", "KNOCKOUT"] as const).map((f) => (
            <button
              key={f}
              onClick={() => set("format", f)}
              className={`rounded-lg border p-3 text-sm ${
                form.format === f
                  ? "border-emerald-500/50 bg-emerald-600/10 text-emerald-300"
                  : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {f === "POOLS_KNOCKOUT" ? "Pools → Knockout" : f === "LEAGUE" ? "League" : "Knockout"}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label className={labelCls}>Total Teams *</label>
            <input className={inputCls} inputMode="numeric" value={form.totalTeams || ""} onChange={(e) => set("totalTeams", num(e.target.value))} />
          </div>
          {form.format === "POOLS_KNOCKOUT" && (
            <>
              <div>
                <label className={labelCls}>Pools</label>
                <input className={inputCls} inputMode="numeric" value={form.poolCount || ""} onChange={(e) => set("poolCount", num(e.target.value))} />
              </div>
              <div>
                <label className={labelCls}>Teams / Pool</label>
                <input className={inputCls} inputMode="numeric" value={form.teamsPerPool || ""} onChange={(e) => set("teamsPerPool", num(e.target.value))} />
              </div>
              <div>
                <label className={labelCls}>Advance / Pool</label>
                <input className={inputCls} inputMode="numeric" value={form.advancePerPool || ""} onChange={(e) => set("advancePerPool", num(e.target.value))} />
              </div>
            </>
          )}
        </div>
        {form.format !== "LEAGUE" && (
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={form.thirdPlaceMatch} onChange={(e) => set("thirdPlaceMatch", e.target.checked)} />
            Play a 3rd-place match
          </label>
        )}
        {warnings.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <ul className="space-y-0.5 text-xs text-zinc-300">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 3 · Teams & fees */}
      <div className={sectionCls}>
        <h3 className="font-medium text-white">3 · Teams &amp; Entry Fee</h3>
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label className={labelCls}>Min Members / Team</label>
            <input className={inputCls} inputMode="numeric" value={form.membersPerTeamMin || ""} onChange={(e) => set("membersPerTeamMin", num(e.target.value))} />
          </div>
          <div>
            <label className={labelCls}>Max Members / Team *</label>
            <input className={inputCls} inputMode="numeric" value={form.membersPerTeamMax || ""} onChange={(e) => set("membersPerTeamMax", num(e.target.value))} />
          </div>
          {form.sport === "CRICKET" && (
            <div>
              <label className={labelCls}>Max Overs / Bowler</label>
              <input
                className={inputCls}
                inputMode="numeric"
                placeholder="0 = no limit"
                value={form.maxOversPerBowler || ""}
                onChange={(e) => set("maxOversPerBowler", num(e.target.value))}
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                The scorer can&apos;t pick a bowler who has bowled this many overs.
              </p>
            </div>
          )}
          <div>
            <label className={labelCls}>Entry Fee (₹ / team)</label>
            <input className={inputCls} inputMode="numeric" disabled={form.feeMode === "FREE"} value={form.feeMode === "FREE" ? 0 : form.entryFee || ""} onChange={(e) => set("entryFee", num(e.target.value))} />
          </div>
          <div>
            <label className={labelCls}>Fee Mode</label>
            <select className={inputCls} value={form.feeMode} onChange={(e) => set("feeMode", e.target.value as TournamentWizardInput["feeMode"])}>
              <option value="FULL">Full online</option>
              <option value="ADVANCE">Advance online</option>
              <option value="FREE">Free entry</option>
            </select>
          </div>
          {form.feeMode === "ADVANCE" && (
            <div>
              <label className={labelCls}>Advance %</label>
              <input className={inputCls} inputMode="numeric" value={form.advancePct || ""} onChange={(e) => set("advancePct", num(e.target.value))} />
            </div>
          )}
        </div>
        {form.feeMode !== "FREE" && (
          <p className="text-xs text-zinc-500">
            Team pays <span className="text-emerald-400">₹{payable.toLocaleString("en-IN")}</span> online at registration
            {form.feeMode === "ADVANCE" && <> · ₹{(form.entryFee - payable).toLocaleString("en-IN")} at the venue</>}
          </p>
        )}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={form.allowCoupons} onChange={(e) => set("allowCoupons", e.target.checked)} />
            Allow coupons
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={form.allowRewardPoints} onChange={(e) => set("allowRewardPoints", e.target.checked)} />
            Allow reward points
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={form.waitlistEnabled} onChange={(e) => set("waitlistEnabled", e.target.checked)} />
            Waitlist when full
          </label>
        </div>
      </div>

      {/* 4 · Timeline */}
      <div className={sectionCls}>
        <h3 className="font-medium text-white">4 · Timeline</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {(
            [
              ["regOpenAt", "Registrations Open"],
              ["regCloseAt", "Registrations Close"],
              ["revealAt", "Pool Reveal (countdown)"],
              ["startDate", "Tournament Starts"],
              ["endDate", "Tournament Ends"],
            ] as const
          ).map(([key, label]) =>
            key === "revealAt" && form.format !== "POOLS_KNOCKOUT" ? null : (
              <div key={key}>
                <label className={labelCls}>{label}</label>
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={form[key] || ""}
                  onChange={(e) => set(key, e.target.value)}
                />
              </div>
            )
          )}
        </div>
      </div>

      {/* 5 · Points & stats */}
      <div className={sectionCls}>
        <h3 className="font-medium text-white">5 · Points Table &amp; Player Stats</h3>
        <div className="grid grid-cols-3 gap-4">
          {(
            [
              ["pointsWin", "Points / Win"],
              ["pointsDraw", "Points / Draw"],
              ["pointsLoss", "Points / Loss"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label className={labelCls}>{label}</label>
              <input className={inputCls} inputMode="numeric" value={String(form[key])} onChange={(e) => set(key, num(e.target.value))} />
            </div>
          ))}
        </div>
        <div>
          <label className={labelCls}>Tiebreaker order (top applies first)</label>
          <div className="space-y-1.5">
            {form.tiebreakers.map((tb, i) => (
              <div key={tb} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-800/40 px-3 py-2 text-sm text-zinc-200">
                <span className="w-5 text-zinc-500">{i + 1}.</span>
                <span className="flex-1">{TIEBREAKER_LABELS[tb]}</span>
                <button onClick={() => moveTiebreaker(i, -1)} disabled={i === 0} className="px-1.5 text-zinc-400 disabled:opacity-30">↑</button>
                <button onClick={() => moveTiebreaker(i, 1)} disabled={i === form.tiebreakers.length - 1} className="px-1.5 text-zinc-400 disabled:opacity-30">↓</button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className={labelCls}>Player stat fields (leaderboards)</label>
            <button
              onClick={() => set("statFields", [...form.statFields, { key: "", label: "" }])}
              className="flex items-center gap-1 text-xs text-emerald-400 hover:underline"
            >
              <Plus className="h-3 w-3" /> Add stat
            </button>
          </div>
          <div className="space-y-2">
            {form.statFields.map((sf, i) => (
              <div key={i} className="flex gap-2">
                <input className={inputCls} placeholder="key (e.g. runs)" value={sf.key} onChange={(e) => {
                  const arr = [...form.statFields];
                  arr[i] = { ...arr[i], key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") };
                  set("statFields", arr);
                }} />
                <input className={inputCls} placeholder="Label (e.g. Runs)" value={sf.label} onChange={(e) => {
                  const arr = [...form.statFields];
                  arr[i] = { ...arr[i], label: e.target.value };
                  set("statFields", arr);
                }} />
                <button onClick={() => set("statFields", form.statFields.filter((_, j) => j !== i))} className="shrink-0 rounded-lg border border-zinc-700 p-2 text-zinc-400 hover:bg-zinc-800">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {form.statFields.length === 0 && <p className="text-xs text-zinc-500">No player stats tracked for this tournament.</p>}
          </div>
        </div>
      </div>

      {/* 6 · Prizes */}
      <div className={sectionCls}>
        <h3 className="font-medium text-white">6 · Prizes</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Total Prize Pool (₹, display)</label>
            <input className={inputCls} inputMode="numeric" value={form.prizePool ?? ""} onChange={(e) => set("prizePool", e.target.value === "" ? null : num(e.target.value))} />
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className={labelCls}>Prize breakdown</label>
            <button onClick={() => set("prizes", [...form.prizes, { place: "", label: "" }])} className="flex items-center gap-1 text-xs text-emerald-400 hover:underline">
              <Plus className="h-3 w-3" /> Add prize
            </button>
          </div>
          <div className="space-y-2">
            {form.prizes.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input className={`${inputCls} sm:max-w-[180px]`} placeholder="Place (Winner…)" value={p.place} onChange={(e) => {
                  const arr = [...form.prizes];
                  arr[i] = { ...arr[i], place: e.target.value };
                  set("prizes", arr);
                }} />
                <input className={inputCls} placeholder="₹20,000 + Trophy" value={p.label} onChange={(e) => {
                  const arr = [...form.prizes];
                  arr[i] = { ...arr[i], label: e.target.value };
                  set("prizes", arr);
                }} />
                <button onClick={() => set("prizes", form.prizes.filter((_, j) => j !== i))} className="shrink-0 rounded-lg border border-zinc-700 p-2 text-zinc-400 hover:bg-zinc-800">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 7 · Live scoring */}
      <div className={sectionCls}>
        <h3 className="font-medium text-white">7 · Live Scoring</h3>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={form.liveScoringEnabled} onChange={(e) => set("liveScoringEnabled", e.target.checked)} />
          Enable live scoring for this tournament
          <span className="text-xs text-zinc-500">
            ({form.sport === "CRICKET" ? "ball-by-ball" : form.sport === "FOOTBALL" ? "goal-by-goal + match clock" : "point-by-point"})
          </span>
        </label>
        {form.liveScoringEnabled && (
          <div>
            <label className={labelCls}>Audience live screen available on</label>
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  ["BOTH", "App + Web"],
                  ["APP_ONLY", "App only"],
                  ["WEB_ONLY", "Web only"],
                  ["OFF", "Hidden"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => set("liveScreenPlatform", v)}
                  className={`rounded-lg border p-2.5 text-xs ${
                    form.liveScreenPlatform === v
                      ? "border-emerald-500/50 bg-emerald-600/10 text-emerald-300"
                      : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {form.liveScreenPlatform === "APP_ONLY" && (
              <p className="mt-2 text-xs text-zinc-500">
                Web visitors will see a &quot;Watch live on the app&quot; screen with store download buttons.
              </p>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={handleSave}
        disabled={saving || !form.name.trim()}
        className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-5 py-3 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
        {initial?.id ? "Save Changes" : "Create Tournament (as Draft)"}
      </button>
    </div>
  );
}
