"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  upsertAppVersionGate,
  setMinSupportedBuild,
  forceUpdateToLatest,
  type AppVersionGateRow,
} from "@/actions/admin-app-version";
import {
  ShieldAlert,
  ShieldOff,
  Save,
  Loader2,
  AlertTriangle,
  Pencil,
  Plus,
  X,
} from "lucide-react";

interface VersionGateEditorProps {
  platform: "ios" | "android";
  channel: "development" | "production";
  gate: AppVersionGateRow | null;
}

export function VersionGateEditor({
  platform,
  channel,
  gate,
}: VersionGateEditorProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Open the edit/create form. New (gateless) slots start collapsed behind
  // a "Create gate" button so empty slots stay quiet.
  const [editing, setEditing] = useState(false);

  const [latestBuild, setLatestBuild] = useState(String(gate?.latestBuild ?? ""));
  const [latestVersionName, setLatestVersionName] = useState(
    gate?.latestVersionName ?? ""
  );
  const [storeUrl, setStoreUrl] = useState(gate?.storeUrl ?? "");
  const [message, setMessage] = useState(gate?.message ?? "");

  const forcing = !!gate && gate.minSupportedBuild >= gate.latestBuild && gate.latestBuild > 0;

  const run = (fn: () => Promise<{ success: true } | { error: string }>) => {
    setError(null);
    start(async () => {
      const result = await fn();
      if ("error" in result) {
        setError(result.error);
      } else {
        setEditing(false);
        router.refresh();
      }
    });
  };

  const submit = () => {
    const build = parseInt(latestBuild, 10);
    if (isNaN(build) || build < 0) {
      setError("Enter a valid latest build number");
      return;
    }
    if (!storeUrl.trim()) {
      setError("Store URL is required");
      return;
    }
    run(() =>
      upsertAppVersionGate({
        platform,
        channel,
        latestBuild: build,
        latestVersionName,
        storeUrl,
        message,
      })
    );
  };

  const onForce = () => {
    if (!gate) return;
    if (
      !window.confirm(
        "Force update — set minimum = latest?\n\nOnly do this AFTER the new build is live on the App Store / Play Store, or you'll lock users out."
      )
    ) {
      return;
    }
    run(() => forceUpdateToLatest(platform, channel));
  };

  const onUnforce = () => {
    if (!gate) return;
    // Un-force = drop the minimum to 0 so nobody is blocked.
    if (
      !window.confirm(
        "Un-force update? Existing installs will no longer be blocked from using the app."
      )
    ) {
      return;
    }
    run(() => setMinSupportedBuild(platform, channel, 0));
  };

  // ---- Empty slot: no gate row yet ----
  if (!gate && !editing) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-white capitalize">{platform}</span>
              <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
                {channel}
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-600">No version gate yet</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEditing(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Create gate
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white capitalize">{platform}</span>
          <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
            {channel}
          </span>
          {forcing ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400">
              <ShieldAlert className="h-3 w-3" /> Forcing
            </span>
          ) : (
            <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
              Not forcing
            </span>
          )}
        </div>
        {gate && !editing && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEditing(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
        )}
      </div>

      {/* Read-only summary */}
      {gate && !editing && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-zinc-500">Latest build</dt>
            <dd className="mt-0.5 font-medium text-zinc-200">
              {gate.latestBuild}
              {gate.latestVersionName ? (
                <span className="ml-1 text-zinc-500">({gate.latestVersionName})</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Min supported</dt>
            <dd
              className={`mt-0.5 font-medium ${forcing ? "text-red-400" : "text-zinc-200"}`}
            >
              {gate.minSupportedBuild}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-zinc-500">Store URL</dt>
            <dd className="mt-0.5 truncate text-zinc-300" title={gate.storeUrl}>
              {gate.storeUrl}
            </dd>
          </div>
          {gate.message ? (
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-zinc-500">Message</dt>
              <dd className="mt-0.5 text-zinc-300">{gate.message}</dd>
            </div>
          ) : null}
        </dl>
      )}

      {/* Edit / create form */}
      {editing && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-500">
                Latest build (number)
              </span>
              <input
                type="number"
                min="0"
                value={latestBuild}
                onChange={(e) => setLatestBuild(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-500">
                Latest version name
              </span>
              <input
                type="text"
                value={latestVersionName}
                onChange={(e) => setLatestVersionName(e.target.value)}
                placeholder="e.g. 1.0.0"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-500">
              Store URL
            </span>
            <input
              type="text"
              value={storeUrl}
              onChange={(e) => setStoreUrl(e.target.value)}
              placeholder="https://apps.apple.com/... or https://play.google.com/..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-500">
              Message (optional)
            </span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              placeholder="Custom copy for the update prompt"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={submit}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors"
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {gate ? "Save changes" : "Create gate"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
                // Reset edits back to the persisted values.
                setLatestBuild(String(gate?.latestBuild ?? ""));
                setLatestVersionName(gate?.latestVersionName ?? "");
                setStoreUrl(gate?.storeUrl ?? "");
                setMessage(gate?.message ?? "");
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Force-update controls — only once a gate exists and not mid-edit */}
      {gate && !editing && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
          {!forcing ? (
            <button
              type="button"
              disabled={pending || gate.latestBuild <= 0}
              onClick={onForce}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5" />
              )}
              Force update — set minimum = latest
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={onUnforce}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 transition-colors"
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldOff className="h-3.5 w-3.5" />
              )}
              Un-force (lower minimum to 0)
            </button>
          )}
          <span className="text-[11px] text-zinc-600">
            {forcing
              ? "Installs below the latest build are blocked."
              : "Raises the minimum supported build so old installs must update."}
          </span>
        </div>
      )}

      {error && (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-red-400">
          <AlertTriangle className="h-3 w-3" /> {error}
        </p>
      )}
    </div>
  );
}
