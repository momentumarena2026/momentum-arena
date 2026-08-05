"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { sportTheme } from "@/lib/sport-theme";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Clock,
  Users,
  IndianRupee,
  UserRound,
  Check,
  Loader2,
  QrCode,
  CreditCard,
} from "lucide-react";
import {
  trackCampView,
  trackCampRegisterStarted,
  trackCampRegisterCompleted,
} from "@/lib/analytics";

type Camp = {
  id: string;
  slug: string;
  name: string;
  sport: string;
  bannerImageUrl?: string | null;
  status: string;
  description: string | null;
  rules: string | null;
  startDate: string;
  endDate: string;
  daysOfWeek: number[];
  startHour: number;
  endHour: number;
  ageMin: number | null;
  ageMax: number | null;
  coachName: string | null;
  venueNote: string | null;
  capacity: number;
  fee: number;
  feeMode: string;
  advancePct: number;
  allowCoupons: boolean;
  waitlistEnabled: boolean;
  seatsTaken: number;
  seatsLeft: number;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const istDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

const hour = (h: number) => {
  const am = h < 12 || h === 24;
  const v = h % 12 === 0 ? 12 : h % 12;
  return `${v}${am ? "am" : "pm"}`;
};

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

/**
 * Camp detail + registration.
 *
 * The server prices the registration and creates the Razorpay order —
 * this form never states an amount, it only shows what the server quoted.
 */
export function CampRegisterClient({
  camp,
  signedIn,
  prefill,
  dqrAvailable,
}: {
  camp: Camp;
  signedIn: boolean;
  prefill: { name: string; phone: string; email: string };
  dqrAvailable: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    participantName: prefill.name,
    participantAge: "",
    guardianName: "",
    phone: prefill.phone,
    email: prefill.email,
    notes: "",
    couponCode: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ waitlisted: boolean } | null>(null);
  // Same two-way choice the booking, pass and tournament funnels offer.
  // UPI leads when the venue has PhonePe DQR switched on.
  const [method, setMethod] = useState<"upi" | "razorpay">(
    dqrAvailable ? "upi" : "razorpay",
  );
  const [dqr, setDqr] = useState<null | {
    qrImage?: string;
    qrString?: string;
    transactionId: string;
    amount: number;
  }>(null);

  // Funnel: hub → detail → register. Fires once per camp.
  useEffect(() => {
    trackCampView(camp.slug);
  }, [camp.slug]);

  // Poll while the QR is on screen. The S2S callback also confirms, so a
  // payer who closes the tab still gets their seat — this only drives
  // what *this* screen shows.
  useEffect(() => {
    if (!dqr) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(
          `/api/phonepe/dqr/camp-status?transactionId=${dqr.transactionId}`,
        );
        const d = await r.json();
        if (d.state === "COMPLETED") {
          clearInterval(iv);
          trackCampRegisterCompleted(camp.slug, "CONFIRMED", "upi");
          setDqr(null);
          setDone({ waitlisted: false });
          router.refresh();
        } else if (d.state === "FAILED") {
          clearInterval(iv);
          setDqr(null);
          setBusy(false);
          setError(d.error || "Payment failed — please try again");
        }
      } catch {
        /* transient — the next tick retries */
      }
    }, 3500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dqr]);

  const open = camp.status === "REGISTRATIONS_OPEN";
  const full = camp.seatsLeft <= 0;
  const payNow =
    camp.feeMode === "FREE" || camp.fee === 0
      ? 0
      : camp.feeMode === "ADVANCE"
        ? Math.max(1, Math.round((camp.fee * camp.advancePct) / 100))
        : camp.fee;
  const atVenue = Math.max(0, camp.fee - payNow);

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    trackCampRegisterStarted(camp.slug, camp.fee);
    try {
      const res = await fetch("/api/camps/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campId: camp.id, ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't register");

      // Free camp or waitlisted — nothing to pay.
      if (!data.payableNow) {
        trackCampRegisterCompleted(
          camp.slug,
          data.waitlisted ? "WAITLISTED" : "CONFIRMED",
          "none",
        );
        setDone({ waitlisted: !!data.waitlisted });
        router.refresh();
        return;
      }

      // UPI (PhonePe DQR): show the QR; the poll effect finishes the job.
      if (method === "upi") {
        const dq = await fetch("/api/phonepe/dqr/camp-initiate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ registrationId: data.registrationId }),
        });
        const dqd = await dq.json();
        if (!dq.ok) throw new Error(dqd.error || "Couldn't start the UPI payment");
        setDqr({
          qrImage: dqd.qrImage,
          qrString: dqd.qrString,
          transactionId: dqd.transactionId,
          amount: dqd.amount,
        });
        return;
      }

      if (!(await loadRazorpay())) {
        throw new Error("Couldn't load the payment window");
      }
      const rzp = new window.Razorpay({
        key: data.keyId,
        amount: Math.round(data.payableNow * 100),
        currency: "INR",
        name: "Momentum Arena",
        description: data.campName,
        order_id: data.orderId,
        theme: { color: "#10b981" },
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          const v = await fetch("/api/camps/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpayOrderId: resp.razorpay_order_id,
              razorpayPaymentId: resp.razorpay_payment_id,
              razorpaySignature: resp.razorpay_signature,
            }),
          });
          const vd = await v.json().catch(() => ({}));
          if (v.ok) {
            trackCampRegisterCompleted(camp.slug, "CONFIRMED", "razorpay");
            setDone({ waitlisted: false });
            router.refresh();
          } else {
            setError(
              vd.error ||
                "Payment received — we'll confirm your spot shortly.",
            );
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  if (dqr) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center">
        <h1 className="text-xl font-bold text-white">
          Scan to pay {inr(dqr.amount)}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          {camp.name}. Pay from any UPI app — this screen confirms on its own.
        </p>
        {dqr.qrImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dqr.qrImage}
            alt="UPI QR"
            className="mx-auto mt-6 w-64 rounded-2xl bg-white p-3"
          />
        ) : (
          <p className="mt-6 break-all rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-xs text-zinc-400">
            {dqr.qrString}
          </p>
        )}
        <p className="mt-4 flex items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-500" /> Waiting
          for payment…
        </p>
        <button
          onClick={() => {
            setDqr(null);
            setBusy(false);
          }}
          className="mt-6 text-sm text-zinc-400 underline"
        >
          Cancel and choose another method
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
          <Check className="h-7 w-7 text-emerald-400" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-white">
          {done.waitlisted ? "You're on the waitlist" : "You're registered! 🎉"}
        </h1>
        <p className="mt-2 text-zinc-400">
          {done.waitlisted
            ? "The camp is full right now — we'll be in touch the moment a spot opens."
            : `See you at ${camp.name}.`}
          {!done.waitlisted && atVenue > 0 && (
            <>
              {" "}
              <span className="text-amber-400">
                {inr(atVenue)} is payable at the venue.
              </span>
            </>
          )}
        </p>
        <Link
          href="/camps"
          className="mt-6 inline-block rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Back to camps
        </Link>
      </div>
    );
  }

  const theme = sportTheme(camp.sport);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/camps" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← Camps
      </Link>

      {/* Hero — the admin's uploaded image, else the sport's stock photo.
          Same treatment as the camps list card so the two read as one
          journey rather than two designs. */}
      <div className="relative mt-4 h-44 w-full overflow-hidden rounded-2xl border border-zinc-800 sm:h-56">
        {/* eslint-disable-next-line @next/next/no-img-element -- blob URL, no loader config */}
        <img
          src={camp.bannerImageUrl || theme.image}
          alt=""
          className="h-full w-full object-cover"
        />
        <div className={`absolute inset-0 bg-gradient-to-t ${theme.gradient}`} />
        <div className="absolute inset-x-0 bottom-0 p-5">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${theme.chip}`}
          >
            {theme.emoji} {theme.label}
          </span>
          <h1 className="mt-1.5 text-2xl font-bold text-white drop-shadow-sm sm:text-3xl">
            {camp.name}
          </h1>
        </div>
      </div>
      {camp.description && (
        <p className="mt-4 text-zinc-400">{camp.description}</p>
      )}

      <dl className="mt-6 grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 sm:grid-cols-2">
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          <CalendarDays className="h-4 w-4 text-zinc-500" />
          {istDate(camp.startDate)} – {istDate(camp.endDate)}
        </div>
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          <Clock className="h-4 w-4 text-zinc-500" />
          {camp.daysOfWeek.map((d) => DAYS[d]).join(", ")} ·{" "}
          {hour(camp.startHour)}–{hour(camp.endHour)}
        </div>
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          <Users className="h-4 w-4 text-zinc-500" />
          {camp.seatsLeft > 0
            ? `${camp.seatsLeft} of ${camp.capacity} spots left`
            : "Full"}
        </div>
        {camp.coachName && (
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <UserRound className="h-4 w-4 text-zinc-500" />
            Coach {camp.coachName}
          </div>
        )}
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400 sm:col-span-2">
          <IndianRupee className="h-4 w-4" />
          {camp.fee > 0 ? inr(camp.fee) : "Free"}
          {payNow > 0 && payNow < camp.fee && (
            <span className="text-xs font-normal text-zinc-400">
              — {inr(payNow)} to book, {inr(atVenue)} at the venue
            </span>
          )}
        </div>
      </dl>

      {camp.rules && (
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-sm font-semibold text-white">Good to know</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-zinc-400">
            {camp.rules}
          </p>
        </div>
      )}

      {/* Registration */}
      <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-lg font-bold text-white">
          {full && camp.waitlistEnabled ? "Join the waitlist" : "Register"}
        </h2>

        {!open ? (
          <p className="mt-2 text-sm text-zinc-400">
            Registrations are closed for this camp.
          </p>
        ) : full && !camp.waitlistEnabled ? (
          <p className="mt-2 text-sm text-zinc-400">
            This camp is full.
          </p>
        ) : !signedIn ? (
          <div className="mt-3">
            <p className="text-sm text-zinc-400">
              Sign in to register — it keeps your spot linked to your account.
            </p>
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(`/camps/${camp.slug}`)}`}
              className="mt-3 inline-block rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                placeholder="Participant name *"
                value={form.participantName}
                onChange={(e) => set("participantName", e.target.value)}
              />
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                placeholder="Phone *"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                placeholder="Age"
                inputMode="numeric"
                value={form.participantAge}
                onChange={(e) => set("participantAge", e.target.value)}
              />
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                placeholder="Guardian name (for minors)"
                value={form.guardianName}
                onChange={(e) => set("guardianName", e.target.value)}
              />
            </div>
            {camp.allowCoupons && camp.fee > 0 && (
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm uppercase text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                placeholder="Coupon code (optional)"
                value={form.couponCode}
                onChange={(e) => set("couponCode", e.target.value)}
              />
            )}
            {dqrAvailable && payNow > 0 && !full && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-zinc-500">
                  Pay with
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMethod("upi")}
                    className={`flex items-center justify-center gap-2 rounded-lg border p-2.5 text-sm ${method === "upi" ? "border-emerald-500/50 bg-emerald-600/10 text-emerald-300" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
                  >
                    <QrCode className="h-4 w-4" /> UPI
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethod("razorpay")}
                    className={`flex items-center justify-center gap-2 rounded-lg border p-2.5 text-sm ${method === "razorpay" ? "border-emerald-500/50 bg-emerald-600/10 text-emerald-300" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
                  >
                    <CreditCard className="h-4 w-4" /> Card / Netbanking
                  </button>
                </div>
              </div>
            )}
            <button
              onClick={submit}
              disabled={busy || !form.participantName.trim() || !form.phone.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {full
                ? "Join waitlist"
                : payNow > 0
                  ? `Pay ${inr(payNow)} & register`
                  : "Register"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
