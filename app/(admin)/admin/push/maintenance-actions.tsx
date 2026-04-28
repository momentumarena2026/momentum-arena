"use client";

import { useState, useTransition } from "react";
import { Trash2, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { pruneStalePushDevices, deletePushDeviceById } from "@/actions/admin-push";

interface MaintenanceActionsProps {
  staleDevices: number;
}

export function PruneStaleButton({ staleDevices }: MaintenanceActionsProps) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending || staleDevices === 0}
        onClick={() => {
          if (
            !window.confirm(
              `Delete ${staleDevices} push device${staleDevices === 1 ? "" : "s"} that haven't checked in for 90+ days?`,
            )
          ) {
            return;
          }
          setFeedback(null);
          start(async () => {
            const r = await pruneStalePushDevices(90);
            setFeedback(`Pruned ${r.deleted} stale device${r.deleted === 1 ? "" : "s"}.`);
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        Prune {staleDevices > 0 && `${staleDevices} `}stale
      </button>
      {feedback && (
        <span className="text-[11px] text-emerald-400 inline-flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> {feedback}
        </span>
      )}
    </div>
  );
}

export function DeleteDeviceButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-zinc-600">
        <CheckCircle2 className="h-3 w-3" /> deleted — refresh to remove row
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Unregister this device from push notifications?")) return;
          setError(null);
          start(async () => {
            try {
              await deletePushDeviceById(id);
              setDone(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed");
            }
          });
        }}
        className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400 disabled:opacity-40"
        aria-label="Delete device"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
      {error && (
        <span className="ml-1 text-[10px] text-red-400 inline-flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> {error}
        </span>
      )}
    </>
  );
}
