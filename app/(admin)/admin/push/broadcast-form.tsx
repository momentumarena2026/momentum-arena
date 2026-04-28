"use client";

import { useState, useTransition } from "react";
import {
  Bell,
  Send,
  Search,
  X,
  Globe,
  Smartphone,
  Apple,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  sendBroadcast,
  searchUsersForPush,
  sendTestPushToUser,
  type BroadcastAudience,
} from "@/actions/admin-push";

type AudienceKind = "all" | "android" | "ios" | "user";

interface UserMatch {
  id: string;
  name: string | null;
  phone: string | null;
  deviceCount: number;
  platforms: string[];
}

interface BroadcastFormProps {
  initialReach: { all: number; android: number; ios: number };
}

export function BroadcastForm({ initialReach }: BroadcastFormProps) {
  const [kind, setKind] = useState<AudienceKind>("all");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [userMatches, setUserMatches] = useState<UserMatch[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserMatch | null>(null);
  const [searching, setSearching] = useState(false);
  const [sending, startSending] = useTransition();
  const [result, setResult] = useState<
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
    | null
  >(null);

  // Map the UI kind onto the server's discriminated union. Encapsulated
  // here because the form lets the user pick a user mid-flow and we
  // want to fail loudly if they hit Send without a selection.
  function buildAudience(): BroadcastAudience | { error: string } {
    if (kind === "all") return { kind: "all" };
    if (kind === "android") return { kind: "platform", platform: "android" };
    if (kind === "ios") return { kind: "platform", platform: "ios" };
    if (!selectedUser) return { error: "Pick a user first" };
    return { kind: "user", userId: selectedUser.id };
  }

  function reachForKind(): number | null {
    if (kind === "all") return initialReach.all;
    if (kind === "android") return initialReach.android;
    if (kind === "ios") return initialReach.ios;
    return selectedUser?.deviceCount ?? null;
  }

  async function runUserSearch(q: string) {
    setUserQuery(q);
    if (q.trim().length < 2) {
      setUserMatches([]);
      return;
    }
    setSearching(true);
    try {
      const rows = await searchUsersForPush(q);
      setUserMatches(rows);
    } finally {
      setSearching(false);
    }
  }

  function handleSend(dryRun: boolean) {
    setResult(null);
    const audience = buildAudience();
    if ("error" in audience) {
      setResult({ kind: "error", message: audience.error });
      return;
    }
    startSending(async () => {
      const r = await sendBroadcast({
        audience,
        title,
        body,
        dryRun,
      });
      if (!r.ok) {
        setResult({ kind: "error", message: r.error });
        return;
      }
      if (r.dryRun) {
        setResult({
          kind: "success",
          message: `Would send to ${r.attempted} device${r.attempted === 1 ? "" : "s"}.`,
        });
        return;
      }
      setResult({
        kind: "success",
        message: `Sent. ${r.succeeded}/${r.attempted} delivered${
          r.cleanedUp > 0 ? `, ${r.cleanedUp} dead token${r.cleanedUp === 1 ? "" : "s"} pruned` : ""
        }.`,
      });
      // Reset content but keep the audience selection so the admin can
      // fire a quick follow-up if they need to.
      setTitle("");
      setBody("");
    });
  }

  const reach = reachForKind();
  const canSend = title.trim().length > 0 && body.trim().length > 0 && reach !== null && reach > 0 && !sending;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-5">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white tracking-wide">Send broadcast</h2>
        <span className="text-[10px] text-zinc-500 ml-2">Lands on the lock screen of every device matching the audience.</span>
      </div>

      {/* Audience picker */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Audience</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { value: "all" as const, label: "All devices", icon: Globe, count: initialReach.all },
              { value: "android" as const, label: "Android", icon: Smartphone, count: initialReach.android },
              { value: "ios" as const, label: "iOS", icon: Apple, count: initialReach.ios },
              { value: "user" as const, label: "Specific user", icon: Search, count: null },
            ]
          ).map((opt) => {
            const Icon = opt.icon;
            const active = kind === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setKind(opt.value);
                  setResult(null);
                  if (opt.value !== "user") {
                    setSelectedUser(null);
                    setUserMatches([]);
                    setUserQuery("");
                  }
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  active
                    ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                    : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {opt.label}
                {opt.count !== null && (
                  <span className="ml-1 rounded-full bg-zinc-900/60 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500">
                    {opt.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* User search — only when audience = user */}
      {kind === "user" && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Pick a user</p>
          {selectedUser ? (
            <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center text-emerald-400 text-sm font-bold">
                  {selectedUser.name?.[0]?.toUpperCase() ?? "?"}
                </div>
                <div>
                  <p className="text-sm text-white font-medium">{selectedUser.name || selectedUser.phone || "Unnamed user"}</p>
                  <p className="text-[10px] text-zinc-500">
                    {selectedUser.phone || "—"} · {selectedUser.deviceCount} device{selectedUser.deviceCount === 1 ? "" : "s"}
                    {selectedUser.platforms.length > 0 && ` (${selectedUser.platforms.join(", ")})`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedUser(null);
                  setUserQuery("");
                }}
                className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                aria-label="Clear selection"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
                <input
                  type="text"
                  value={userQuery}
                  onChange={(e) => void runUserSearch(e.target.value)}
                  placeholder="Search by name or phone (≥2 chars)"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-zinc-500" />
                )}
              </div>
              {userMatches.length > 0 && (
                <ul className="rounded-lg border border-zinc-800 bg-zinc-950/60 divide-y divide-zinc-800/50 max-h-60 overflow-auto">
                  {userMatches.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedUser(u)}
                        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-zinc-800/60"
                      >
                        <div>
                          <p className="text-sm text-white">{u.name || "Unnamed"}</p>
                          <p className="text-[10px] text-zinc-500">{u.phone || "—"}</p>
                        </div>
                        <span className="text-[10px] text-zinc-500">
                          {u.deviceCount} device{u.deviceCount === 1 ? "" : "s"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selectedUser === null && userQuery.length >= 2 && userMatches.length === 0 && !searching && (
                <p className="text-xs text-zinc-600 px-1">No matches. Try a different query.</p>
              )}
            </>
          )}

          {/* Test push — only meaningful when a specific user is picked */}
          {selectedUser && selectedUser.deviceCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setResult(null);
                startSending(async () => {
                  const r = await sendTestPushToUser(selectedUser.id);
                  setResult({
                    kind: r.succeeded > 0 ? "success" : "error",
                    message: `Test push: ${r.succeeded}/${r.attempted} delivered${r.cleanedUp ? `, ${r.cleanedUp} dead pruned` : ""}.`,
                  });
                });
              }}
              disabled={sending}
              className="text-[11px] text-emerald-400 hover:text-emerald-300 underline underline-offset-2 disabled:opacity-50"
            >
              Send test push to this user
            </button>
          )}
        </div>
      )}

      {/* Title + body */}
      <div className="grid sm:grid-cols-[1fr_auto] gap-4">
        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="e.g. Turf closed today due to rain"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
          />
          <p className="text-[10px] text-zinc-600 text-right">{title.length}/100</p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Plain text — emoji are fine. Lock-screen banners truncate around 150 chars on iOS, 240 on Android."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 resize-y min-h-[80px]"
        />
        <p className="text-[10px] text-zinc-600 text-right">{body.length}/500</p>
      </div>

      {/* Result banner */}
      {result && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            result.kind === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {result.kind === "success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          <span>{result.message}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
        <span className="text-xs text-zinc-500 mr-auto">
          {reach === null
            ? "Pick a user to see the reach."
            : `${reach} device${reach === 1 ? "" : "s"} will receive this.`}
        </span>
        <button
          type="button"
          onClick={() => handleSend(true)}
          disabled={!canSend}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Preview reach
        </button>
        <button
          type="button"
          onClick={() => handleSend(false)}
          disabled={!canSend}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Send broadcast
        </button>
      </div>
    </div>
  );
}
