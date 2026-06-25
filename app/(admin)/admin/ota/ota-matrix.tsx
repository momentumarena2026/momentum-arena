"use client";

import { useState } from "react";
import type { OtaReleaseRow } from "@/actions/admin-ota";
import type { AppVersionGateRow } from "@/actions/admin-app-version";
import { OtaActions } from "./ota-actions";
import { VersionGateEditor } from "./version-gate-editor";
import { Smartphone, Apple, Package } from "lucide-react";

const CHANNELS = ["development", "production"] as const;
const PLATFORMS = ["ios", "android"] as const;

type Channel = (typeof CHANNELS)[number];
type Platform = (typeof PLATFORMS)[number];

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

interface OtaMatrixProps {
  releases: OtaReleaseRow[];
  gates: AppVersionGateRow[];
}

export function OtaMatrix({ releases, gates }: OtaMatrixProps) {
  // "all" + each concrete value, rendered as segmented controls.
  const [channelFilter, setChannelFilter] = useState<Channel | "all">("all");
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");

  const visibleChannels = (
    channelFilter === "all" ? CHANNELS : [channelFilter]
  ) as Channel[];
  const visiblePlatforms = (
    platformFilter === "all" ? PLATFORMS : [platformFilter]
  ) as Platform[];

  // Index releases by (channel, platform). listOtaReleases returns rows
  // already ordered channel → platform → version → newest, so each slot's
  // array stays newest-first as we append.
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
    <div className="space-y-10">
      {/* OTA matrix section */}
      <section className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">OTA Updates</h1>
            <p className="mt-1 text-zinc-400">
              Roll out over-the-air JS bundle updates to the mobile app, grouped
              by channel × platform. Only one release is live per slot and
              runtime version.
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">
              Channel
            </span>
            <div className="inline-flex overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
              <button
                type="button"
                onClick={() => setChannelFilter("all")}
                className={segBtn(channelFilter === "all")}
              >
                All
              </button>
              {CHANNELS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannelFilter(c)}
                  className={`border-l border-zinc-800 ${segBtn(channelFilter === c)}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
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

        {/* Matrix: one card per (channel × platform) slot */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {visibleChannels.flatMap((channel) =>
            visiblePlatforms.map((platform) => {
              const rows = releaseSlots.get(`${channel}::${platform}`) ?? [];
              const PlatformIcon = platform === "ios" ? Apple : Smartphone;
              return (
                <div
                  key={`${channel}-${platform}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-900"
                >
                  <div className="flex items-center gap-2.5 border-b border-zinc-800 px-5 py-3.5">
                    <div className="rounded-lg bg-zinc-800 p-1.5">
                      <PlatformIcon className="h-4 w-4 text-zinc-400" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white capitalize">
                        {platform}
                      </span>
                      <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
                        {channel}
                      </span>
                    </div>
                    <span className="ml-auto text-xs text-zinc-500">
                      {rows.length} release{rows.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {rows.length === 0 ? (
                    <div className="px-5 py-8 text-center">
                      <Package className="mx-auto h-7 w-7 text-zinc-700" />
                      <p className="mt-2 text-xs text-zinc-600">
                        No releases in this slot
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                            <th className="px-5 py-2.5 font-medium">OTA</th>
                            <th className="px-5 py-2.5 font-medium">Status</th>
                            <th className="px-5 py-2.5 font-medium">Rollout</th>
                            <th className="px-5 py-2.5 font-medium">Changelog</th>
                            <th className="px-5 py-2.5 font-medium">Created</th>
                            <th className="px-5 py-2.5 font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => {
                            const badge = STATUS_BADGE[r.status];
                            return (
                              <tr
                                key={r.id}
                                className="border-b border-zinc-800/60 align-top last:border-0"
                              >
                                <td className="px-5 py-3.5">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-white">
                                      OTA #{r.sequence}
                                    </span>
                                    {r.kind === "ROLLBACK" && (
                                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                                        Rollback
                                      </span>
                                    )}
                                  </div>
                                  <span className="block text-[11px] text-zinc-500">
                                    rt {r.runtimeVersion}
                                  </span>
                                  <span className="font-mono text-[11px] text-zinc-600">
                                    {shortId(r.id)}
                                  </span>
                                </td>
                                <td className="px-5 py-3.5">
                                  <span
                                    className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}
                                  >
                                    {badge.label}
                                  </span>
                                </td>
                                <td className="px-5 py-3.5">
                                  {r.status === "PUBLISHED" ? (
                                    <span className="text-zinc-200">
                                      {r.rolloutPercent}%
                                    </span>
                                  ) : (
                                    <span className="text-zinc-600">—</span>
                                  )}
                                </td>
                                <td className="max-w-xs px-5 py-3.5">
                                  {r.changelog ? (
                                    <span className="line-clamp-2 text-zinc-400">
                                      {r.changelog}
                                    </span>
                                  ) : (
                                    <span className="text-zinc-600">—</span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-5 py-3.5 text-zinc-400">
                                  {formatDate(r.createdAt)}
                                </td>
                                <td className="px-5 py-3.5">
                                  <OtaActions
                                    releaseId={r.id}
                                    status={r.status}
                                    rolloutPercent={r.rolloutPercent}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Native version gate section */}
      <section className="space-y-5">
        <div>
          <h2 className="text-xl font-bold text-white">Native Version Gate</h2>
          <p className="mt-1 text-zinc-400">
            Controls the store-update prompt and the blocking{" "}
            <span className="text-zinc-300">Update Required</span> screen per
            channel × platform. Raising the minimum forces every older install
            to update — only do it after the new build is live on the store.
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
