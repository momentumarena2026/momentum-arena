"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addTrustedDevice,
  removeTrustedDevice,
  renameTrustedDevice,
} from "@/actions/admin-trusted-devices";
import { Smartphone, Trash2, Pencil, Plus } from "lucide-react";

interface Device {
  id: string;
  deviceId: string;
  label: string;
  platform: string | null;
  source: string;
  createdAt: string;
  lastSeenAt: string;
}

/**
 * CRUD surface for the 5-tap allowlist. Kept deliberately plain — this
 * is an internal tool used a handful of times when someone gets a new
 * phone. The important copy lives on the page header (how to obtain a
 * device's ID).
 */
export function TrustedDevicesManager({ devices }: { devices: Device[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deviceId, setDeviceId] = useState("");
  const [label, setLabel] = useState("");
  const [platform, setPlatform] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submitAdd() {
    setError(null);
    startTransition(async () => {
      const res = await addTrustedDevice({
        deviceId,
        label,
        platform: platform || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDeviceId("");
      setLabel("");
      setPlatform("");
      router.refresh();
    });
  }

  function submitRename(d: Device) {
    const next = window.prompt("New label for this device:", d.label);
    if (!next || next.trim() === d.label) return;
    startTransition(async () => {
      const res = await renameTrustedDevice(d.id, next);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function submitRemove(d: Device) {
    if (
      !window.confirm(
        `Remove “${d.label}”? The 5-tap admin entry will stop working on that device.`,
      )
    )
      return;
    startTransition(async () => {
      await removeTrustedDevice(d.id);
      router.refresh();
    });
  }

  const inputClass =
    "rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-600 focus:outline-none";

  return (
    <div className="space-y-6">
      {/* Add form */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <p className="mb-3 text-sm font-semibold text-white">Add a device</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[260px] flex-1 flex-col gap-1">
            <label className="text-xs text-zinc-400">Device ID</label>
            <input
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="From 12 taps on the app's version number"
              className={inputClass}
            />
          </div>
          <div className="flex min-w-[200px] flex-1 flex-col gap-1">
            <label className="text-xs text-zinc-400">Label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Nakul's iPhone"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">Platform</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className={inputClass}
            >
              <option value="">Unknown</option>
              <option value="ios">iOS</option>
              <option value="android">Android</option>
            </select>
          </div>
          <button
            onClick={submitAdd}
            disabled={pending || !deviceId.trim() || !label.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add device
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>

      {/* Device list */}
      {devices.length === 0 ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          No devices registered — the 5-tap admin entry is currently
          disabled on <strong>every</strong> device. Tap the app’s version
          number 12 times to reveal a device’s ID, then add it here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">Device ID</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Last seen</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr
                  key={d.id}
                  className="border-b border-zinc-800/60 last:border-0"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-white">
                      <Smartphone className="h-4 w-4 shrink-0 text-zinc-500" />
                      <span className="font-medium">{d.label}</span>
                      {d.platform && (
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                          {d.platform}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs text-zinc-400">
                    {d.deviceId}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        d.source === "LOGIN"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-zinc-800 text-zinc-300"
                      }`}
                    >
                      {d.source === "LOGIN" ? "Admin login" : "Manual"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-400">
                    {new Date(d.lastSeenAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => submitRename(d)}
                        disabled={pending}
                        className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
                        title="Rename"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => submitRemove(d)}
                        disabled={pending}
                        className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                        title="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
