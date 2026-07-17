"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  Crown,
  Loader2,
  MessageCircle,
  ShieldCheck,
  Ticket,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import {
  MdSportsCricket,
  MdSportsSoccer,
  MdSportsTennis,
} from "react-icons/md";
import type { IconType } from "react-icons";
import { PassClock } from "@/components/passes/pass-clock";
import { PhoneInput } from "@/components/ui/phone-input";
import { addPassMemberByPhone, removePassMember, getPassDetail } from "@/actions/passes";

type PassDetail = NonNullable<Awaited<ReturnType<typeof getPassDetail>>>;

const SPORT_ICON: Record<string, IconType> = {
  CRICKET: MdSportsCricket,
  FOOTBALL: MdSportsSoccer,
  PICKLEBALL: MdSportsTennis,
};
const SPORT_ACCENT: Record<string, string> = {
  CRICKET: "#34d399",
  FOOTBALL: "#60a5fa",
  PICKLEBALL: "#facc15",
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  UPCOMING: "Upcoming",
  EXHAUSTED: "Used up",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmtH = (m: number) => `${(m / 60).toFixed(1).replace(/\.0$/, "")}h`;
const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const maskPhone = (p: string | null) =>
  p && p.length >= 4 ? `•••• ${p.slice(-4)}` : "—";

/**
 * Pass detail: the full ticket — balance clock, every attribute, the
 * shared-member roster (owner manages; members view), and the booking
 * history the pass paid for. Members are added by registered phone;
 * an unregistered number offers a WhatsApp invite instead.
 */
export function PassDetailClient({ pass }: { pass: PassDetail }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invitePhone, setInvitePhone] = useState<string | null>(null);

  const accent = SPORT_ACCENT[pass.sport] ?? "#34d399";
  const SportIcon = SPORT_ICON[pass.sport] ?? MdSportsCricket;
  const isOwner = pass.role === "owner";
  const inactive = pass.status !== "ACTIVE" && pass.status !== "UPCOMING";
  const sharingOn = pass.maxMembers > 0;

  function addMember() {
    if (phone.length !== 10) return;
    setError(null);
    setInvitePhone(null);
    start(async () => {
      const res = await addPassMemberByPhone(pass.id, phone);
      if (!res.ok) {
        setError(res.error);
        if (res.notRegistered && res.phone) setInvitePhone(res.phone);
        return;
      }
      setPhone("");
      router.refresh();
    });
  }

  function removeMember(userId: string, name: string | null) {
    if (!window.confirm(`Remove ${name ?? "this member"} from the pass?`)) return;
    setError(null);
    start(async () => {
      await removePassMember(pass.id, userId);
      router.refresh();
    });
  }

  const waInviteLink = invitePhone
    ? `https://wa.me/${invitePhone}?text=${encodeURIComponent(
        `Hey! I want to share my Momentum Arena "${pass.name}" pass with you 🎟️. Sign up at ${
          typeof window !== "undefined" ? window.location.origin : "momentumarena.com"
        } using this number, then I'll add you and you can book with my pass hours!`,
      )}`
    : null;

  return (
    <div className="min-h-screen bg-black">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <Link
          href="/my-passes"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to My Passes
        </Link>

        {/* ── Ticket header ─────────────────────────────────────── */}
        <div
          className="mt-4 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900"
          style={{ boxShadow: inactive ? undefined : `0 0 0 1px ${accent}12` }}
        >
          <div
            className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center"
            style={{
              background: inactive
                ? undefined
                : `linear-gradient(135deg, ${accent}1f, transparent 60%)`,
            }}
          >
            <PassClock
              totalHours={pass.totalMinutes / 60}
              remainingHours={pass.remainingMinutes / 60}
              accent={accent}
              size={148}
              trigger="mount"
              replayOnInteract
              dim={inactive}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${accent}1f` }}
                >
                  <SportIcon size={22} color={inactive ? "#a1a1aa" : accent} />
                </span>
                <span
                  className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
                  style={{
                    backgroundColor: inactive ? "#27272a" : `${accent}22`,
                    color: inactive ? "#a1a1aa" : accent,
                  }}
                >
                  {STATUS_LABEL[pass.status] ?? pass.status}
                </span>
                {!isOwner && (
                  <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-sky-300">
                    Shared with you
                  </span>
                )}
              </div>
              <h1 className="mt-3 text-2xl font-bold leading-tight text-white">
                {pass.name}
              </h1>
              <p className="mt-1 text-sm text-zinc-400">
                {pass.courtLabel} ·{" "}
                <span style={{ color: inactive ? undefined : accent }}>
                  {fmtH(pass.remainingMinutes)}
                </span>{" "}
                of {fmtH(pass.totalMinutes)} left
              </p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-zinc-400">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {pass.status === "UPCOMING" ? "Starts" : "Started"}{" "}
                  {fmtDate(pass.startsAt)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" /> Expires{" "}
                  {fmtDate(pass.expiresAt)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> {pass.bandsSummary}
                </span>
                {isOwner && pass.price > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Ticket className="h-3.5 w-3.5" /> Bought for{" "}
                    {inr(pass.price)} on {fmtDate(pass.purchasedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* ── Members ───────────────────────────────────────────── */}
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-semibold text-white">
                <Users className="h-4 w-4 text-zinc-400" /> Members
              </h2>
              {sharingOn && (
                <span className="text-xs text-zinc-500">
                  {pass.members.length}/{pass.maxMembers} added
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {sharingOn
                ? isOwner
                  ? "People you add can book with this pass. Only you can manage the list."
                  : "Everyone on this pass. Only the owner can change the list."
                : "Sharing isn't enabled for this court."}
            </p>

            {/* Owner row */}
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15">
                <Crown className="h-4 w-4 text-amber-400" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {pass.owner.name ?? "Owner"}
                  {isOwner && <span className="text-zinc-500"> (you)</span>}
                </p>
                <p className="text-xs text-zinc-500">
                  Owner · {maskPhone(pass.owner.phone)}
                </p>
              </div>
            </div>

            {/* Member rows */}
            <div className="mt-2 space-y-2">
              {pass.members.map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-300">
                    {(m.name?.charAt(0) ?? "?").toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      {m.name ?? "Member"}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Added {fmtDate(m.addedAt)} · {maskPhone(m.phone)}
                    </p>
                  </div>
                  {isOwner && (
                    <button
                      onClick={() => removeMember(m.userId, m.name)}
                      disabled={pending}
                      title="Remove member"
                      className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {pass.members.length === 0 && sharingOn && (
                <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">
                  No members yet{isOwner ? " — add one below." : "."}
                </p>
              )}
            </div>

            {/* Add member (owner only, while capacity remains) */}
            {isOwner && sharingOn && pass.members.length < pass.maxMembers && (
              <div className="mt-4">
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Add a member by phone
                </label>
                <div className="flex gap-2">
                  <PhoneInput
                    value={phone}
                    onChange={setPhone}
                    placeholder="10-digit mobile"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-600 focus:outline-none"
                  />
                  <button
                    onClick={addMember}
                    disabled={pending || phone.length !== 10}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {pending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4" />
                    )}
                    Add
                  </button>
                </div>
                {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}
                {waInviteLink && (
                  <a
                    href={waInviteLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] px-3 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
                  >
                    <MessageCircle className="h-4 w-4" /> Invite them on WhatsApp
                    to sign up
                  </a>
                )}
              </div>
            )}
          </section>

          {/* ── Booking history ───────────────────────────────────── */}
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold text-white">
              <Ticket className="h-4 w-4 text-zinc-400" /> Bookings paid with
              this pass
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Every redemption — who booked, when, and the hours it used.
            </p>
            <div className="mt-4 space-y-2">
              {pass.bookings.length === 0 && (
                <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">
                  No bookings yet — hours are waiting to be played.
                </p>
              )}
              {pass.bookings.map((b) => (
                <div
                  key={b.bookingId}
                  className={`rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 ${
                    b.restored ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">
                      {fmtDate(b.date)} · {b.timeLabel}
                    </p>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                      style={{
                        backgroundColor: b.restored ? "#27272a" : `${accent}1f`,
                        color: b.restored ? "#a1a1aa" : accent,
                      }}
                    >
                      {b.restored ? "Hours returned" : `−${fmtH(b.minutes)}`}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {b.bookedBy ? `Booked by ${b.bookedBy}` : "Booked"} ·{" "}
                    {b.bookingStatus.charAt(0) +
                      b.bookingStatus.slice(1).toLowerCase()}
                    {b.value > 0 && !b.restored && ` · worth ${inr(b.value)}`}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
