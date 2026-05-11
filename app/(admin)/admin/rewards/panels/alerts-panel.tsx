"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, X } from "lucide-react";
import { updateRewardAlertStatus } from "@/actions/admin-rewards";

export interface AlertRow {
  id: string;
  kind: string;
  severity: string;
  status: string;
  details: unknown;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  };
}

interface Props {
  alerts: AlertRow[];
}

const KIND_LABELS: Record<string, string> = {
  RAPID_EARN_REDEEM: "Rapid earn → redeem",
  HIGH_VELOCITY_EARN: "High-velocity earn",
  REFUND_THEN_RETAIN: "Refund then retain points",
  DUPLICATE_PHONE_USERS: "Duplicate phone",
  BULK_REDEMPTION: "Bulk redemption",
  NEGATIVE_BALANCE: "Negative balance (impossible)",
  PARTIAL_REVOKE_SHORTFALL: "Revoke shortfall",
  ADJUSTMENT_AUDIT: "Manual adjustment audit",
};

const SEVERITY_TONE: Record<string, string> = {
  HIGH: "border-red-500/40 bg-red-500/10 text-red-300",
  MEDIUM: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  LOW: "border-zinc-700 bg-zinc-900 text-zinc-300",
};

export function RewardsAlertsPanel({ alerts }: Props) {
  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 py-12">
        <Check className="h-6 w-6 text-emerald-400" />
        <p className="mt-2 text-sm font-medium text-white">All clear</p>
        <p className="text-xs text-zinc-500">
          No open alerts. New ones surface here from inline + cron checks.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {alerts.map((a) => (
        <AlertCard key={a.id} alert={a} />
      ))}
    </div>
  );
}

function AlertCard({ alert }: { alert: AlertRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(status: "DISMISSED" | "ACTIONED", resolution?: string) {
    setError(null);
    startTransition(async () => {
      try {
        await updateRewardAlertStatus({ id: alert.id, status, resolution });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update failed");
      }
    });
  }

  const tone = SEVERITY_TONE[alert.severity] ?? SEVERITY_TONE.LOW;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${tone}`}>
          {alert.severity}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <p className="font-semibold text-white">
              {KIND_LABELS[alert.kind] ?? alert.kind}
            </p>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {alert.user.name ?? "—"} ·{" "}
            {alert.user.phone ?? alert.user.email ?? alert.user.id} ·{" "}
            {new Date(alert.createdAt).toLocaleString("en-IN")}
          </p>
        </div>
      </div>

      <pre className="overflow-x-auto rounded-lg bg-black/40 px-3 py-2 text-[11px] text-zinc-400">
        {JSON.stringify(alert.details, null, 2)}
      </pre>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => act("DISMISSED", "False positive")}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-600 disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" />
          Dismiss
        </button>
        <button
          type="button"
          onClick={() => act("ACTIONED", "Reviewed and resolved")}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          <Check className="h-3.5 w-3.5" />
          Mark actioned
        </button>
      </div>
    </div>
  );
}
