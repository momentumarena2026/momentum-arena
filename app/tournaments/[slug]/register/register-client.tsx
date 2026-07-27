"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Upload, Ticket, PartyPopper, QrCode, CreditCard, Coins } from "lucide-react";
import { onlinePayable } from "@/lib/tournament-config";
import { validateCoupon } from "@/actions/coupon-validation";

// window.Razorpay's global type is declared once app-wide (see the booking
// checkout client) — redeclaring it here would conflict.

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#71717a"];

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-zinc-400";

type Props = {
  dqrAvailable: boolean;
  tournament: {
    id: string;
    slug: string;
    name: string;
    sport: string;
    entryFee: number;
    feeMode: "FULL" | "ADVANCE" | "FREE";
    advancePct: number;
    allowCoupons: boolean;
    membersPerTeamMin: number;
    membersPerTeamMax: number;
    confirmedCount: number;
    totalTeams: number;
  };
  prefill: { captainName: string; captainPhone: string; captainEmail: string };
};

export function RegisterClient({ tournament: t, prefill, dqrAvailable }: Props) {
  const router = useRouter();
  const [teamName, setTeamName] = useState("");
  const [color, setColor] = useState(COLORS[4]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [members, setMembers] = useState<string[]>(
    Array.from({ length: Math.max(t.membersPerTeamMin, 2) }, () => "")
  );
  const [captainName, setCaptainName] = useState(prefill.captainName);
  const [captainPhone, setCaptainPhone] = useState(prefill.captainPhone);
  const [coupon, setCoupon] = useState("");
  const [couponApplied, setCouponApplied] = useState<{ code: string; discount: number } | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [method, setMethod] = useState<"upi" | "razorpay">(dqrAvailable ? "upi" : "razorpay");
  const [pointsPreview, setPointsPreview] = useState<{ maxPoints: number; maxPaise: number } | null>(null);
  const [usePoints, setUsePoints] = useState(false);
  const [dqr, setDqr] = useState<null | { qrImage?: string; qrString?: string; transactionId: string; amount: number; expiresIn: number }>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { state: string }>(null);

  const filledMembers = members.map((m) => m.trim()).filter(Boolean);
  const discount = couponApplied?.discount || 0;
  const netFeeAfterCoupon = Math.max(0, t.entryFee - discount);
  const pointsDiscount =
    usePoints && pointsPreview
      ? Math.min(netFeeAfterCoupon, Math.round(pointsPreview.maxPaise / 100))
      : 0;
  const pointsToRedeem = usePoints && pointsPreview ? pointsPreview.maxPoints : 0;
  const netFee = Math.max(0, netFeeAfterCoupon - pointsDiscount);
  const payable = onlinePayable(netFee, t.feeMode, t.advancePct);
  const dueAtVenue = netFee - payable;
  const isFull = t.confirmedCount >= t.totalTeams;

  // Points preview follows the after-coupon amount.
  useEffect(() => {
    let alive = true;
    if (t.feeMode === "FREE" || netFeeAfterCoupon <= 0) {
      setPointsPreview(null);
      return;
    }
    fetch(`/api/tournaments/rewards-preview?amount=${netFeeAfterCoupon}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setPointsPreview({ maxPoints: d.maxPoints || 0, maxPaise: d.maxPaise || 0 });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [netFeeAfterCoupon, t.feeMode]);

  // DQR status poll while the QR is showing.
  useEffect(() => {
    if (!dqr) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`/api/phonepe/dqr/tournament-status?transactionId=${dqr.transactionId}`);
        const d = await r.json();
        if (d.state === "COMPLETED") {
          clearInterval(iv);
          setDqr(null);
          setDone({ state: "CONFIRMED" });
          router.refresh();
        } else if (d.state === "FAILED") {
          clearInterval(iv);
          setDqr(null);
          setSubmitting(false);
          setError(d.error || "Payment failed — please try again");
        }
      } catch {
        /* transient */
      }
    }, 3500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dqr?.transactionId]);

  const canSubmit = useMemo(
    () =>
      teamName.trim().length >= 2 &&
      filledMembers.length >= t.membersPerTeamMin &&
      filledMembers.length <= t.membersPerTeamMax &&
      captainName.trim() &&
      captainPhone.replace(/\D/g, "").length >= 10,
    [teamName, filledMembers.length, captainName, captainPhone, t.membersPerTeamMin, t.membersPerTeamMax]
  );

  const uploadLogo = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/tournaments/logo-upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setLogoUrl(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const applyCoupon = async () => {
    if (!coupon.trim()) return;
    setCouponBusy(true);
    setError(null);
    try {
      const res = await validateCoupon(coupon, {
        scope: "SPORTS",
        amount: t.entryFee,
        sport: t.sport,
        platform: "web",
      });
      if (!res.valid) {
        setCouponApplied(null);
        setError(res.error || "Invalid coupon");
        return;
      }
      setCouponApplied({ code: coupon.toUpperCase().trim(), discount: Math.min(res.discountAmount || 0, t.entryFee) });
    } finally {
      setCouponBusy(false);
    }
  };

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/tournaments/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tournamentId: t.id,
          teamName,
          color,
          logoUrl,
          members: filledMembers,
          captainName,
          captainPhone,
          couponCode: couponApplied?.code || null,
          pointsToRedeem: pointsToRedeem || null,
          platform: "web",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");

      if (data.state !== "PENDING_PAYMENT") {
        setDone({ state: data.state });
        router.refresh();
        return;
      }

      // UPI (PhonePe DQR): show the QR and poll for completion.
      if (method === "upi") {
        const dq = await fetch("/api/phonepe/dqr/tournament-initiate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId: data.teamId }),
        });
        const dqd = await dq.json();
        if (!dq.ok) throw new Error(dqd.error || "Couldn't start the UPI payment");
        setDqr({
          qrImage: dqd.qrImage,
          qrString: dqd.qrString,
          transactionId: dqd.transactionId,
          amount: dqd.amount,
          expiresIn: dqd.expiresIn,
        });
        return; // the poll effect completes the flow
      }

      // Pay the entry fee via Razorpay.
      if (!(await loadRazorpayScript())) throw new Error("Couldn't load the payment window");
      const rzp = new window.Razorpay({
        key: data.keyId,
        amount: Math.round(data.order.amount * 100),
        currency: "INR",
        name: "Momentum Arena",
        description: `${t.name} — entry fee`,
        order_id: data.order.orderId,
        theme: { color: "#10b981" },
        prefill: { name: captainName, contact: captainPhone },
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const v = await fetch("/api/tournaments/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpayOrderId: resp.razorpay_order_id,
                razorpayPaymentId: resp.razorpay_payment_id,
                razorpaySignature: resp.razorpay_signature,
              }),
            });
            const vd = await v.json();
            if (!v.ok) throw new Error(vd.error || "Payment confirmation failed");
            setDone({ state: "CONFIRMED" });
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Payment confirmation failed");
          } finally {
            setSubmitting(false);
          }
        },
        modal: { ondismiss: () => setSubmitting(false) },
      });
      rzp.open();
      return; // handler continues the flow
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setSubmitting(false);
    }
  };

  if (dqr) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center">
        <h1 className="text-xl font-bold text-white">Scan to pay ₹{dqr.amount.toLocaleString("en-IN")}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {t.name} — entry fee. Use any UPI app; this screen confirms automatically.
        </p>
        {dqr.qrImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dqr.qrImage} alt="UPI QR" className="mx-auto mt-6 w-64 rounded-2xl bg-white p-3" />
        ) : (
          <p className="mt-6 break-all rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-xs text-zinc-400">{dqr.qrString}</p>
        )}
        <p className="mt-4 flex items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-500" /> Waiting for payment…
        </p>
        <button
          onClick={() => {
            setDqr(null);
            setSubmitting(false);
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
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <PartyPopper className="mx-auto h-14 w-14 text-emerald-400" />
        <h1 className="mt-4 text-2xl font-bold text-white">
          {done.state === "WAITLISTED" ? "You're on the waitlist!" : "Team registered! 🎉"}
        </h1>
        <p className="mt-2 text-zinc-400">
          {done.state === "WAITLISTED"
            ? "The tournament is full right now — we'll notify you the moment a spot opens up."
            : `${teamName} is in. Watch for the pool reveal and your fixtures!`}
        </p>
        {dueAtVenue > 0 && done.state !== "WAITLISTED" && (
          <p className="mt-2 text-sm text-amber-400">
            ₹{dueAtVenue.toLocaleString("en-IN")} is payable at the venue before your first match.
          </p>
        )}
        <button
          onClick={() => router.push(`/tournaments/${t.slug}`)}
          className="mt-6 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          Back to the tournament
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold text-white">Register — {t.name}</h1>
      {isFull && (
        <p className="mt-2 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-300">
          The tournament is currently full — you&apos;ll be added to the waitlist (no payment now).
        </p>
      )}

      <div className="mt-6 space-y-5">
        {/* Team identity */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <h3 className="font-medium text-white">Team Identity</h3>
          <div>
            <label className={labelCls}>Team Name *</label>
            <input className={inputCls} placeholder="Mathura Strikers" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className={labelCls}>Team Colour</label>
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`h-7 w-7 rounded-full border-2 ${color === c ? "border-white" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>Logo (optional)</label>
              <div className="flex items-center gap-2">
                <span
                  className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: color }}
                >
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="" className="h-11 w-11 object-cover" />
                  ) : (
                    (teamName.trim().slice(0, 2) || "?").toUpperCase()
                  )}
                </span>
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {logoUrl ? "Change" : "Upload"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Squad */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-white">
              Squad{" "}
              <span className="text-sm font-normal text-zinc-500">
                ({filledMembers.length}/{t.membersPerTeamMax} · min {t.membersPerTeamMin})
              </span>
            </h3>
            {members.length < t.membersPerTeamMax && (
              <button onClick={() => setMembers((m) => [...m, ""])} className="flex items-center gap-1 text-xs text-emerald-400 hover:underline">
                <Plus className="h-3 w-3" /> Add player
              </button>
            )}
          </div>
          <p className="text-xs text-zinc-500">Player 1 is the captain.</p>
          <div className="space-y-2">
            {members.map((m, i) => (
              <div key={i} className="flex gap-2">
                <span className="flex w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-xs text-zinc-500">
                  {i + 1}
                </span>
                <input
                  className={inputCls}
                  placeholder={i === 0 ? "Captain's playing name" : `Player ${i + 1}`}
                  value={m}
                  onChange={(e) => setMembers((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
                />
                {members.length > 1 && (
                  <button onClick={() => setMembers((arr) => arr.filter((_, j) => j !== i))} className="shrink-0 rounded-lg border border-zinc-700 p-2 text-zinc-500 hover:bg-zinc-800">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Captain contact */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <h3 className="font-medium text-white">Captain Contact</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Name *</label>
              <input className={inputCls} value={captainName} onChange={(e) => setCaptainName(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Phone *</label>
              <input className={inputCls} inputMode="tel" value={captainPhone} onChange={(e) => setCaptainPhone(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Fee summary */}
        {t.feeMode !== "FREE" && !isFull && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
            <h3 className="font-medium text-white">Entry Fee</h3>
            {t.allowCoupons && (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Ticket className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    className={`${inputCls} pl-9 uppercase`}
                    placeholder="Coupon code"
                    value={coupon}
                    onChange={(e) => {
                      setCoupon(e.target.value);
                      setCouponApplied(null);
                    }}
                  />
                </div>
                <button
                  onClick={applyCoupon}
                  disabled={couponBusy || !coupon.trim()}
                  className="shrink-0 rounded-lg border border-emerald-500/30 px-4 text-sm text-emerald-400 hover:bg-emerald-600/10 disabled:opacity-40"
                >
                  {couponBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : couponApplied ? "Applied ✓" : "Apply"}
                </button>
              </div>
            )}
            {pointsPreview && pointsPreview.maxPoints > 0 && (
              <label className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-zinc-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-amber-500"
                  checked={usePoints}
                  onChange={(e) => setUsePoints(e.target.checked)}
                />
                <Coins className="h-4 w-4 text-amber-400" />
                Use {pointsPreview.maxPoints.toLocaleString("en-IN")} points (−₹
                {Math.round(pointsPreview.maxPaise / 100).toLocaleString("en-IN")})
              </label>
            )}
            {dqrAvailable && payable > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMethod("upi")}
                  className={`flex items-center justify-center gap-2 rounded-lg border p-2.5 text-sm ${method === "upi" ? "border-emerald-500/50 bg-emerald-600/10 text-emerald-300" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
                >
                  <QrCode className="h-4 w-4" /> UPI
                </button>
                <button
                  onClick={() => setMethod("razorpay")}
                  className={`flex items-center justify-center gap-2 rounded-lg border p-2.5 text-sm ${method === "razorpay" ? "border-emerald-500/50 bg-emerald-600/10 text-emerald-300" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
                >
                  <CreditCard className="h-4 w-4" /> Card / Netbanking
                </button>
              </div>
            )}
            <div className="space-y-1.5 border-t border-zinc-800 pt-3 text-sm">
              <div className="flex justify-between text-zinc-400">
                <span>Entry fee</span>
                <span>₹{t.entryFee.toLocaleString("en-IN")}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Coupon {couponApplied?.code}</span>
                  <span>− ₹{discount.toLocaleString("en-IN")}</span>
                </div>
              )}
              {pointsDiscount > 0 && (
                <div className="flex justify-between text-amber-400">
                  <span>Reward points</span>
                  <span>− ₹{pointsDiscount.toLocaleString("en-IN")}</span>
                </div>
              )}
              {dueAtVenue > 0 && (
                <div className="flex justify-between text-zinc-400">
                  <span>Payable at venue</span>
                  <span>₹{dueAtVenue.toLocaleString("en-IN")}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-semibold text-white">
                <span>Pay now</span>
                <span>₹{payable.toLocaleString("en-IN")}</span>
              </div>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={submit}
          disabled={!canSubmit || submitting || uploading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isFull
            ? "Join the waitlist"
            : payable > 0
              ? `Pay ₹${payable.toLocaleString("en-IN")} & Register`
              : "Register Team"}
        </button>
      </div>
    </div>
  );
}
