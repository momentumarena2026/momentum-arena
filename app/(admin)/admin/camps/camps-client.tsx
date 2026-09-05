"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { CampBannerPicker } from "./banner-picker";
import { saveCamp, type CampInput } from "@/actions/admin-camps";

type CampRow = {
  id: string;
  slug: string;
  name: string;
  sport: string | null;
  status: string;
  startDate: string;
  endDate: string;
  capacity: number;
  fee: number;
  registrationFee: number;
  blockSlots?: boolean;
  registered: number;
};

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "text-zinc-400",
  REGISTRATIONS_OPEN: "text-emerald-400",
  REGISTRATIONS_CLOSED: "text-amber-400",
  ONGOING: "text-sky-400",
  COMPLETED: "text-zinc-500",
  CANCELLED: "text-red-400",
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const istDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

/** Blank camp: a two-week weekday morning programme is the shape the
 *  venue runs most often, so it's the starting point rather than an
 *  empty form. */
function blankCamp(): CampInput {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const inTwoWeeks = new Date(today.getTime() + 14 * 86_400_000);
  return {
    name: "",
    sport: "CRICKET",
    description: "",
    rules: "",
    bannerImageUrl: "",
    startDate: iso(today),
    endDate: iso(inTwoWeeks),
    daysOfWeek: [1, 2, 3, 4, 5],
    startHour: 6,
    endHour: 8,
    regOpenAt: "",
    regCloseAt: "",
    ageMin: null,
    ageMax: null,
    coachName: "",
    venueNote: "",
    capacity: 20,
    fee: 5000,
    registrationFee: 0,
    blockSlots: false,
    courtConfigId: null,
    feeMode: "FULL",
    advancePct: 50,
    allowCoupons: true,
    allowRewardPoints: true,
    waitlistEnabled: true,
  };
}

export function CampsClient({
  camps,
  courts,
}: {
  camps: CampRow[];
  courts: CourtOption[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CampInput>(blankCamp);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CampInput>(k: K, v: CampInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await saveCamp(form);
    setBusy(false);
    if (!res.success) return setError(res.error || "Couldn't save the camp");
    setCreating(false);
    setForm(blankCamp());
    if (res.id) router.push(`/admin/camps/${res.id}`);
    else router.refresh();
  };

  return (
    <div className="space-y-4">
      {!creating && (
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-2 text-sm text-emerald-400 hover:bg-emerald-600/10"
        >
          <Plus className="h-4 w-4" /> New camp
        </button>
      )}

      {creating && (
        <CampForm
          courts={courts}
          form={form}
          set={set}
          busy={busy}
          error={error}
          onCancel={() => {
            setCreating(false);
            setError(null);
          }}
          onSubmit={submit}
          submitLabel="Create camp"
        />
      )}

      {camps.length === 0 && !creating && (
        <p className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-500">
          No camps yet. Create one to start taking registrations.
        </p>
      )}

      <div className="space-y-2">
        {camps.map((c) => (
          <Link
            key={c.id}
            href={`/admin/camps/${c.id}`}
            className="block rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">{c.name}</span>
                  <span className={`text-xs ${STATUS_STYLE[c.status] || "text-zinc-400"}`}>
                    {c.status.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {c.sport ?? "Other"} · {istDate(c.startDate)} – {istDate(c.endDate)}
                </p>
              </div>
              <div className="text-right text-xs text-zinc-400">
                <p>
                  <span className="font-medium text-white">{c.registered}</span>
                  /{c.capacity} registered
                </p>
                <p className="text-zinc-500">
                  {c.fee > 0 ? `₹${c.fee.toLocaleString("en-IN")}/mo` : "Free"}
                  {c.registrationFee > 0 ? (
                    <span className="text-zinc-500">
                      {" "}+ ₹{c.registrationFee.toLocaleString("en-IN")} joining
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Shared create/edit form — the camp detail page reuses it. */
export type CourtOption = { id: string; label: string; sport: string };

export function CampForm({
  form,
  set,
  courts,
  busy,
  error,
  onCancel,
  onSubmit,
  submitLabel,
}: {
  form: CampInput;
  /** Active courts, so the camp can name the ground it occupies. */
  courts: CourtOption[];
  set: <K extends keyof CampInput>(k: K, v: CampInput[K]) => void;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
}) {
  const field =
    "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none";
  const label = "mb-1 block text-xs font-medium text-zinc-400";

  return (
    <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Camp name</label>
          <input
            className={field}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Summer Cricket Camp"
          />
        </div>
        <div>
          <label className={label}>Sport (optional)</label>
          <select
            className={field}
            value={form.sport ?? ""}
            onChange={(e) =>
              set("sport", (e.target.value || null) as CampInput["sport"])
            }
          >
            {/* Blank first, because it is a real answer. A camp is not
                always one of the three sports the venue sells — Taekwondo
                runs on the turf and is not a Sport — and making it pick
                one would put a false label on every customer surface. */}
            <option value="">— none / other activity —</option>
            <option value="CRICKET">Cricket</option>
            <option value="FOOTBALL">Football</option>
            <option value="PICKLEBALL">Pickleball</option>
          </select>
          <p className="mt-1 text-xs text-zinc-500">
            Only used for colour and coupon targeting. What the camp occupies
            is the court below.
          </p>
        </div>
      </div>

      <div>
        <label className={label}>Description</label>
        <textarea
          className={field}
          rows={2}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What the camp covers, what to bring…"
        />
      </div>

      {/* Hero image — the customer card and detail page lead with this;
          without one they fall back to the sport's stock photo. */}
      <CampBannerPicker
        value={form.bannerImageUrl ?? ""}
        onChange={(url) => set("bannerImageUrl", url)}
        labelClass={label}
      />

      {/* Schedule */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Starts</label>
          <input
            type="date"
            className={field}
            value={form.startDate}
            onChange={(e) => set("startDate", e.target.value)}
          />
        </div>
        <div>
          <label className={label}>Ends</label>
          <input
            type="date"
            className={field}
            value={form.endDate}
            onChange={(e) => set("endDate", e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className={label}>Session days</label>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => {
            const on = form.daysOfWeek.includes(i);
            return (
              <button
                key={d}
                type="button"
                onClick={() =>
                  set(
                    "daysOfWeek",
                    on
                      ? form.daysOfWeek.filter((x) => x !== i)
                      : [...form.daysOfWeek, i].sort((a, b) => a - b),
                  )
                }
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                  on
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Session starts (hour)</label>
          <input
            type="number"
            min={0}
            max={23}
            className={field}
            value={form.startHour}
            onChange={(e) => set("startHour", Number(e.target.value))}
          />
        </div>
        <div>
          <label className={label}>Session ends (hour)</label>
          <input
            type="number"
            min={1}
            max={24}
            className={field}
            value={form.endHour}
            onChange={(e) => set("endHour", Number(e.target.value))}
          />
        </div>
      </div>

      {/* Who + money */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label}>Capacity</label>
          <input
            type="number"
            min={1}
            className={field}
            value={form.capacity}
            onChange={(e) => set("capacity", Number(e.target.value))}
          />
        </div>
        <div>
          <label className={label}>Monthly fee (₹)</label>
          <input
            type="number"
            min={0}
            className={field}
            value={form.fee}
            onChange={(e) => set("fee", Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-zinc-500">Charged every month, including renewals.</p>
        </div>
        <div>
          <label className={label}>Registration fee (₹)</label>
          <input
            type="number"
            min={0}
            className={field}
            value={form.registrationFee}
            onChange={(e) => set("registrationFee", Number(e.target.value))}
          />
          {/* Says what it DOES, not what it is. "One-time" alone leaves
              the reader working out when it stops applying. */}
          <p className="mt-1 text-xs text-zinc-500">
            {form.registrationFee > 0
              ? `First payment ₹${(form.fee + form.registrationFee).toLocaleString("en-IN")}, then ₹${form.fee.toLocaleString("en-IN")} a month.`
              : "One-time joining fee. Leave 0 for none."}
          </p>
        </div>
        <div>
          <label className={label}>Collect</label>
          <select
            className={field}
            value={form.feeMode}
            onChange={(e) => set("feeMode", e.target.value as CampInput["feeMode"])}
          >
            <option value="FULL">Full fee online</option>
            <option value="ADVANCE">Advance online</option>
            <option value="FREE">Free camp</option>
          </select>
        </div>
      </div>

      {form.feeMode === "ADVANCE" && (
        <div className="sm:w-1/3">
          <label className={label}>Advance %</label>
          <input
            type="number"
            min={1}
            max={99}
            className={field}
            value={form.advancePct}
            onChange={(e) => set("advancePct", Number(e.target.value))}
          />
          <p className="mt-1 text-[11px] text-zinc-500">
            The rest is collected at the venue.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label}>Min age</label>
          <input
            type="number"
            className={field}
            value={form.ageMin ?? ""}
            onChange={(e) =>
              set("ageMin", e.target.value === "" ? null : Number(e.target.value))
            }
            placeholder="any"
          />
        </div>
        <div>
          <label className={label}>Max age</label>
          <input
            type="number"
            className={field}
            value={form.ageMax ?? ""}
            onChange={(e) =>
              set("ageMax", e.target.value === "" ? null : Number(e.target.value))
            }
            placeholder="any"
          />
        </div>
        <div>
          <label className={label}>Coach</label>
          <input
            className={field}
            value={form.coachName}
            onChange={(e) => set("coachName", e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Registrations open</label>
          <input
            type="datetime-local"
            className={field}
            value={form.regOpenAt}
            onChange={(e) => set("regOpenAt", e.target.value)}
          />
        </div>
        <div>
          <label className={label}>Registrations close</label>
          <input
            type="datetime-local"
            className={field}
            value={form.regCloseAt}
            onChange={(e) => set("regCloseAt", e.target.value)}
          />
        </div>
      </div>
      <p className="text-[11px] text-zinc-500">
        Times are venue time (IST).
      </p>

      <div className="flex flex-wrap gap-4">
        {(
          [
            ["allowCoupons", "Allow coupons"],
            ["allowRewardPoints", "Allow reward points"],
            ["waitlistEnabled", "Waitlist when full"],
          ] as const
        ).map(([key, text]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              className="h-4 w-4 accent-emerald-500"
              checked={form[key]}
              onChange={(e) => set(key, e.target.checked)}
            />
            {text}
          </label>
        ))}
      </div>

      {/* Blocking is its own block, not a fourth checkbox in the row
          above: it is the only setting here that changes what the PUBLIC
          can book, and burying it beside "Allow coupons" would let it be
          switched on without anyone registering what it does. */}
      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <div>
          <label className={label}>Court this camp runs on</label>
          <select
            className={field}
            value={form.courtConfigId ?? ""}
            onChange={(e) => set("courtConfigId", e.target.value || null)}
          >
            <option value="">— not set —</option>
            {courts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.sport.toLowerCase()})
              </option>
            ))}
          </select>
          {/* The one that actually matters. Holding the full field also
              holds its half-courts, because availability reads a block
              through zone overlap — so this is "which ground", not
              "which listing". */}
          <p className="mt-1 text-xs text-zinc-500">
            Required to hold sessions. Holding a full field also holds its
            half-courts.
          </p>
        </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-emerald-500"
          checked={!!form.blockSlots}
          onChange={(e) => set("blockSlots", e.target.checked)}
        />
        <span className="text-sm">
          <span className="font-medium text-white">Hold the courts for this camp</span>
          <span className="mt-1 block text-xs text-zinc-500">
            Every session in the schedule above is taken off public sale —
            {" "}
            {form.daysOfWeek.length > 0
              ? `${form.daysOfWeek.length} day${form.daysOfWeek.length === 1 ? "" : "s"} a week, ${Math.max(0, form.endHour - form.startHour)} hour${form.endHour - form.startHour === 1 ? "" : "s"} each`
              : "pick the days above first"}
            . Changing the dates later re-applies it, and you'll be asked
            before any extra time is held.
          </span>
        </span>
      </label>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={busy || !form.name.trim()}
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
