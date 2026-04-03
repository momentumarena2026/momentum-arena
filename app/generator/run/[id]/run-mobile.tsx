"use client";

import { useState, useEffect, useRef } from "react";
import {
  pinGetDashboard,
  pinStartRunLog,
  pinStopRunLog,
} from "@/actions/generator";
import { Play, Square, Loader2, Fuel, Clock } from "lucide-react";

interface DashboardData {
  generator: { id: string; name: string };
  totalRunningHours: number;
  hoursUntilOilChange: number;
  nextOilChangeAt: number;
  activeRunLog: { id: string; startTime: string } | null;
}

export function GeneratorRunMobile({
  generatorId,
}: {
  generatorId: string;
}) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeStart, setActiveStart] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState("");
  const [acting, setActing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load dashboard on mount
  useEffect(() => {
    refreshDashboard();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Elapsed timer
  useEffect(() => {
    if (activeStart) {
      const tick = () => {
        const diff = Date.now() - activeStart.getTime();
        const hrs = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setElapsed(
          `${hrs.toString().padStart(2, "0")}:${mins
            .toString()
            .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
        );
      };
      tick();
      timerRef.current = setInterval(tick, 1000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    } else {
      setElapsed("");
    }
  }, [activeStart]);

  const refreshDashboard = async () => {
    setLoading(true);
    try {
      const d = await pinGetDashboard(generatorId);
      if (d) {
        const data = JSON.parse(JSON.stringify(d)) as DashboardData;
        setDashboard(data);
        setActiveRunId(data.activeRunLog?.id || null);
        setActiveStart(
          data.activeRunLog?.startTime
            ? new Date(data.activeRunLog.startTime)
            : null
        );
      }
    } catch {
      setMsg({ type: "error", text: "Failed to load" });
    }
    setLoading(false);
  };

  const handleStart = async () => {
    setActing(true);
    setMsg(null);
    const result = await pinStartRunLog(generatorId);
    if (result.success && result.id) {
      setActiveRunId(result.id);
      setActiveStart(new Date());
      setMsg({ type: "success", text: "Generator started" });
    } else {
      setMsg({ type: "error", text: result.error || "Failed to start" });
    }
    setActing(false);
  };

  const handleStop = async () => {
    if (!activeRunId) return;
    setActing(true);
    setMsg(null);
    const result = await pinStopRunLog(activeRunId);
    if (result.success) {
      setActiveRunId(null);
      setActiveStart(null);
      setMsg({ type: "success", text: "Generator stopped" });
      refreshDashboard();
    } else {
      setMsg({ type: "error", text: result.error || "Failed to stop" });
    }
    setActing(false);
  };

  const isRunning = !!activeRunId;

  if (loading && !dashboard) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black px-4 py-6">
      <div className="mx-auto max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <Fuel className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
          <h1 className="text-xl font-bold text-white">
            {dashboard?.generator.name || "Generator"}
          </h1>
          <p className="text-sm text-zinc-500">Start / Stop runtime logging</p>
        </div>

        {/* Status message */}
        {msg && (
          <div
            className={`rounded-lg px-4 py-3 text-center text-sm font-medium ${
              msg.type === "success"
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-red-500/10 text-red-400 border border-red-500/20"
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* Big start/stop button */}
        <div className="flex flex-col items-center gap-4">
          {isRunning ? (
            <>
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
                </span>
                <span className="text-sm font-medium text-emerald-400">
                  Running
                </span>
              </div>

              <div className="text-5xl font-mono font-bold text-white tracking-wider">
                {elapsed}
              </div>

              {activeStart && (
                <p className="text-xs text-zinc-500">
                  Started{" "}
                  {activeStart.toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Kolkata",
                  })}
                </p>
              )}

              <button
                onClick={handleStop}
                disabled={acting}
                className="mt-4 flex h-32 w-32 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/30 transition-all active:scale-95 disabled:opacity-50"
              >
                {acting ? (
                  <Loader2 className="h-10 w-10 animate-spin" />
                ) : (
                  <Square className="h-10 w-10" />
                )}
              </button>
              <span className="text-sm font-medium text-red-400">
                Tap to Stop
              </span>
            </>
          ) : (
            <>
              <div className="text-sm text-zinc-500">Generator is idle</div>

              <button
                onClick={handleStart}
                disabled={acting || loading}
                className="flex h-32 w-32 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 transition-all active:scale-95 disabled:opacity-50"
              >
                {acting ? (
                  <Loader2 className="h-10 w-10 animate-spin" />
                ) : (
                  <Play className="h-10 w-10 ml-1" />
                )}
              </button>
              <span className="text-sm font-medium text-emerald-400">
                Tap to Start
              </span>
            </>
          )}
        </div>

        {/* Stats */}
        {dashboard && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center">
              <Clock className="mx-auto mb-1 h-5 w-5 text-zinc-500" />
              <p className="text-lg font-bold text-white">
                {dashboard.totalRunningHours} hrs
              </p>
              <p className="text-xs text-zinc-500">Total Hours</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center">
              <Fuel className="mx-auto mb-1 h-5 w-5 text-zinc-500" />
              <p className="text-lg font-bold text-white">
                {dashboard.hoursUntilOilChange} hrs
              </p>
              <p className="text-xs text-zinc-500">Until Oil Change</p>
            </div>
          </div>
        )}

        {/* Quick links */}
        <div className="flex gap-3">
          <a
            href={`/generator/fuel/${generatorId}`}
            className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 py-3 text-center text-sm font-medium text-zinc-300 transition-colors active:bg-zinc-800"
          >
            Log Fuel
          </a>
          <a
            href="/admin/generator"
            className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 py-3 text-center text-sm font-medium text-zinc-300 transition-colors active:bg-zinc-800"
          >
            Full Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
