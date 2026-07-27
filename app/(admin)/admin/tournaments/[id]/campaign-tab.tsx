"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, Megaphone, Bell, Image as ImageIcon, Check } from "lucide-react";
import {
  listCampaignItems,
  updateCampaignItem,
  sendCampaignItemNow,
} from "@/actions/admin-tournament-campaign";

type Item = {
  id: string;
  milestone: string;
  kind: string;
  title: string;
  body: string | null;
  enabled: boolean;
  status: string;
  sentAt: string | Date | null;
};

const MILESTONE_LABEL: Record<string, string> = {
  REG_OPEN: "Registrations Open (auto-fires on Reg Open)",
  REG_CLOSING: "Closing Soon (manual)",
  REVEAL_TONIGHT: "Reveal Tonight (manual)",
  REVEALED: "Pools Revealed (auto-fires on reveal)",
  LIVE: "Tournament Live (auto-fires on Live)",
  CHAMPION: "Champion (auto-fires on Completed)",
};

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none";

export function CampaignTab({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { title: string; body: string }>>({});

  const load = async () => {
    const rows = await listCampaignItems(tournamentId);
    setItems(rows as unknown as Item[]);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  const save = async (item: Item, enabled?: boolean) => {
    setBusy(item.id);
    setError(null);
    try {
      const e = edits[item.id];
      const res = await updateCampaignItem(item.id, {
        title: e?.title ?? item.title,
        body: e?.body ?? item.body ?? "",
        enabled: enabled ?? item.enabled,
      });
      if (!res.success) setError(res.error || "Failed");
      else {
        await load();
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  const sendNow = async (item: Item) => {
    setBusy(`send-${item.id}`);
    setError(null);
    try {
      const res = await sendCampaignItemNow(item.id);
      if (!res.success) setError(res.error || "Failed");
      else await load();
    } finally {
      setBusy(null);
    }
  };

  if (!items) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  const milestones = [...new Set(items.map((i) => i.milestone))];

  return (
    <div className="space-y-5">
      <p className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs leading-relaxed text-zinc-400">
        <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        Auto-drafted marketing for this tournament. Edit the copy, toggle items on/off — items
        marked auto-fire go out when the tournament hits that stage; the rest have a Send-now
        button. Pushes go to all app devices; banners appear on the home screens.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {milestones.map((ms) => (
        <div key={ms}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {MILESTONE_LABEL[ms] || ms}
          </h4>
          <div className="space-y-2">
            {items
              .filter((i) => i.milestone === ms)
              .map((item) => {
                const e = edits[item.id] || { title: item.title, body: item.body || "" };
                const sent = item.status === "SENT";
                return (
                  <div key={item.id} className={`rounded-xl border p-3.5 ${sent ? "border-emerald-500/25 bg-emerald-500/[0.04]" : "border-zinc-800 bg-zinc-900"}`}>
                    <div className="flex items-center gap-2">
                      {item.kind === "PUSH" ? (
                        <Bell className="h-4 w-4 text-sky-400" />
                      ) : (
                        <ImageIcon className="h-4 w-4 text-violet-400" />
                      )}
                      <span className="text-xs font-medium text-zinc-400">{item.kind}</span>
                      {sent ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <Check className="h-3 w-3" /> Sent
                          {item.sentAt && ` · ${new Date(item.sentAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`}
                        </span>
                      ) : item.status === "SKIPPED" ? (
                        <span className="text-xs text-amber-400">Skipped (banner needs an image — edit to re-arm)</span>
                      ) : null}
                      <div className="ml-auto flex items-center gap-2">
                        {!sent && (
                          <>
                            <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-emerald-500"
                                checked={item.enabled}
                                onChange={(ev) => save(item, ev.target.checked)}
                              />
                              On
                            </label>
                            <button
                              onClick={() => sendNow(item)}
                              disabled={busy === `send-${item.id}` || !item.enabled}
                              className="flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-xs text-emerald-400 hover:bg-emerald-600/10 disabled:opacity-40"
                            >
                              {busy === `send-${item.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                              Send now
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {!sent && (
                      <div className="mt-2.5 space-y-2">
                        <input
                          className={inputCls}
                          value={e.title}
                          onChange={(ev) => setEdits((s) => ({ ...s, [item.id]: { ...e, title: ev.target.value } }))}
                          onBlur={() => (edits[item.id] ? save(item) : undefined)}
                        />
                        {item.kind === "PUSH" && (
                          <textarea
                            className={inputCls}
                            rows={2}
                            value={e.body}
                            onChange={(ev) => setEdits((s) => ({ ...s, [item.id]: { ...e, body: ev.target.value } }))}
                            onBlur={() => (edits[item.id] ? save(item) : undefined)}
                          />
                        )}
                      </div>
                    )}
                    {sent && (
                      <p className="mt-2 text-sm text-zinc-300">
                        <span className="font-medium text-white">{item.title}</span>
                        {item.body && <span className="text-zinc-400"> — {item.body}</span>}
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
