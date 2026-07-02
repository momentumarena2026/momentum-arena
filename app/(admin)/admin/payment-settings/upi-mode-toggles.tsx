"use client";

import { useState, useTransition } from "react";
import { QrCode, Smartphone, Zap } from "lucide-react";
import {
  setIntentEnabled,
  setUpiQrMode,
  type UpiQrMode,
} from "@/actions/admin-payment-settings";

interface Props {
  upiQrEnabled: boolean;
  dqrEnabled: boolean;
  intentEnabled: boolean;
  dqrConfigured: boolean;
}

function modeOf(upiQrEnabled: boolean, dqrEnabled: boolean): UpiQrMode {
  if (!upiQrEnabled) return "OFF";
  return dqrEnabled ? "DQR" : "STATIC";
}

function Switch({
  enabled,
  onClick,
  disabled,
}: {
  enabled: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={enabled}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        enabled ? "bg-emerald-500" : "bg-zinc-700"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform duration-150 ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/**
 * The "Pay by UPI" implementation picker. Static QR and Dynamic QR are
 * mutually exclusive parent toggles (turning one on turns the other off;
 * both off hides UPI from checkout). Dynamic QR carries a nested "UPI
 * Intent" toggle: on = the tap-to-pay app-picker sheet, off = the same
 * sheet but with the QR shown directly.
 */
export function UpiModeToggles({
  upiQrEnabled,
  dqrEnabled,
  intentEnabled,
  dqrConfigured,
}: Props) {
  const [mode, setMode] = useState<UpiQrMode>(modeOf(upiQrEnabled, dqrEnabled));
  const [intent, setIntent] = useState(intentEnabled);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  function changeMode(next: UpiQrMode, label: string) {
    const previous = mode;
    setMode(next);
    setMessage(null);
    startTransition(async () => {
      const result = await setUpiQrMode(next);
      if (!result.success) {
        setMode(previous);
        setMessage({ kind: "err", text: result.error || "Failed to update" });
      } else {
        setMessage({ kind: "ok", text: label });
      }
    });
  }

  function toggleIntent() {
    const previous = intent;
    const next = !intent;
    setIntent(next);
    setMessage(null);
    startTransition(async () => {
      const result = await setIntentEnabled(next);
      if (!result.success) {
        setIntent(previous);
        setMessage({ kind: "err", text: result.error || "Failed to update" });
      } else {
        setMessage({
          kind: "ok",
          text: `UPI Intent ${next ? "enabled — customers get the app picker" : "disabled — the QR shows directly in the payment sheet"}`,
        });
      }
    });
  }

  const staticOn = mode === "STATIC";
  const dqrOn = mode === "DQR";

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
        UPI QR
      </h2>

      {/* Static QR — legacy printed QR + manual UTR */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center gap-4">
          <div className={`rounded-lg p-2 ${staticOn ? "bg-emerald-500/10" : "bg-zinc-800"}`}>
            <QrCode className={`h-5 w-5 ${staticOn ? "text-emerald-400" : "text-zinc-500"}`} />
          </div>
          <div className="flex-1">
            <p className={`font-medium ${staticOn ? "text-white" : "text-zinc-500"}`}>
              Static QR
            </p>
            <p className="text-xs text-zinc-500">
              Customer scans the venue QR and enters the UTR manually; staff
              verifies the payment.
            </p>
          </div>
          <Switch
            enabled={staticOn}
            disabled={isPending}
            onClick={() =>
              changeMode(
                staticOn ? "OFF" : "STATIC",
                staticOn
                  ? "UPI turned off — hidden from checkout"
                  : "Static QR enabled (Dynamic QR switched off)",
              )
            }
          />
        </div>
      </div>

      {/* Dynamic QR — auto-confirm, with nested Intent toggle */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center gap-4">
          <div className={`rounded-lg p-2 ${dqrOn ? "bg-emerald-500/10" : "bg-zinc-800"}`}>
            <Zap className={`h-5 w-5 ${dqrOn ? "text-emerald-400" : "text-zinc-500"}`} />
          </div>
          <div className="flex-1">
            <p className={`font-medium ${dqrOn ? "text-white" : "text-zinc-500"}`}>
              Dynamic QR (auto-confirm)
            </p>
            <p className="text-xs text-zinc-500">
              Per-order PhonePe payment with the amount embedded, confirmed
              automatically via callback — no UTR, no manual verification.
            </p>
          </div>
          <Switch
            enabled={dqrOn}
            disabled={isPending || !dqrConfigured}
            onClick={() =>
              changeMode(
                dqrOn ? "OFF" : "DQR",
                dqrOn
                  ? "UPI turned off — hidden from checkout"
                  : "Dynamic QR enabled (Static QR switched off)",
              )
            }
          />
        </div>

        {/* Nested: UPI Intent (tap to pay) */}
        <div
          className={`mt-4 ml-6 border-l border-zinc-800 pl-4 ${
            dqrOn ? "" : "opacity-50"
          }`}
        >
          <div className="flex items-center gap-4">
            <div className={`rounded-lg p-2 ${intent && dqrOn ? "bg-emerald-500/10" : "bg-zinc-800"}`}>
              <Smartphone
                className={`h-5 w-5 ${intent && dqrOn ? "text-emerald-400" : "text-zinc-500"}`}
              />
            </div>
            <div className="flex-1">
              <p className={`font-medium ${intent && dqrOn ? "text-white" : "text-zinc-500"}`}>
                UPI Intent (tap to pay)
              </p>
              <p className="text-xs text-zinc-500">
                On = the payment sheet lists UPI apps (PhonePe, GPay, Paytm,
                BHIM…) and opens the chosen one with the amount pre-filled.
                Off = the same sheet shows the QR directly.
              </p>
            </div>
            <Switch
              enabled={intent}
              disabled={isPending || !dqrOn}
              onClick={toggleIntent}
            />
          </div>
        </div>

        {!dqrConfigured && (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            PhonePe DQR credentials are not configured yet. Set the
            PHONEPE_DQR_* environment variables (see the onboarding doc); until
            then Dynamic QR can&apos;t be enabled.
          </p>
        )}
      </div>

      {message && (
        <p className={`text-sm ${message.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>
          {message.text}
        </p>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
        <p>
          Static QR and Dynamic QR are mutually exclusive — enabling one
          switches the other off. Turning both off hides UPI from checkout
          entirely (at least one payment method must stay enabled overall).
        </p>
      </div>
    </div>
  );
}
