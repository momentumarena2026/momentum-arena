import { listOtaReleases, type OtaReleaseRow } from "@/actions/admin-ota";
import { OtaActions } from "./ota-actions";
import { Smartphone, Apple, Package } from "lucide-react";

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

export default async function AdminOtaPage() {
  const releases = await listOtaReleases();

  // Group into (channel, platform) buckets. listOtaReleases already
  // returns rows ordered by channel → platform → version → newest, so
  // appending in order keeps each bucket's rows correctly sequenced.
  const buckets = new Map<string, { channel: string; platform: OtaReleaseRow["platform"]; rows: OtaReleaseRow[] }>();
  for (const r of releases) {
    const key = `${r.channel}::${r.platform}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { channel: r.channel, platform: r.platform, rows: [] };
      buckets.set(key, bucket);
    }
    bucket.rows.push(r);
  }
  const groups = Array.from(buckets.values());

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">OTA Updates</h1>
        <p className="mt-1 text-zinc-400">
          Roll out over-the-air JS bundle updates to the mobile app. Only one
          release is live per channel, platform and runtime version.
        </p>
      </div>

      {groups.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <Package className="mx-auto h-8 w-8 text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-500">No OTA releases yet</p>
          <p className="mt-1 text-xs text-zinc-600">
            Publish a build with the EAS / updates pipeline to see it here.
          </p>
        </div>
      )}

      {groups.map((group) => {
        const PlatformIcon = group.platform === "ios" ? Apple : Smartphone;
        return (
          <div
            key={`${group.channel}-${group.platform}`}
            className="rounded-xl border border-zinc-800 bg-zinc-900"
          >
            <div className="flex items-center gap-2.5 border-b border-zinc-800 px-5 py-3.5">
              <div className="rounded-lg bg-zinc-800 p-1.5">
                <PlatformIcon className="h-4 w-4 text-zinc-400" />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-white capitalize">
                  {group.platform}
                </span>
                <span className="rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[10px] text-blue-400">
                  {group.channel}
                </span>
              </div>
              <span className="ml-auto text-xs text-zinc-500">
                {group.rows.length} release{group.rows.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                    <th className="px-5 py-2.5 font-medium">Version</th>
                    <th className="px-5 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5 font-medium">Rollout</th>
                    <th className="px-5 py-2.5 font-medium">Changelog</th>
                    <th className="px-5 py-2.5 font-medium">Assets</th>
                    <th className="px-5 py-2.5 font-medium">Created</th>
                    <th className="px-5 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((r) => {
                    const badge = STATUS_BADGE[r.status];
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-zinc-800/60 last:border-0 align-top"
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-white">
                              {r.runtimeVersion}
                            </span>
                            {r.kind === "ROLLBACK" && (
                              <span className="rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] text-amber-300">
                                Rollback
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[11px] text-zinc-500">
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
                        <td className="px-5 py-3.5 max-w-xs">
                          {r.changelog ? (
                            <span className="text-zinc-400 line-clamp-2">
                              {r.changelog}
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-zinc-400">
                          {r.assetCount}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-zinc-400">
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
          </div>
        );
      })}
    </div>
  );
}
