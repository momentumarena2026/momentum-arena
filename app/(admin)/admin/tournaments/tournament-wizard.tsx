"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Trophy, AlertTriangle, Upload } from "lucide-react";
import { createTournament, updateTournament } from "@/actions/admin-tournaments";
// Type comes from the schema module, not the action: a "use server" file
// cannot re-export a type (see the note in actions/admin-tournaments.ts).
import type { TournamentWizardInput } from "@/lib/tournament-wizard-schema";
import { listCourtsForSport } from "@/actions/admin-tournament-fixtures";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import {
  DEFAULT_STAT_FIELDS,
  structureWarnings,
  onlinePayable,
} from "@/lib/tournament-config";
import {
  shrinkImageForUpload,
  formatBytes,
  MAX_UPLOAD_BYTES,
} from "@/lib/client-image";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-zinc-400";
const sectionCls = "rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4";

const SPORTS = [
  { value: "CRICKET", label: "Cricket" },
  { value: "FOOTBALL", label: "Football" },
  { value: "PICKLEBALL", label: "Pickleball" },
] as const;

/** The four pricing bands a pass can be restricted to. */
const PASS_BANDS = [
  { key: "wd-op", dayType: "WEEKDAY" as const, timeType: "OFF_PEAK" as const, label: "Weekday · Off-peak" },
  { key: "wd-pk", dayType: "WEEKDAY" as const, timeType: "PEAK" as const, label: "Weekday · Peak" },
  { key: "we-op", dayType: "WEEKEND" as const, timeType: "OFF_PEAK" as const, label: "Weekend · Off-peak" },
  { key: "we-pk", dayType: "WEEKEND" as const, timeType: "PEAK" as const, label: "Weekend · Peak" },
];

const TIEBREAKER_LABELS: Record<string, string> = {
  NRR: "Net run rate",
  H2H: "Head-to-head",
  SCORE_DIFF: "Score difference",
  SCORE_FOR: "Scores for",
  NAME: "Team name (A–Z)",
};

export type WizardInitial = TournamentWizardInput & { id?: string };

type Tiebreaker = TournamentWizardInput["tiebreakers"][number];

const BASE_TIEBREAKERS: Tiebreaker[] = ["H2H", "SCORE_DIFF", "SCORE_FOR"];

/**
 * What a Momentum cricket tournament looks like unless the organiser
 * says otherwise: ten overs a side, eight wickets.
 *
 * These are defaults for NEW tournaments, not a migration — an existing
 * tournament keeps whatever it was saved with.
 *
 * Zero overs used to be the default, and zero means "unlimited", which
 * reads as a harmless blank until you notice what depends on it: with no
 * over quota there is nothing to charge a side that gets bowled out, so
 * the Net Run Rate rule that separates teams level on points silently
 * cannot apply. A field nobody thinks to fill in shouldn't be able to
 * quietly disable a tiebreaker.
 */
const CRICKET_DEFAULTS = { oversPerInnings: 10, wicketsPerInnings: 8 } as const;

/**
 * Keep the visible chain honest.
 *
 * The standings engine ranks cricket on net run rate before anything else
 * (see standingsConfig), whatever this list says. Showing a cricket
 * tournament a chain without NRR would tell the organiser the table is
 * ordered one way while it is actually ordered another — so NRR is added
 * here too, and stays reorderable like every other key. Switching away
 * from cricket drops it again, since no other sport has a run rate.
 */
function tiebreakersForSport(sport: string, current: Tiebreaker[]): Tiebreaker[] {
  const withoutNrr = current.filter((k) => k !== "NRR");
  if (sport !== "CRICKET") return withoutNrr;
  return current.includes("NRR") ? current : ["NRR", ...withoutNrr];
}

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
    ...CRICKET_DEFAULTS,
    bracketSeeding: "POOL_ORDER",
    host: "VENUE",
    organizerName: "",
    organizerPhone: "",
    organizerEmail: "",
    quotedAmount: 0,
    organizerNote: "",
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
    tiebreakers: ["NRR", ...BASE_TIEBREAKERS],
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
    initial
      ? {
          ...initial,
          tiebreakers: tiebreakersForSport(initial.sport, initial.tiebreakers),
        }
      : defaultWizardState()
  );
  const [saving, setSaving] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  // Separate from the form-level `error`, which renders ~550 lines below at
  // the submit button. A banner failure shown down there is off-screen, which
  // is why a failed upload read as "the spinner stopped and nothing happened".
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Courts for the prize-pass picker — reloaded when the sport changes.
  const [courts, setCourts] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    let live = true;
    listCourtsForSport(form.sport)
      .then((c) => live && setCourts(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [form.sport]);

  const set = <K extends keyof TournamentWizardInput>(k: K, v: TournamentWizardInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const uploadBanner = async (file: File) => {
    setUploadingBanner(true);
    setBannerError(null);
    try {
      // Shrink before sending. Vercel rejects a request body over ~4.5MB at
      // the edge, before the route runs, and a phone photo clears that
      // easily — so this removes the failure rather than reporting it.
      const toSend = await shrinkImageForUpload(file);
      if (toSend.size > MAX_UPLOAD_BYTES) {
        throw new Error(
          `That image is ${formatBytes(toSend.size)} and couldn't be shrunk below ` +
            `${formatBytes(MAX_UPLOAD_BYTES)}. Try a smaller one, or export it as JPEG.`,
        );
      }

      const fd = new FormData();
      fd.append("file", toSend);
      const res = await fetch("/api/admin/tournaments/banner-upload", {
        method: "POST",
        body: fd,
      });

      // Parse defensively and only after checking status. The old order
      // called res.json() first, so any non-JSON response — a platform 413,
      // an HTML 500, an auth redirect — threw "Unexpected token '<'" instead
      // of saying what went wrong.
      const raw = await res.text();
      let data: { url?: string; error?: string } = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        if (!res.ok) {
          throw new Error(
            res.status === 413
              ? "That image is too large for the server to accept."
              : `Upload failed (${res.status}). Please try again.`,
          );
        }
        throw new Error("The server sent an unexpected response.");
      }
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      if (!data.url) throw new Error("Upload succeeded but no image URL came back.");

      set("bannerImageUrl", data.url);
    } catch (e) {
      setBannerError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingBanner(false);
    }
  };

  const num = (v: string) => (v === "" ? 0 : parseInt(v.replace(/[^\d]/g, ""), 10) || 0);

  const warnings = useMemo(() => structureWarnings(form), [form]);
  const payable = onlinePayable(form.entryFee, form.feeMode, form.advancePct);
  const isThirdParty = form.host === "THIRD_PARTY";

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
              setForm((f) => ({
                ...f,
                sport,
                statFields: DEFAULT_STAT_FIELDS[sport] || [],
                tiebreakers: tiebreakersForSport(sport, f.tiebreakers),
                // Switching into cricket brings the cricket defaults with
                // it. Without this a draft started as football would
                // arrive carrying 0 overs, and 0 means unlimited — which
                // is exactly the state that disables the NRR all-out rule.
                ...(sport === "CRICKET" && !f.oversPerInnings
                  ? CRICKET_DEFAULTS
                  : {}),
              }));
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
              <label
                className={`flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 ${
                  uploadingBanner ? "cursor-wait opacity-60" : "cursor-pointer hover:bg-zinc-800"
                }`}
              >
                {uploadingBanner ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {uploadingBanner ? "Uploading…" : form.bannerImageUrl ? "Change" : "Upload"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingBanner}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Clear immediately so re-picking the SAME file refires
                    // onChange. Without this a retry after a failure looks
                    // dead, because the input's value never changed.
                    e.target.value = "";
                    if (file) uploadBanner(file);
                  }}
                />
              </label>
              {form.bannerImageUrl && !uploadingBanner && (
                <button
                  type="button"
                  onClick={() => {
                    set("bannerImageUrl", "");
                    setBannerError(null);
                  }}
                  className="text-xs text-zinc-500 hover:text-red-400"
                >
                  Remove
                </button>
              )}
            </div>
            {bannerError ? (
              <p className="mt-1.5 text-xs text-red-400">{bannerError}</p>
            ) : (
              <p className="mt-1.5 text-[11px] text-zinc-500">
                Large photos are shrunk automatically before upload. Stored as
                webp, 1920px wide.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Description (public page)</label>
            <textarea className={inputCls} rows={2} value={form.description || ""} onChange={(e) => set("description", e.target.value)} />
          </div>
          {/* Rules were a textarea labelled "markdown" — a promise
              nothing kept, since both the public page and the app
              printed the text verbatim. Now it's a real editor and
              the formatting actually reaches the reader. Existing
              plain-text rules are converted to paragraphs and bullets
              on first open; see toInitialHtml. */}
          <div className="sm:col-span-2">
            <label className={labelCls}>Rules (public page)</label>
            <RichTextEditor
              value={form.rules || ""}
              onChange={(html) => set("rules", html)}
              placeholder="6 overs per innings · Umpire's decision is final"
            />
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
          {form.sport === "CRICKET" && (
            <div>
              <label className={labelCls}>Overs / Innings</label>
              <input
                className={inputCls}
                inputMode="numeric"
                placeholder="0 = unlimited"
                value={form.oversPerInnings || ""}
                onChange={(e) => set("oversPerInnings", num(e.target.value))}
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                Overs per side. The innings closes on the last legal ball.
                Needed for Net Run Rate — an all-out side is charged this
                many overs.
              </p>
            </div>
          )}
          {form.sport === "CRICKET" && (
            <div>
              <label className={labelCls}>Wickets / Innings</label>
              <input
                className={inputCls}
                inputMode="numeric"
                placeholder="10"
                value={form.wicketsPerInnings || ""}
                onChange={(e) => set("wicketsPerInnings", num(e.target.value))}
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                When a side is all out. Ten in a full game, fewer in a
                short-format cup — 8 for a 9-a-side. This decides the
                &ldquo;won by N wickets&rdquo; margin and, with the overs
                above, the Net Run Rate of any side bowled out.
              </p>
            </div>
          )}
          {form.format === "POOLS_KNOCKOUT" && (
            <div>
              <label className={labelCls}>Bracket Seeding</label>
              <select
                className={inputCls}
                value={form.bracketSeeding}
                onChange={(e) =>
                  set("bracketSeeding", e.target.value as TournamentWizardInput["bracketSeeding"])
                }
              >
                <option value="POOL_ORDER">By pool (A1, B1, C1…)</option>
                <option value="OVERALL_RANK">By overall record (best qualifier seeds 1st)</option>
              </select>
              <p className="mt-1 text-[11px] text-zinc-500">
                Use overall record when the bracket is uneven — the best qualifier earns
                the top seed, and with it any first-round bye.
              </p>
            </div>
          )}
          {/* Who is running this. Third-party events invert the money:
              the organiser collects entry fees themselves and pays US for
              the hire, so every team-facing fee control below is
              meaningless and is hidden rather than left to confuse. */}
          <div className="sm:col-span-2">
            <label className={labelCls}>Hosted by</label>
            <select
              className={inputCls}
              value={form.host ?? "VENUE"}
              onChange={(e) => set("host", e.target.value as "VENUE" | "THIRD_PARTY")}
            >
              <option value="VENUE">Momentum Arena (we run it)</option>
              <option value="THIRD_PARTY">Third party (they hire the venue)</option>
            </select>
          </div>
          {isThirdParty ? (
            <>
              <div>
                <label className={labelCls}>Organiser name</label>
                <input className={inputCls} value={form.organizerName ?? ""} onChange={(e) => set("organizerName", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Organiser phone</label>
                <input className={inputCls} value={form.organizerPhone ?? ""} onChange={(e) => set("organizerPhone", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Organiser email</label>
                <input className={inputCls} value={form.organizerEmail ?? ""} onChange={(e) => set("organizerEmail", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Quoted amount (₹)</label>
                <input className={inputCls} inputMode="numeric" value={form.quotedAmount || ""} onChange={(e) => set("quotedAmount", num(e.target.value))} />
                <p className="mt-1 text-[11px] text-zinc-500">
                  What we quoted for the hire. Record what they actually pay — advance
                  and balance — on the Organiser &amp; Payments tab after saving.
                </p>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Internal note</label>
                <input className={inputCls} value={form.organizerNote ?? ""} onChange={(e) => set("organizerNote", e.target.value)} />
              </div>
            </>
          ) : (
          <>
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
          </>
          )}
        </div>
        {isThirdParty && (
          <p className="text-xs text-amber-400/80">
            Teams cannot register through us for a third-party event — the organiser
            handles sign-ups and entry money. The public page shows the schedule,
            fixtures and scores only.
          </p>
        )}
        {!isThirdParty && form.feeMode !== "FREE" && (
          <p className="text-xs text-zinc-500">
            Team pays <span className="text-emerald-400">₹{payable.toLocaleString("en-IN")}</span> online at registration
            {form.feeMode === "ADVANCE" && <> · ₹{(form.entryFee - payable).toLocaleString("en-IN")} at the venue</>}
          </p>
        )}
        {/* Coupons, points and the waitlist all act on a registration we
            never take for a third-party event. */}
        <div className={`flex flex-wrap gap-4 ${isThirdParty ? "hidden" : ""}`}>
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
          <div className="space-y-3">
            {form.prizes.map((p, i) => {
              const patch = (v: Partial<(typeof form.prizes)[number]>) => {
                const arr = [...form.prizes];
                arr[i] = { ...arr[i], ...v };
                set("prizes", arr);
              };
              const pass = p.pass ?? null;
              const patchPass = (v: Partial<NonNullable<typeof pass>>) =>
                pass && patch({ pass: { ...pass, ...v } });
              return (
                <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
                  <div className="flex gap-2">
                    <input className={`${inputCls} sm:max-w-[180px]`} placeholder="Place (Winner…)" value={p.place} onChange={(e) => patch({ place: e.target.value })} />
                    <input className={inputCls} placeholder="₹20,000 + Trophy" value={p.label} onChange={(e) => patch({ label: e.target.value })} />
                    <button onClick={() => set("prizes", form.prizes.filter((_, j) => j !== i))} className="shrink-0 rounded-lg border border-zinc-700 p-2 text-zinc-400 hover:bg-zinc-800">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Optional pass, minted to the winning captain on completion. */}
                  {!pass ? (
                    <button
                      onClick={() =>
                        patch({
                          pass: {
                            awardTo: i + 1,
                            courtConfigId: courts[0]?.id || "",
                            totalHours: 1,
                            validityDays: 7,
                            bands: [],
                            name: "",
                          },
                        })
                      }
                      className="flex items-center gap-1 text-xs text-emerald-400 hover:underline"
                      disabled={courts.length === 0}
                    >
                      <Plus className="h-3 w-3" />
                      {courts.length === 0 ? "No active courts for this sport" : "Attach a free pass"}
                    </button>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-emerald-300">
                          Free pass — issued automatically to this team&apos;s captain
                        </span>
                        <button onClick={() => patch({ pass: null })} className="text-xs text-zinc-500 hover:text-red-400">
                          Remove
                        </button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-4">
                        <div>
                          <label className={labelCls}>Award to</label>
                          <select className={inputCls} value={pass.awardTo} onChange={(e) => patchPass({ awardTo: parseInt(e.target.value, 10) })}>
                            {[1, 2, 3, 4].map((n) => (
                              <option key={n} value={n}>{n === 1 ? "1st place" : n === 2 ? "2nd place" : n === 3 ? "3rd place" : `${n}th place`}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>Court</label>
                          <select className={inputCls} value={pass.courtConfigId} onChange={(e) => patchPass({ courtConfigId: e.target.value })}>
                            {courts.map((c) => (
                              <option key={c.id} value={c.id}>{c.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>Hours</label>
                          <input className={inputCls} inputMode="decimal" value={pass.totalHours} onChange={(e) => patchPass({ totalHours: parseFloat(e.target.value) || 0 })} />
                        </div>
                        <div>
                          <label className={labelCls}>Valid for (days)</label>
                          <input className={inputCls} inputMode="numeric" value={pass.validityDays} onChange={(e) => patchPass({ validityDays: num(e.target.value) })} />
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>Redeemable on</label>
                        <div className="flex flex-wrap gap-2">
                          {PASS_BANDS.map((b) => {
                            const on = (pass.bands ?? []).some((x) => x.dayType === b.dayType && x.timeType === b.timeType);
                            return (
                              <button
                                key={b.key}
                                onClick={() =>
                                  patchPass({
                                    bands: on
                                      ? (pass.bands ?? []).filter((x) => !(x.dayType === b.dayType && x.timeType === b.timeType))
                                      : [...(pass.bands ?? []), { dayType: b.dayType, timeType: b.timeType }],
                                  })
                                }
                                className={`rounded-full border px-3 py-1 text-xs ${on ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"}`}
                              >
                                {b.label}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-1 text-[11px] text-zinc-500">
                          Leave all off for any slot. Pick only the weekday bands for a weekday-only pass.
                        </p>
                      </div>
                      <div>
                        <label className={labelCls}>Pass name (optional)</label>
                        <input className={inputCls} placeholder="Runner-up Pass" value={pass.name || ""} onChange={(e) => patchPass({ name: e.target.value })} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
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
