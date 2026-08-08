"use client";

import { useState } from "react";
import type { OtaReleaseRow } from "@/actions/admin-ota";
import type { AppVersionGateRow } from "@/actions/admin-app-version";
import { OtaActions } from "./ota-actions";
import { VersionGateEditor } from "./version-gate-editor";
import {
  Smartphone,
  Apple,
  Package,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const CHANNELS = ["development", "production"] as const;
const PLATFORMS = ["ios", "android"] as const;

type Channel = (typeof CHANNELS)[number];
type Platform = (typeof PLATFORMS)[number];

// Releases per page, inside each slot card.
const PAGE_SIZE = 6;

const STATUS_BADGE: Record<
  OtaReleaseRow["status"],
  { label: string; cls: string }
> = {
  DRAFT: {
    label: "Draft",
    cls: "bg-zinc-700/60 border-zinc-600 text-zinc-300",
  },
  PUBLISHED: {
    label: "Published",
    cls: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
  },
  ARCHIVED: {
    label: "Archived",
    cls: "bg-zinc-800 border-zinc-700 text-zinc-500",
  },
};

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function RolloutBar({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
      <span className="tabular-nums text-xs text-zinc-300">{percent}%</span>
    </div>
  );
}

/**
 * One full-width card per (channel × platform) slot, with its own pagination
 * so a long release history never blows up the page. Rows arrive newest-first.
 */
function ReleaseSlotCard({
  channel,
  platform,
  rows,
}: {
  channel: Channel;
  platform: Platform;
  rows: OtaReleaseRow[];
}) {
  const [page, setPage] = useState(0);
  const PlatformIcon = platform === "ios" ? Apple : Smartphone;

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);
  const live = rows.find((r) => r.status === "PUBLISHED");

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
      {/* Card header */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-zinc-800 px-5 py-3.5">
        <div className="rounded-lg bg-zinc-800 p-1.5">
          <PlatformIcon className="h-4 w-4 text-zinc-400" />
        </div>
        <span className="font-medium capitalize text-white">{platform}</span>
        <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
          {channel}
        </span>
        {live && (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
            Live · OTA #{live.sequence} · {live.rolloutPercent}%
          </span>
        )}
        <span className="ml-auto text-xs text-zinc-500">
          {rows.length} release{rows.length !== 1 ? "s" : ""}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <Package className="mx-auto h-7 w-7 text-zinc-700" />
          <p className="mt-2 text-xs text-zinc-600">No releases in this slot</p>
        </div>
      ) : (
        <>
          {/* One block per release rather than a table row.
              The table gave Changelog `w-full` and left Actions whatever
              was spare, so the rollout ladder wrapped one chip per line
              and a single release ran taller than the viewport. Blocks
              hand the controls the row's whole width, and stack cleanly
              on a phone instead of scrolling sideways. */}
          <ul className="divide-y divide-zinc-800/60">
            {pageRows.map((r) => {
              const badge = STATUS_BADGE[r.status];
              // Rolling out a release older than the live one never cleanly
              // reverts (expo-updates won't downgrade) — block it in the UI
              // to match the server guard.
              const olderThanLive =
                !!live &&
                r.id !== live.id &&
                new Date(r.createdAt).getTime() <
                  new Date(live.createdAt).getTime();
              return (
                <li
                  key={r.id}
                  className="px-4 py-3.5 transition-colors hover:bg-zinc-800/20 sm:px-5"
                >
                  {/* Identity line */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="font-medium text-white">
                      OTA #{r.sequence}
                    </span>
                    <span
                      className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                    {r.kind === "ROLLBACK" && (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                        Rollback
                      </span>
                    )}
                    {/* RolloutBar renders a div — keep it out of a span so
                        the markup stays valid and React doesn't warn. */}
                    {r.status === "PUBLISHED" && (
                      <div className="ml-1">
                        <RolloutBar percent={r.rolloutPercent} />
                      </div>
                    )}
                    <span className="ml-auto flex items-center gap-2 text-[11px] text-zinc-500">
                      <span className="hidden sm:inline">rt {r.runtimeVersion}</span>
                      <span className="hidden font-mono text-zinc-600 sm:inline">
                        {shortId(r.id)}
                      </span>
                      {formatDate(r.createdAt)}
                    </span>
                  </div>

                  {r.changelog && (
                    <p className="mt-1.5 line-clamp-2 text-sm text-zinc-400">
                      {r.changelog}
                    </p>
                  )}

                  <div className="mt-2.5">
                    <OtaActions
                      releaseId={r.id}
                      status={r.status}
                      rolloutPercent={r.rolloutPercent}
                      disabledReason={
                        olderThanLive
                          ? "Older than the live release — devices won't downgrade. Use Roll back or publish a new release."
                          : undefined
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Pagination footer */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
              <span className="text-xs text-zinc-500">
                Showing {start + 1}–{Math.min(start + PAGE_SIZE, rows.length)} of{" "}
                {rows.length}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage(safePage - 1)}
                  disabled={safePage === 0}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-1 text-xs text-zinc-400">
                  Page {safePage + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(safePage + 1)}
                  disabled={safePage >= pageCount - 1}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface OtaMatrixProps {
  releases: OtaReleaseRow[];
  gates: AppVersionGateRow[];
  // Which environment THIS deployment manages — prod domain → "production",
  // dev domain → "development". Each domain is backed by its own DB, which only
  // ever holds its own channel's rows, so the UI is locked to it (no tabs).
  environment: Channel;
}

export function OtaMatrix({ releases, gates, environment }: OtaMatrixProps) {
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");

  const visibleChannels: Channel[] = [environment];
  const visiblePlatforms = (
    platformFilter === "all" ? PLATFORMS : [platformFilter]
  ) as Platform[];

  // Index releases by (channel, platform). listOtaReleases returns rows
  // already ordered newest-first per slot, so each array stays newest-first.
  const releaseSlots = new Map<string, OtaReleaseRow[]>();
  for (const r of releases) {
    const key = `${r.channel}::${r.platform}`;
    const arr = releaseSlots.get(key);
    if (arr) arr.push(r);
    else releaseSlots.set(key, [r]);
  }

  const gateSlots = new Map<string, AppVersionGateRow>();
  for (const g of gates) {
    gateSlots.set(`${g.channel}::${g.platform}`, g);
  }

  const segBtn = (active: boolean) =>
    `px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
      active
        ? "bg-emerald-500/10 text-emerald-400"
        : "text-zinc-400 hover:text-zinc-200"
    }`;

  return (
    <div className="space-y-8">
      {/* Page header — this deployment manages exactly one environment
          (prod admin → production, dev admin → development). */}
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-bold text-white">OTA Updates</h1>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${
              environment === "production"
                ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                : "border-blue-500/30 bg-blue-500/10 text-blue-300"
            }`}
          >
            {environment} environment
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-zinc-400">
          Roll out over-the-air JS bundle updates to the{" "}
          <span className="capitalize">{environment}</span> mobile app
          {environment === "production"
            ? " (live on the stores)."
            : " (TestFlight / Play internal testing)."}{" "}
          This admin manages the {environment} environment only.
        </p>
      </div>

      {/* OTA releases for the active environment */}
      <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold capitalize text-white">
            {environment} · OTA releases
          </h2>
          {/* Platform filter */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">
              Platform
            </span>
            <div className="inline-flex overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
              <button
                type="button"
                onClick={() => setPlatformFilter("all")}
                className={segBtn(platformFilter === "all")}
              >
                All
              </button>
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatformFilter(p)}
                  className={`border-l border-zinc-800 ${segBtn(platformFilter === p)}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Full-width stacked slot cards */}
        <div className="space-y-5">
          {visibleChannels.flatMap((channel) =>
            visiblePlatforms.map((platform) => (
              <ReleaseSlotCard
                key={`${channel}-${platform}`}
                channel={channel}
                platform={platform}
                rows={releaseSlots.get(`${channel}::${platform}`) ?? []}
              />
            ))
          )}
        </div>
      </section>

      {/* Native version gate section */}
      <section className="space-y-5">
        <div>
          <h2 className="text-xl font-bold text-white">Native Version Gate</h2>
          <p className="mt-1 max-w-3xl text-zinc-400">
            Controls the store-update prompt and the blocking{" "}
            <span className="text-zinc-300">Update Required</span> screen per
            channel × platform. Raising the minimum forces every older install to
            update — only do it after the new build is live on the store.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {visibleChannels.flatMap((channel) =>
            visiblePlatforms.map((platform) => (
              <VersionGateEditor
                key={`gate-${channel}-${platform}`}
                platform={platform}
                channel={channel}
                gate={gateSlots.get(`${channel}::${platform}`) ?? null}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
