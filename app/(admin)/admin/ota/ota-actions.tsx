"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  rolloutOtaRelease,
  setOtaRolloutPercent,
  rollbackOtaRelease,
  archiveOtaRelease,
} from "@/actions/admin-ota";
import {
  Rocket,
  Percent,
  Undo2,
  Archive,
  Loader2,
  X,
  AlertTriangle,
} from "lucide-react";

interface OtaActionsProps {
  releaseId: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  rolloutPercent: number;
}

export function OtaActions({ releaseId, status, rolloutPercent }: OtaActionsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Which inline % editor is open: the "Roll out" publish flow or the
  // "Set %" adjust flow. Null = no editor open.
  const [editor, setEditor] = useState<"rollout" | "setpct" | null>(null);
  const [pct, setPct] = useState(String(rolloutPercent || 100));

  const run = (fn: () => Promise<{ success: true } | { error: string }>) => {
    setError(null);
    start(async () => {
      const result = await fn();
      if ("error" in result) {
        setError(result.error);
      } else {
        setEditor(null);
        router.refresh();
      }
    });
  };

  const submitPercent = () => {
    const value = parseInt(pct, 10);
    if (isNaN(value) || value < 0 || value > 100) {
      setError("Enter a rollout percent between 0 and 100");
      return;
    }
    if (editor === "rollout") {
      run(() => rolloutOtaRelease(releaseId, value));
    } else {
      run(() => setOtaRolloutPercent(releaseId, value));
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Roll out — publishes (DRAFT/ARCHIVED→PUBLISHED) at a chosen % */}
        {status !== "PUBLISHED" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setPct(String(rolloutPercent || 100));
              setEditor(editor === "rollout" ? null : "rollout");
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/10 border border-emerald-500/30 px-2.5 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-600/20 disabled:opacity-40 transition-colors"
          >
            <Rocket className="h-3.5 w-3.5" />
            Roll out
          </button>
        )}

        {/* Set % — adjust rollout on an already-published release */}
        {status === "PUBLISHED" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setPct(String(rolloutPercent));
              setEditor(editor === "setpct" ? null : "setpct");
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 transition-colors"
          >
            <Percent className="h-3.5 w-3.5" />
            Set %
          </button>
        )}

        {/* Roll back — only meaningful for a live release */}
        {status === "PUBLISHED" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                !window.confirm(
                  "Roll back this release? It will be archived and the previous build re-published at 100%."
                )
              ) {
                return;
              }
              run(() => rollbackOtaRelease(releaseId));
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20 disabled:opacity-40 transition-colors"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Undo2 className="h-3.5 w-3.5" />
            )}
            Roll back
          </button>
        )}

        {/* Archive — retire a release so it's never served */}
        {status !== "ARCHIVED" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Archive this release? It will no longer be served.")) {
                return;
              }
              run(() => archiveOtaRelease(releaseId));
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-400 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40 transition-colors"
          >
            <Archive className="h-3.5 w-3.5" />
            Archive
          </button>
        )}
      </div>

      {/* Inline % editor for Roll out / Set % */}
      {editor && (
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5">
          <span className="pl-1 text-[11px] text-zinc-500">
            {editor === "rollout" ? "Publish at" : "Rollout"}
          </span>
          <input
            type="number"
            min="0"
            max="100"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitPercent();
            }}
            autoFocus
            className="w-16 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white"
          />
          <span className="text-[11px] text-zinc-500">%</span>
          <button
            type="button"
            disabled={pending}
            onClick={submitPercent}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {editor === "rollout" ? "Publish" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditor(null);
              setError(null);
            }}
            className="rounded-md p-1 text-zinc-500 hover:text-white"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {error && (
        <p className="inline-flex items-center gap-1 text-[11px] text-red-400">
          <AlertTriangle className="h-3 w-3" /> {error}
        </p>
      )}
    </div>
  );
}
