"use client";

import { useState, useTransition } from "react";
import { Zap } from "lucide-react";
import { setDqrEnabled } from "@/actions/admin-payment-settings";

interface Props {
  dqrEnabled: boolean;
  dqrConfigured: boolean;
}

/**
 * Toggles the dynamic-QR (DQR) implementation behind the "Pay by UPI"
 * option. When off, UPI uses the legacy static QR + manual UTR. The
 * toggle is independent of the per-method flags; it only takes effect
 * once the PHONEPE_DQR_* env creds are present (dqrConfigured).
 */
export function DqrToggle({ dqrEnabled, dqrConfigured }: Props) {
  const [enabled, setEnabled] = useState(dqrEnabled);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  function toggle() {
    const previous = enabled;
    const next = !enabled;
    setEnabled(next);
    setMessage(null);
    startTransition(async () => {
      const result = await setDqrEnabled(next);
      if (!result.success) {
        setEnabled(previous);
        setMessage({ kind: "err", text: result.error || "Failed to update" });
      } else {
        setMessage({
          kind: "ok",
          text: `Dynamic QR ${next ? "enabled" : "disabled"}`,
        });
      }
    });
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
        UPI Payment Mode
      </h2>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center gap-4">
          <div className={`rounded-lg p-2 ${enabled ? "bg-emerald-500/10" : "bg-zinc-800"}`}>
            <Zap className={`h-5 w-5 ${enabled ? "text-emerald-400" : "text-zinc-500"}`} />
          </div>
          <div className="flex-1">
            <p className={`font-medium ${enabled ? "text-white" : "text-zinc-500"}`}>
              Dynamic QR (auto-confirm)
            </p>
            <p className="text-xs text-zinc-500">
              Generate a per-order PhonePe QR with the amount embedded and
              auto-confirm via callback. Off = legacy static QR + manual UTR.
            </p>
          </div>
          <button
            onClick={toggle}
            disabled={isPending || !dqrConfigured}
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
        </div>

        {!dqrConfigured && (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            PhonePe DQR credentials are not configured yet. Set the
            PHONEPE_DQR_* environment variables (see the onboarding doc); until
            then this toggle has no effect and UPI uses the static QR.
          </p>
        )}
      </div>

      {message && (
        <p className={`text-sm ${message.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
