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
  Undo2,
  Archive,
  Loader2,
  AlertTriangle,
  Check,
} from "lucide-react";

interface OtaActionsProps {
  releaseId: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  rolloutPercent: number;
  // When set, publishing is disabled with this as its tooltip — e.g. the
  // release is older than the currently-live one (rolling it out wouldn't
  // downgrade devices already on the newer build; matches the server-side
  // guard in rolloutOtaRelease).
  disabledReason?: string;
}

/** The rollout ladder. Publishing is a staged decision, not a free-text
 *  number: you go up a rung, watch, go up again. Typing "37" was never
 *  something anyone wanted to do. */
const STEPS = [20, 40, 60, 80, 100] as const;

export function OtaActions({
  releaseId,
  status,
  rolloutPercent,
  disabledReason,
}: OtaActionsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Which step is mid-flight, so only that button spins.
  const [busyStep, setBusyStep] = useState<number | null>(null);

  const run = (
    step: number | null,
    fn: () => Promise<{ success: true } | { error: string }>,
  ) => {
    setError(null);
    setBusyStep(step);
    start(async () => {
      const result = await fn();
      setBusyStep(null);
      if ("error" in result) setError(result.error);
      else router.refresh();
    });
  };

  // One tap = one decision. A DRAFT publishes at the chosen percent; a
  // PUBLISHED release just moves to it. Same ladder either way, so the
  // control doesn't change shape once a release goes live.
  const goTo = (percent: number) =>
    run(percent, () =>
      status === "PUBLISHED"
        ? setOtaRolloutPercent(releaseId, percent)
        : rolloutOtaRelease(releaseId, percent),
    );

  const live = status === "PUBLISHED";
  const blocked = !live && !!disabledReason;

  return (
    <div className="space-y-2">
      {/* The ladder as one segmented track.
          These were five separate chips in a wrapping row inside a narrow
          table cell, so each fell onto its own line and a single release
          grew taller than the screen. A connected track reads as one
          control — "you are here, next rung is that" — and spends the
          horizontal space the row already had. */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-500"
          title={
            live
              ? "Move this live release to a new share of devices."
              : "Publish this release to a share of devices."
          }
        >
          <Rocket className="h-3.5 w-3.5" />
          {live ? "Now at" : "Publish at"}
        </span>

        <div
          role="group"
          aria-label="Rollout percentage"
          className="grid flex-1 grid-cols-5 overflow-hidden rounded-lg border border-emerald-500/30 sm:flex-none sm:w-[19rem]"
        >
          {STEPS.map((step, i) => {
            const current = live && rolloutPercent === step;
            // Rungs already passed read as filled, so the track shows how
            // far the release has travelled at a glance.
            const passed = live && rolloutPercent > step;
            return (
              <button
                key={step}
                type="button"
                disabled={pending || blocked || current}
                title={
                  blocked
                    ? disabledReason
                    : current
                      ? `Already at ${step}%`
                      : live
                        ? `Move rollout to ${step}%`
                        : `Publish at ${step}%`
                }
                onClick={() => goTo(step)}
                className={`inline-flex items-center justify-center gap-1 px-1 py-1.5 text-xs font-semibold tabular-nums transition-colors disabled:cursor-not-allowed ${
                  i > 0 ? "border-l border-emerald-500/20" : ""
                } ${
                  current
                    ? "bg-emerald-500/25 text-emerald-200 disabled:opacity-100"
                    : passed
                      ? "bg-emerald-600/10 text-emerald-500/70 hover:bg-emerald-600/20"
                      : "text-emerald-400 hover:bg-emerald-600/15 disabled:opacity-40"
                }`}
              >
                {busyStep === step ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : current ? (
                  <Check className="h-3 w-3" />
                ) : null}
                {step}%
              </button>
            );
          })}
        </div>
      </div>

      {/* Secondary actions on their own line: pausing, reverting and
          retiring are different in kind from moving the ladder, and
          sitting them in the same row invited a mis-click. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Pause — 0% keeps the release live but serves it to nobody, so a
            bad build stops spreading without archiving it or rolling back. */}
        {live && rolloutPercent !== 0 && (
          <button
            type="button"
            disabled={pending}
            title="Stop serving this release to new devices. Devices already updated stay on it — use Roll back to undo that."
            onClick={() => goTo(0)}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800 disabled:opacity-40 transition-colors"
          >
            {busyStep === 0 ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Pause
          </button>
        )}

        {live && rolloutPercent === 0 && (
          <span className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-500">
            Paused
          </span>
        )}

        {/* Roll back — only meaningful for a live release */}
        {live && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                !window.confirm(
                  "Roll back this release? It will be archived and the previous build re-published at 100%.",
                )
              ) {
                return;
              }
              run(null, () => rollbackOtaRelease(releaseId));
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20 disabled:opacity-40 transition-colors"
          >
            {pending && busyStep === null ? (
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
              run(null, () => archiveOtaRelease(releaseId));
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-400 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40 transition-colors"
          >
            <Archive className="h-3.5 w-3.5" />
            Archive
          </button>
        )}
      </div>

      {error && (
        <p className="inline-flex items-center gap-1 text-[11px] text-red-400">
          <AlertTriangle className="h-3 w-3" /> {error}
        </p>
      )}
    </div>
  );
}
