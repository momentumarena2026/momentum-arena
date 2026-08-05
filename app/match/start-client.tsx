"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Swords } from "lucide-react";

/**
 * Start a scratch match. Deliberately three fields and a button — this
 * gets used standing on the turf with one hand, not at a desk.
 */
export function MatchStartClient() {
  const router = useRouter();
  const [sport, setSport] = useState<"CRICKET" | "FOOTBALL" | "PICKLEBALL">("CRICKET");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [overs, setOvers] = useState("6");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");

  const field =
    "w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          sport,
          teamAName: a,
          teamBName: b,
          oversPerInnings: sport === "CRICKET" ? Number(overs) || null : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't start the match");
      router.push(`/match/${data.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
        <Swords className="h-6 w-6 text-emerald-400" /> Score a match
      </h1>
      <p className="mt-2 text-sm text-zinc-400">
        Playing a casual game? Start a scoreboard and share the code — anyone
        can follow along live.
      </p>

      <div className="mt-6 space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="flex gap-1.5">
          {(["CRICKET", "FOOTBALL", "PICKLEBALL"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSport(s)}
              className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold ${
                sport === s
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <input className={field} placeholder="Team A" value={a} onChange={(e) => setA(e.target.value)} />
        <input className={field} placeholder="Team B" value={b} onChange={(e) => setB(e.target.value)} />
        {sport === "CRICKET" && (
          <input
            className={field}
            placeholder="Overs per innings"
            inputMode="numeric"
            value={overs}
            onChange={(e) => setOvers(e.target.value)}
          />
        )}
        <button
          onClick={start}
          disabled={busy || !a.trim() || !b.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-[15px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Start scoring
        </button>
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <p className="text-sm font-medium text-white">Follow a match</p>
        <div className="mt-2 flex gap-2">
          <input
            className={`${field} uppercase`}
            placeholder="Match code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
          />
          <button
            onClick={() => joinCode.trim() && router.push(`/match/${joinCode.trim().toUpperCase()}`)}
            className="shrink-0 rounded-xl border border-zinc-700 px-4 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
