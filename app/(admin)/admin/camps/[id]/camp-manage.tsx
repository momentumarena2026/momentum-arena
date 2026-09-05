"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, UserPlus, Archive, ArchiveRestore } from "lucide-react";
import {
  saveCamp,
  setCampStatus,
  adminRegisterForCamp,
  setCampRegistrationStatus,
  recordCampPayment,
  archiveCampRegistration,
  type CampInput,
} from "@/actions/admin-camps";
import { CampForm, type CourtOption } from "../camps-client";

type Registration = {
  id: string;
  status: string;
  participantName: string;
  participantAge: number | null;
  guardianName: string | null;
  phone: string;
  email: string | null;
  notes: string | null;
  paidAmount: number;
  dueAmount: number;
  paymentMethod: string | null;
  couponCode: string | null;
  discount: number;
  pointsUsed: number;
  archivedAt: string | null;
  createdAt: string;
};

type Camp = {
  id: string;
  slug: string;
  name: string;
  sport: string | null;
  status: string;
  description: string | null;
  rules: string | null;
  bannerImageUrl: string | null;
  startDate: string;
  endDate: string;
  daysOfWeek: number[];
  startHour: number;
  endHour: number;
  regOpenAt: string | null;
  regCloseAt: string | null;
  ageMin: number | null;
  ageMax: number | null;
  coachName: string | null;
  venueNote: string | null;
  capacity: number;
  fee: number;
  registrationFee: number;
  blockSlots: boolean;
  courtConfigId: string | null;
  feeMode: string;
  advancePct: number;
  allowCoupons: boolean;
  allowRewardPoints: boolean;
  waitlistEnabled: boolean;
  registrations: Registration[];
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const REG_STYLE: Record<string, string> = {
  CONFIRMED: "text-emerald-400",
  PENDING_PAYMENT: "text-amber-400",
  WAITLISTED: "text-sky-400",
  WITHDRAWN: "text-zinc-500",
  REJECTED: "text-red-400",
};

const STATUS_FLOW: { key: Camp["status"]; label: string }[] = [
  { key: "DRAFT", label: "Draft" },
  { key: "REGISTRATIONS_OPEN", label: "Open registrations" },
  { key: "REGISTRATIONS_CLOSED", label: "Close registrations" },
  { key: "ONGOING", label: "Mark ongoing" },
  { key: "COMPLETED", label: "Mark completed" },
  { key: "CANCELLED", label: "Cancel camp" },
];

/** Turn a stored ISO instant back into the `datetime-local` / `date` shape
 *  the inputs want, in IST — the same wall-clock the admin typed. */
function toLocalInput(iso: string | null, withTime: boolean): string {
  if (!iso) return "";
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return withTime ? `${date}T${get("hour")}:${get("minute")}` : date;
}

export function CampManage({
  camp,
  courts,
}: {
  camp: Camp;
  courts: CourtOption[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"roster" | "settings">("roster");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ reasons: string[]; title: string } | null>(null);

  // Desk registration
  const [adding, setAdding] = useState(false);
  const [walkIn, setWalkIn] = useState({
    participantName: "",
    phone: "",
    guardianName: "",
    participantAge: "",
    paidAmount: String(camp.fee + camp.registrationFee),
    method: "CASH",
  });

  // Settings form seeded from the stored camp
  const [form, setForm] = useState<CampInput>({
    name: camp.name,
    sport: (camp.sport ?? null) as CampInput["sport"],
    description: camp.description ?? "",
    rules: camp.rules ?? "",
    bannerImageUrl: camp.bannerImageUrl ?? "",
    startDate: toLocalInput(camp.startDate, false),
    endDate: toLocalInput(camp.endDate, false),
    daysOfWeek: camp.daysOfWeek,
    startHour: camp.startHour,
    endHour: camp.endHour,
    regOpenAt: toLocalInput(camp.regOpenAt, true),
    regCloseAt: toLocalInput(camp.regCloseAt, true),
    ageMin: camp.ageMin,
    ageMax: camp.ageMax,
    coachName: camp.coachName ?? "",
    venueNote: camp.venueNote ?? "",
    capacity: camp.capacity,
    fee: camp.fee,
    registrationFee: camp.registrationFee,
    blockSlots: camp.blockSlots,
    courtConfigId: camp.courtConfigId,
    feeMode: camp.feeMode as CampInput["feeMode"],
    advancePct: camp.advancePct,
    allowCoupons: camp.allowCoupons,
    allowRewardPoints: camp.allowRewardPoints,
    waitlistEnabled: camp.waitlistEnabled,
  });
  const set = <K extends keyof CampInput>(k: K, v: CampInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const live = camp.registrations.filter((r) => !r.archivedAt);
  const seatsTaken = live.filter((r) =>
    ["CONFIRMED", "PENDING_PAYMENT"].includes(r.status),
  ).length;
  const collected = live.reduce((s, r) => s + r.paidAmount, 0);
  const due = live.reduce((s, r) => s + r.dueAmount, 0);

  async function run(key: string, fn: () => Promise<{ success: boolean; error?: string }>) {
    setBusy(key);
    setError(null);
    try {
      const res = await fn();
      if (!res.success) setError(res.error || "Something went wrong");
      else router.refresh();
      return res.success;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Link href="/admin/camps" className="hover:text-zinc-300">
            Camps
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-zinc-300">{camp.name}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-white">{camp.name}</h1>
          <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300">
            {camp.status.replaceAll("_", " ")}
          </span>
        </div>
        <p className="text-sm text-zinc-500">
          {camp.sport ?? "Other"} · {camp.daysOfWeek.map((d) => DAYS[d]).join(", ")} ·{" "}
          {camp.startHour}:00–{camp.endHour}:00 · Public URL: /camps/{camp.slug}
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* Status flow */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">Move to:</span>
        {STATUS_FLOW.filter((s) => s.key !== camp.status).map((s) => (
          <button
            key={s.key}
            onClick={() => run(`st-${s.key}`, () => setCampStatus(camp.id, s.key as never))}
            disabled={busy !== null}
            className={`rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-50 ${
              s.key === "CANCELLED"
                ? "border-red-500/30 text-red-400 hover:bg-red-600/10"
                : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Money + seats at a glance */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Registered", `${seatsTaken}/${camp.capacity}`],
          ["Fee", camp.fee > 0 ? inr(camp.fee) : "Free"],
          ["Collected", inr(collected)],
          ["Due at venue", inr(due)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
            <p className="text-xs text-zinc-500">{k}</p>
            <p className="mt-0.5 font-semibold text-white">{v}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-zinc-800">
        {(
          [
            ["roster", `Roster (${live.length})`],
            ["settings", "Settings"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm ${
              tab === key
                ? "border-emerald-500 text-white"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "roster" && (
        <div className="space-y-3">
          {!adding ? (
            <button
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-2 text-sm text-emerald-400 hover:bg-emerald-600/10"
            >
              <UserPlus className="h-4 w-4" /> Register at the desk
            </button>
          ) : (
            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <p className="text-sm font-medium text-white">
                Walk-in registration
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["participantName", "Participant name"],
                    ["phone", "Phone"],
                    ["guardianName", "Guardian (optional)"],
                    ["participantAge", "Age (optional)"],
                  ] as const
                ).map(([k, ph]) => (
                  <input
                    key={k}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                    placeholder={ph}
                    value={walkIn[k]}
                    onChange={(e) => setWalkIn((w) => ({ ...w, [k]: e.target.value }))}
                  />
                ))}
                <input
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  placeholder="Amount collected"
                  inputMode="numeric"
                  value={walkIn.paidAmount}
                  onChange={(e) => setWalkIn((w) => ({ ...w, paidAmount: e.target.value }))}
                />
                {camp.registrationFee > 0 ? (
                  // The prefill assumes a first registration, which is what
                  // a desk sign-up nearly always is. The server still
                  // decides on its own whether the joining fee applies, so
                  // collecting the monthly fee alone from a returning
                  // participant leaves nothing owing.
                  <p className="text-xs text-zinc-500">
                    ₹{camp.fee.toLocaleString("en-IN")} monthly + ₹
                    {camp.registrationFee.toLocaleString("en-IN")} one-time registration.
                    Charge the monthly fee alone if they have joined before.
                  </p>
                ) : null}
                <select
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  value={walkIn.method}
                  onChange={(e) => setWalkIn((w) => ({ ...w, method: e.target.value }))}
                >
                  <option value="CASH">Cash</option>
                  <option value="UPI_QR">UPI / QR</option>
                  <option value="CARD">Card</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const ok = await run("walkin", () =>
                      adminRegisterForCamp({
                        campId: camp.id,
                        participantName: walkIn.participantName,
                        phone: walkIn.phone,
                        guardianName: walkIn.guardianName || null,
                        participantAge: walkIn.participantAge
                          ? Number(walkIn.participantAge)
                          : null,
                        paidAmount: Number(walkIn.paidAmount) || 0,
                        method: walkIn.method,
                      }),
                    );
                    if (ok) {
                      setAdding(false);
                      setWalkIn({
                        participantName: "",
                        phone: "",
                        guardianName: "",
                        participantAge: "",
                        paidAmount: String(camp.fee + camp.registrationFee),
                        method: "CASH",
                      });
                    }
                  }}
                  disabled={busy !== null || !walkIn.participantName.trim() || !walkIn.phone.trim()}
                  className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  {busy === "walkin" ? "Saving…" : "Register"}
                </button>
                <button
                  onClick={() => setAdding(false)}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {camp.registrations.length === 0 && (
            <p className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-500">
              No registrations yet.
            </p>
          )}

          {camp.registrations.map((r) => (
            <div
              key={r.id}
              className={`rounded-xl border border-zinc-800 bg-zinc-900 p-4 ${
                r.archivedAt ? "opacity-60" : ""
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">
                      {r.participantName}
                    </span>
                    <span className={`text-xs ${REG_STYLE[r.status] || "text-zinc-400"}`}>
                      {r.status.replaceAll("_", " ")}
                    </span>
                    {r.archivedAt && (
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
                        Archived
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {r.phone}
                    {r.participantAge ? ` · age ${r.participantAge}` : ""}
                    {r.guardianName ? ` · guardian ${r.guardianName}` : ""}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Paid {inr(r.paidAmount)}
                    {r.dueAmount > 0 && (
                      <span className="text-amber-400"> · Due {inr(r.dueAmount)}</span>
                    )}
                    {r.paymentMethod ? ` · ${r.paymentMethod}` : ""}
                    {r.couponCode ? ` · ${r.couponCode}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {r.status !== "CONFIRMED" && !r.archivedAt && (
                    <button
                      onClick={() =>
                        run(`c-${r.id}`, () => setCampRegistrationStatus(r.id, "CONFIRMED"))
                      }
                      disabled={busy !== null}
                      className="rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-xs text-emerald-400 hover:bg-emerald-600/10 disabled:opacity-50"
                    >
                      Confirm
                    </button>
                  )}
                  {r.dueAmount > 0 && !r.archivedAt && (
                    <button
                      onClick={() =>
                        run(`p-${r.id}`, () =>
                          recordCampPayment(r.id, r.dueAmount, "CASH"),
                        )
                      }
                      disabled={busy !== null}
                      className="rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-xs text-emerald-400 hover:bg-emerald-600/10 disabled:opacity-50"
                    >
                      {busy === `p-${r.id}` ? "Saving…" : `Collect ${inr(r.dueAmount)}`}
                    </button>
                  )}
                  <button
                    onClick={() =>
                      run(`a-${r.id}`, () =>
                        archiveCampRegistration(r.id, !r.archivedAt),
                      )
                    }
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {r.archivedAt ? (
                      <>
                        <ArchiveRestore className="h-3.5 w-3.5" /> Restore
                      </>
                    ) : (
                      <>
                        <Archive className="h-3.5 w-3.5" /> Archive
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-xl border border-amber-500/40 bg-zinc-900 p-5">
            <h3 className="text-lg font-semibold text-white">{confirm.title}</h3>
            <ul className="mt-3 space-y-1.5 text-sm text-zinc-300">
              {confirm.reasons.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-amber-400">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-zinc-500">
              Held time stops NEW bookings. Anything already sold stays sold —
              those customers have to be moved by hand.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirm(null);
                  void run("save", async () => {
                    const res = await saveCamp({
                      ...form,
                      id: camp.id,
                      confirmBlocking: true,
                    });
                    return { success: res.success, error: res.error };
                  });
                }}
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/20"
              >
                Extend and hold the time
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "settings" && (
        <CampForm
          courts={courts}
          form={form}
          set={set}
          busy={busy === "save"}
          error={null}
          onCancel={() => router.push("/admin/camps")}
          onSubmit={() =>
            run("save", async () => {
              const res = await saveCamp({ ...form, id: camp.id });
              // Not a failure — a question. Extending a camp with
              // blocking on takes real inventory off sale, and the
              // person editing the form is thinking about the camp, not
              // about the booking grid. They are told the number and
              // asked once, rather than finding out from a customer.
              if (res.needsConfirm) {
                setConfirm({ reasons: res.reasons ?? [], title: res.confirmTitle ?? "Confirm" });
                return { success: true };
              }
              return { success: res.success, error: res.error };
            })
          }
          submitLabel="Save camp"
        />
      )}
    </div>
  );
}
