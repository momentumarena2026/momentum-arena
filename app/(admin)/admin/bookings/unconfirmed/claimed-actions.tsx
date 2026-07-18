"use client";

import { useState, useTransition } from "react";
import { resolveClaimedPayment, type ClaimKind } from "@/actions/admin-claimed-payments";

/**
 * Resolve a customer-claimed cafe/pass payment.
 *
 * "Verify" asks PhonePe again — the good outcome, where nobody has to
 * take anyone's word. "Confirm anyway" only appears once PhonePe has
 * refused, i.e. the admin has to go and look at the PhonePe dashboard
 * themselves; the transaction id is shown so they can.
 */
export function ClaimedActions({
  kind,
  intentId,
}: {
  kind: ClaimKind;
  intentId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [canForce, setCanForce] = useState(false);

  const run = (mode: "verify" | "force" | "reject") =>
    startTransition(async () => {
      setMessage(null);
      const res = await resolveClaimedPayment(kind, intentId, mode);
      if (res.ok) {
        setMessage(
          "rejected" in res
            ? "Claim dismissed."
            : res.via === "gateway"
              ? "Confirmed — PhonePe had settled it."
              : "Confirmed manually.",
        );
        setCanForce(false);
        return;
      }
      setMessage(res.error);
      // PhonePe wouldn't confirm — offer the manual override.
      if (/still reports this as/.test(res.error)) setCanForce(true);
    });

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => run("verify")}
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {pending ? "Checking…" : "Verify"}
        </button>
        {canForce && (
          <button
            onClick={() => run("force")}
            disabled={pending}
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
          >
            Confirm anyway
          </button>
        )}
        <button
          onClick={() => run("reject")}
          disabled={pending}
          className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
      {message && <p className="max-w-xs text-[11px] text-zinc-400">{message}</p>}
    </div>
  );
}
