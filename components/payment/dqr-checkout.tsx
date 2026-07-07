"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ChevronRight,
  Download,
  Loader2,
  QrCode,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { formatPrice } from "@/lib/pricing";
import { trackUpiAppLaunched } from "@/lib/analytics";

interface DqrCheckoutProps {
  holdId: string;
  amount: number;
  /** Full net payable (post coupon + points) sent to the booking initiate
   *  route as `overrideAmount`; the route halves it for the advance flow.
   *  Without this the route falls back to the gross hold total and the
   *  customer's discount/points are silently dropped. Booking surface only. */
  overrideAmount?: number;
  isAdvance?: boolean;
  advanceAmount?: number;
  remainingAmount?: number;
  /** "booking" hits /api/phonepe/dqr/*, "cafe" hits the cafe-* variants. */
  surface?: "booking" | "cafe";
  /** For cafe: the CafePaymentIntent id passed as `holdId`-equivalent. */
  onConfirmed: (id: string) => void;
  onCancel?: () => void;
}

type Phase = "init" | "apps" | "qr" | "waiting" | "confirmed" | "error";

const POLL_MS = 3000;

/** Poll + TTL countdown stay live while the customer can still pay. */
const LIVE_PHASES: Phase[] = ["apps", "qr", "waiting"];

/** Success screen: ~750ms of animation (pop + stroke draw + text fade),
 *  then hold ~1.4s before handing off to onConfirmed. */
const CONFIRM_HOLD_MS = 2200;

/**
 * Crude UA sniff — `upi://` deep links do nothing on desktop browsers (no
 * UPI app to hand off to), so the app-picker list is mobile-only. Runs
 * client-side only; SSR returns false so hydration matches.
 */
function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

const SHEET_KEYFRAMES = `
@keyframes dqr-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes dqr-sheet-up { from { transform: translateY(100%) } to { transform: translateY(0) } }
@keyframes dqr-sheet-pop { from { opacity: 0; transform: translateY(8px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
@keyframes dqr-check-pop { 0% { transform: scale(0) } 70% { transform: scale(1.08) } 100% { transform: scale(1) } }
@keyframes dqr-check-draw { to { stroke-dashoffset: 0 } }
.dqr-sheet { animation: dqr-sheet-up 250ms ease-out; }
@media (min-width: 640px) { .dqr-sheet { animation: dqr-sheet-pop 200ms ease-out; } }
`;

/**
 * Dynamic-QR checkout, rendered as a Razorpay-style bottom sheet (dark
 * zinc/emerald theme, matching the site) that overlays the checkout page. Generates a PhonePe DQR for this
 * hold/intent and polls the status endpoint until PhonePe confirms — at
 * which point the booking/order is auto-created server-side. No "I've paid"
 * trust step and no manual UTR/screenshot-to-us: confirmation is
 * gateway-driven.
 *
 * Two modes, decided server-side by the admin "UPI Intent" toggle (the
 * initiate response echoes it as `mode`):
 * - "qr" (default): scan-only string. The sheet shows the QR; same-phone
 *   users save it and use their UPI app's "scan from gallery"; desktop
 *   users scan with their phone.
 * - "intent": the string is a TAPPABLE upi:// Open Intent link — on mobile
 *   browsers the sheet opens on an app picker (PhonePe / GPay / Paytm /
 *   BHIM / scan QR / other) that deep-links into the chosen app with the
 *   amount pre-filled. Requires PhonePe to have enabled intent acceptance
 *   on the merchant VPA (done 2026-07-02). Desktop still gets the QR.
 */
export function DqrCheckout({
  holdId,
  amount,
  overrideAmount,
  isAdvance,
  advanceAmount,
  remainingAmount,
  surface = "booking",
  onConfirmed,
  onCancel,
}: DqrCheckoutProps) {
  const [phase, setPhase] = useState<Phase>("init");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [payString, setPayString] = useState<string | null>(null);
  const [mode, setMode] = useState<"qr" | "intent">("qr");
  const [isMobile, setIsMobile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [launchedApp, setLaunchedApp] = useState<{
    name: string;
    link: string;
  } | null>(null);
  // "Pay with UPI ID" (collect request) + app search state.
  const [query, setQuery] = useState("");
  const [vpa, setVpa] = useState("");
  const [vpaError, setVpaError] = useState<string | null>(null);
  const [vpaSending, setVpaSending] = useState(false);
  const [collectVpa, setCollectVpa] = useState<string | null>(null);
  const txnRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);
  // Settled booking/order id, parked here when the poll flips so the
  // success animation can play out before onConfirmed navigates away.
  const settledIdRef = useRef<string | null>(null);

  const displayAmount = isAdvance && advanceAmount ? advanceAmount : amount;
  const initiateUrl =
    surface === "cafe"
      ? "/api/phonepe/dqr/cafe-initiate"
      : "/api/phonepe/dqr/initiate";
  const statusBase =
    surface === "cafe"
      ? "/api/phonepe/dqr/cafe-status"
      : "/api/phonepe/dqr/status";

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const checkStatus = useCallback(async () => {
    const txn = txnRef.current;
    if (!txn || doneRef.current) return;
    try {
      const res = await fetch(
        `${statusBase}?transactionId=${encodeURIComponent(txn)}`,
      );
      const data = await res.json();
      const settledId = surface === "cafe" ? data.orderId : data.bookingId;
      if (data.state === "COMPLETED" && settledId) {
        doneRef.current = true;
        stopPolling();
        // Don't fire onConfirmed yet — park the id and let the success
        // animation play; the confirmed-phase effect below hands off.
        settledIdRef.current = settledId;
        setPhase("confirmed");
      } else if (data.state === "FAILED") {
        doneRef.current = true;
        stopPolling();
        setError("Payment failed or expired. Please try again.");
        setPhase("error");
      }
    } catch {
      // Transient — keep polling; the S2S callback is the backstop.
    }
  }, [statusBase, surface, stopPolling]);

  const initiate = useCallback(async () => {
    // No synchronous setState here — this runs from the mount effect.
    doneRef.current = false;
    try {
      const res = await fetch(initiateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          surface === "cafe"
            ? { orderId: holdId }
            : { holdId, isAdvance: !!isAdvance, overrideAmount },
        ),
      });
      const data = await res.json();
      if (!res.ok || !data.qrImage) {
        setError(data.error || "Couldn't start UPI payment");
        setPhase("error");
        return;
      }
      txnRef.current = data.transactionId;
      setQrDataUrl(data.qrImage);
      const qrString = typeof data.qrString === "string" ? data.qrString : null;
      setPayString(qrString);
      setMode(data.mode === "intent" ? "intent" : "qr");
      setSecondsLeft(typeof data.expiresIn === "number" ? data.expiresIn : null);
      setLaunchedApp(null);
      // Intent mode on a mobile browser opens on the app picker; scan-only
      // mode (or any desktop browser) goes straight to the QR. Sniff the UA
      // directly — the isMobile state closure here is stale (mount-time).
      setPhase(
        data.mode === "intent" && qrString && isMobileBrowser()
          ? "apps"
          : "qr",
      );
    } catch {
      setError("Couldn't start UPI payment");
      setPhase("error");
    }
  }, [initiateUrl, surface, holdId, isAdvance, overrideAmount]);

  // Kick off on mount. `initiate` only setStates AFTER its network await.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    initiate();
    return stopPolling;
  }, [initiate, stopPolling]);

  // Resolve the UA sniff after mount so SSR markup (isMobile=false) and the
  // hydrated client agree on first paint, then update.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMobile(isMobileBrowser());
  }, []);

  // Start polling once the customer can pay (app list, QR, or app handoff).
  useEffect(() => {
    if (!LIVE_PHASES.includes(phase)) return;
    pollRef.current = setInterval(checkStatus, POLL_MS);
    return stopPolling;
  }, [phase, checkStatus, stopPolling]);

  // QR expiry countdown — PhonePe rejects an expired QR. When the TTL runs
  // out, stop polling and prompt a regenerate (the error retry re-initiates).
  useEffect(() => {
    if (!LIVE_PHASES.includes(phase) || secondsLeft == null) return;
    if (secondsLeft <= 0) {
      doneRef.current = true;
      stopPolling();
      setError("This QR has expired. Generate a new one to continue.");
      setPhase("error");
      return;
    }
    const id = setTimeout(
      () => setSecondsLeft((s) => (s == null ? s : s - 1)),
      1000,
    );
    return () => clearTimeout(id);
  }, [phase, secondsLeft, stopPolling]);

  // Success handoff: let the tick animation land, hold a beat, then hand
  // the settled id to the parent (which navigates to the confirmation).
  // onConfirmed goes through a ref and the effect depends ONLY on `phase`:
  // with onConfirmed (an inline arrow in the callers) in the deps, any
  // parent re-render during the hold window would clear + restart this
  // timeout — if the parent re-renders faster than CONFIRM_HOLD_MS (e.g. a
  // ticking countdown), the handoff NEVER fires and the sheet hangs on the
  // success screen. That exact hang shipped on mobile; guard both surfaces.
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;
  const firedRef = useRef(false);
  useEffect(() => {
    if (phase !== "confirmed") return;
    const id = setTimeout(() => {
      if (!firedRef.current && settledIdRef.current) {
        firedRef.current = true;
        onConfirmedRef.current(settledIdRef.current);
      }
    }, CONFIRM_HOLD_MS);
    return () => clearTimeout(id);
  }, [phase]);

  const launchApp = useCallback(
    (name: string, link: string) => {
      trackUpiAppLaunched(displayAmount);
      setLaunchedApp({ name, link });
      setPhase("waiting");
      window.location.href = link;
    },
    [displayAmount],
  );

  const countdown =
    secondsLeft != null
      ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`
      : null;

  // upi://pay?<query> — the query carries payee + amount; each app-specific
  // scheme reuses it verbatim so the chosen app opens pre-filled.
  const q = payString ? (payString.split("?")[1] ?? "") : "";
  const appsAvailable = mode === "intent" && !!payString && isMobile;

  const tileBase =
    "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg";
  // Uniform white tiles so the jpg's white background and the webp
  // transparency render identically against the dark sheet.
  const appTile = (src: string, alt: string) => (
    <span className={`${tileBase} bg-white`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="h-7 w-7 object-contain" />
    </span>
  );
  // Most-popular first — mirrors apps/mobile DqrCheckout's UPI_APPS. PNG
  // icons extracted from public/upi/UPI_icons.jpeg (webp doesn't render in
  // the RN app, so both surfaces standardise on the PNG set). `suggested`
  // apps fill the tile grid; everything renders in the All Apps list.
  const allApps: { key: string; name: string; link: string; suggested?: boolean }[] = [
    { key: "phonepe", name: "PhonePe", link: `phonepe://pay?${q}`, suggested: true },
    { key: "gpay", name: "Google Pay", link: `tez://upi/pay?${q}`, suggested: true },
    { key: "paytm", name: "Paytm", link: `paytmmp://pay?${q}`, suggested: true },
    { key: "bhim", name: "BHIM", link: `bhim://upi/pay?${q}`, suggested: true },
    { key: "amazonpay", name: "Amazon Pay", link: `amzn://upi/pay?${q}`, suggested: true },
    { key: "cred", name: "CRED", link: `credpay://upi/pay?${q}`, suggested: true },
    { key: "mobikwik", name: "MobiKwik", link: `mobikwik://upi/pay?${q}`, suggested: true },
    { key: "whatsapp", name: "WhatsApp Pay", link: `whatsapp://upi/pay?${q}`, suggested: true },
    { key: "navi", name: "Navi", link: `navipay://upi/pay?${q}`, suggested: true },
    { key: "sbi", name: "SBI (YONO)", link: `yono://upi/pay?${q}` },
    { key: "icici", name: "ICICI iMobile", link: `imobile://upi/pay?${q}` },
    { key: "hdfc", name: "HDFC PayZapp", link: `payzapp://upi/pay?${q}` },
    { key: "axis", name: "Axis Bank", link: `axispay://upi/pay?${q}` },
    { key: "kotak", name: "Kotak Bank", link: `kmb://upi/pay?${q}` },
    { key: "pnb", name: "PNB", link: `pnbupi://upi/pay?${q}` },
    { key: "airtel", name: "Airtel Payments Bank", link: `myairtel://upi/pay?${q}` },
    { key: "jupiter", name: "Jupiter", link: `jupiter://upi/pay?${q}` },
    { key: "fi", name: "Fi Money", link: `fi://upi/pay?${q}` },
    { key: "fampay", name: "FamApp", link: `in.fampay.app://upi/pay?${q}` },
    { key: "jiopay", name: "JioPay", link: `myjio://upi/pay?${q}` },
    { key: "tataneu", name: "Tata Neu", link: `tnupi://upi/pay?${q}` },
  ];
  const suggestedApps = allApps.filter((a) => a.suggested);
  const filteredApps = query.trim()
    ? allApps.filter((a) =>
        a.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : null;

  // Two tiles per row, Razorpay-style: [icon] [name] inside a bordered card.
  const tileBtnClass =
    "flex min-h-[56px] items-center gap-2.5 rounded-xl border border-zinc-800 px-3 py-2 text-left transition-colors hover:bg-zinc-800/60 active:bg-zinc-800";
  const rowClass =
    "flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-zinc-800/60 active:bg-zinc-800";

  const submitCollect = async () => {
    const cleanVpa = vpa.trim().toLowerCase();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,}@[a-zA-Z]{2,}$/.test(cleanVpa)) {
      setVpaError("Enter a valid UPI ID (e.g. name@bank)");
      return;
    }
    setVpaError(null);
    setVpaSending(true);
    try {
      const res = await fetch(
        surface === "cafe"
          ? "/api/phonepe/dqr/cafe-collect"
          : "/api/phonepe/dqr/collect",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            surface === "cafe"
              ? { orderId: holdId, vpa: cleanVpa }
              : { holdId, vpa: cleanVpa, isAdvance: !!isAdvance, overrideAmount },
          ),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.transactionId) {
        setVpaError(data.error || "Couldn't send the payment request");
        return;
      }
      // The collect request is a NEW PhonePe transaction — point the
      // status poll (and TTL) at it; approval confirms like any DQR pay.
      txnRef.current = data.transactionId;
      doneRef.current = false;
      if (typeof data.expiresIn === "number") setSecondsLeft(data.expiresIn);
      setLaunchedApp(null);
      setCollectVpa(cleanVpa);
      setPhase("waiting");
    } catch {
      setVpaError("Couldn't send the payment request — try again");
    } finally {
      setVpaSending(false);
    }
  };

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    // Payment already went through — don't let a stray tap cancel out of
    // the success screen; onConfirmed is about to navigate.
    if (e.target === e.currentTarget && phase !== "confirmed") onCancel?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      style={{ animation: "dqr-fade-in 200ms ease-out" }}
      onClick={handleBackdropClick}
    >
      <style>{SHEET_KEYFRAMES}</style>
      <div className="dqr-sheet max-h-[85vh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-[400px] sm:rounded-2xl">
        {/* Header — merchant + amount, Razorpay style */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon.png"
              alt="Momentum Arena"
              className="h-8 w-8 shrink-0 rounded-md"
            />
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-tight text-white">
                Momentum Arena
              </p>
              <p className="text-xs text-zinc-400">UPI payment</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[15px] font-semibold text-white">
              {formatPrice(displayAmount)}
            </span>
            {phase !== "confirmed" && onCancel && (
              <button
                onClick={onCancel}
                aria-label="Close"
                className="rounded-full p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {isAdvance && advanceAmount != null && (
          <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-300">
            Advance {formatPrice(advanceAmount)} · Remaining at venue{" "}
            {formatPrice(
              remainingAmount ?? Math.max(0, amount - advanceAmount),
            )}
          </div>
        )}

        {phase === "init" && (
          <div className="flex flex-col items-center gap-3 px-6 py-14">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
            <p className="text-sm text-zinc-400">Setting up UPI payment…</p>
          </div>
        )}

        {phase === "apps" && (
          <div className="pb-4">
            {/* Search */}
            <div className="px-4 pt-3">
              <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
                <Search className="h-4 w-4 shrink-0 text-zinc-500" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search UPI apps"
                  className="w-full bg-transparent text-[14px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                />
              </div>
            </div>

            {filteredApps ? (
              /* Search results — single-column rows across ALL apps */
              <div className="mt-2 divide-y divide-zinc-800/70">
                {filteredApps.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-zinc-500">
                    No UPI app matches &ldquo;{query.trim()}&rdquo;
                  </p>
                )}
                {filteredApps.map((app) => (
                  <button
                    key={app.key}
                    onClick={() => launchApp(app.name, app.link)}
                    className={rowClass}
                  >
                    {appTile(`/upi/${app.key}.png`, app.name)}
                    <span className="flex-1 text-[14px] font-medium text-zinc-100">
                      {app.name}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />
                  </button>
                ))}
              </div>
            ) : (
              <>
                {/* Suggested apps — two tiles per row + Scan QR */}
                <p className="px-4 pb-1 pt-4 text-[12px] font-medium uppercase tracking-wider text-zinc-500">
                  Suggested apps
                </p>
                <div className="grid grid-cols-2 gap-2.5 px-4 pt-1">
                  {suggestedApps.map((app) => (
                    <button
                      key={app.key}
                      onClick={() => launchApp(app.name, app.link)}
                      className={tileBtnClass}
                    >
                      {appTile(`/upi/${app.key}.png`, app.name)}
                      <span className="min-w-0 flex-1 text-[13.5px] font-medium leading-tight text-zinc-100">
                        {app.name}
                      </span>
                    </button>
                  ))}
                  <button onClick={() => setPhase("qr")} className={tileBtnClass}>
                    <span className={`${tileBase} bg-zinc-800`}>
                      <QrCode className="h-5 w-5 text-zinc-300" />
                    </span>
                    <span className="min-w-0 flex-1 text-[13.5px] font-medium leading-tight text-zinc-100">
                      Scan QR code
                    </span>
                  </button>
                </div>

                {/* Pay with UPI ID (collect request) */}
                <p className="px-4 pb-1 pt-5 text-[12px] font-medium uppercase tracking-wider text-zinc-500">
                  Pay with UPI ID / Number
                </p>
                <div className="px-4">
                  <div className="rounded-xl border border-zinc-800 p-3">
                    <input
                      type="text"
                      value={vpa}
                      onChange={(e) => {
                        setVpa(e.target.value);
                        if (vpaError) setVpaError(null);
                      }}
                      placeholder="example@okhdfcbank"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2.5 text-[14px] text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
                    />
                    {vpaError && (
                      <p className="mt-1.5 text-xs text-red-400">{vpaError}</p>
                    )}
                    <button
                      onClick={submitCollect}
                      disabled={vpaSending || !vpa.trim()}
                      className="mt-2.5 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {vpaSending ? "Sending request…" : "Verify and Pay"}
                    </button>
                    <p className="mt-2 text-[11px] leading-snug text-zinc-500">
                      You&apos;ll get a payment request in your UPI app —
                      approve it to complete the booking.
                    </p>
                  </div>
                </div>

                {/* All apps */}
                <p className="px-4 pb-1 pt-5 text-[12px] font-medium uppercase tracking-wider text-zinc-500">
                  All apps
                </p>
                <div className="divide-y divide-zinc-800/70">
                  {allApps.map((app) => (
                    <button
                      key={app.key}
                      onClick={() => launchApp(app.name, app.link)}
                      className={rowClass}
                    >
                      {appTile(`/upi/${app.key}.png`, app.name)}
                      <span className="flex-1 text-[14px] font-medium text-zinc-100">
                        {app.name}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {phase === "qr" && (
          <div className="flex flex-col items-center px-5 py-6">
            {qrDataUrl ? (
              // QR stays on a white card so scanners read it against the
              // dark sheet.
              <div className="rounded-xl bg-white p-3">
                {/* Plain <img> on a ready data URL so it decodes immediately
                    — iOS Safari skips next/image lazy-load. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt="UPI QR — scan to pay"
                  width={240}
                  height={240}
                  className="rounded-lg"
                />
              </div>
            ) : (
              <div className="flex h-[240px] w-[240px] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
              </div>
            )}

            <p className="mt-4 text-2xl font-bold text-emerald-400">
              Pay {formatPrice(displayAmount)}
            </p>
            <p className="mt-2 flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for
              payment…
            </p>
            {countdown && (
              <p className="mt-1 text-xs text-zinc-500">
                Expires in {countdown}
              </p>
            )}

            {/* Scan-only mode on the same phone: no intent link to tap, so
                keep the save-to-gallery workaround alive. */}
            {mode === "qr" && isMobile && qrDataUrl && (
              <a
                href={qrDataUrl}
                download="momentum-arena-upi-qr.png"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
              >
                <Download className="h-3.5 w-3.5" /> Save QR, then scan it from
                gallery in your UPI app
              </a>
            )}

            <div className="mt-4 flex w-full items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <p className="text-xs leading-relaxed text-amber-200/90">
                Pay from your{" "}
                <span className="font-semibold">bank-linked UPI</span>{" "}
                (savings/current). Wallets and credit-card-on-UPI will fail.
              </p>
            </div>

            {appsAvailable && (
              <button
                onClick={() => setPhase("apps")}
                className="mt-3 py-1 text-sm font-medium text-emerald-400 hover:text-emerald-300"
              >
                ← Choose UPI app instead
              </button>
            )}
          </div>
        )}

        {phase === "waiting" && (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <Loader2 className="h-9 w-9 animate-spin text-emerald-500" />
            <p className="mt-4 text-base font-medium text-white">
              {collectVpa
                ? `Payment request sent to ${collectVpa}`
                : `Complete payment in ${launchedApp?.name ?? "your UPI app"}`}
            </p>
            <p className="mt-1 text-[13px] text-zinc-400">
              {collectVpa
                ? "Open your UPI app and approve the request — this confirms automatically."
                : "This confirms automatically the moment you pay — nothing to send us."}
            </p>
            {countdown && (
              <p className="mt-2 text-xs text-zinc-500">
                Expires in {countdown}
              </p>
            )}
            {launchedApp && (
              <button
                onClick={() => launchApp(launchedApp.name, launchedApp.link)}
                className="mt-6 w-full rounded-xl border border-emerald-500/40 px-4 py-3 text-[15px] font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/10"
              >
                Open {launchedApp.name} again
              </button>
            )}
            <button
              onClick={() => {
                setCollectVpa(null);
                setPhase("apps");
              }}
              className="mt-2 w-full py-2 text-sm text-zinc-400 hover:text-zinc-200"
            >
              {collectVpa ? "Pay a different way" : "Choose another app"}
            </button>
          </div>
        )}

        {phase === "confirmed" && (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <div
              className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-emerald-500"
              style={{
                animation:
                  "dqr-check-pop 350ms cubic-bezier(0.34, 1.3, 0.64, 1) both",
              }}
            >
              <svg
                viewBox="0 0 52 52"
                className="h-8 w-8"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M14 27.5 22 35.5 38 18.5"
                  stroke="#fff"
                  strokeWidth={5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    strokeDasharray: 40,
                    strokeDashoffset: 40,
                    animation: "dqr-check-draw 300ms ease-out 200ms forwards",
                  }}
                />
              </svg>
            </div>
            <div style={{ animation: "dqr-fade-in 300ms ease-out 450ms both" }}>
              <p className="mt-5 text-[17px] font-semibold text-white">
                Payment successful
              </p>
              <p className="mt-1 text-[13px] text-zinc-400">
                {surface === "cafe"
                  ? "Your order is confirmed"
                  : "Your booking is confirmed"}
              </p>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-4 px-5 py-6">
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-center">
              <AlertCircle className="mx-auto h-9 w-9 text-red-400" />
              <p className="mt-3 text-sm text-red-300">{error}</p>
            </div>
            <button
              onClick={() => {
                setPhase("init");
                setError(null);
                initiate();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
            {onCancel && (
              <button
                onClick={onCancel}
                className="w-full py-2 text-sm text-zinc-400 hover:text-zinc-200"
              >
                ← Go back
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
