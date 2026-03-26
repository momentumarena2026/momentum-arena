"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Clock,
  ChefHat,
  Bell,
} from "lucide-react";
import { OrderCard, type LiveOrder } from "./order-card";

interface LiveOrdersProps {
  orders: {
    PENDING: LiveOrder[];
    PREPARING: LiveOrder[];
    READY: LiveOrder[];
  };
}

const columns = [
  {
    key: "PENDING" as const,
    label: "Pending",
    icon: Clock,
    headerBg: "bg-amber-500/20",
    headerText: "text-amber-400",
    headerBorder: "border-amber-500/30",
    badgeBg: "bg-amber-500",
  },
  {
    key: "PREPARING" as const,
    label: "Preparing",
    icon: ChefHat,
    headerBg: "bg-blue-500/20",
    headerText: "text-blue-400",
    headerBorder: "border-blue-500/30",
    badgeBg: "bg-blue-500",
  },
  {
    key: "READY" as const,
    label: "Ready",
    icon: Bell,
    headerBg: "bg-emerald-500/20",
    headerText: "text-emerald-400",
    headerBorder: "border-emerald-500/30",
    badgeBg: "bg-emerald-500",
  },
];

export function LiveOrders({ orders }: LiveOrdersProps) {
  const router = useRouter();
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const lastPendingCountRef = useRef(orders.PENDING.length);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh();
    }, 10000);
    return () => clearInterval(interval);
  }, [router]);

  // Sound notification when new pending orders arrive
  useEffect(() => {
    const currentCount = orders.PENDING.length;
    if (currentCount > lastPendingCountRef.current && !muted) {
      try {
        if (!audioRef.current) {
          audioRef.current = new Audio("/sounds/new-order.mp3");
        }
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {
          // Audio file may not exist yet — silently ignore
        });
      } catch {
        // Audio not supported or file missing
      }
    }
    lastPendingCountRef.current = currentCount;
  }, [orders.PENDING.length, muted]);

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-50 bg-zinc-950 overflow-auto p-6"
          : ""
      }
    >
      {/* Controls */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-400">
            Auto-refreshes every 10s
          </span>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMuted(!muted)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
            title={muted ? "Unmute notifications" : "Mute notifications"}
          >
            {muted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
            title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {fullscreen ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {columns.map((col) => {
          const colOrders = orders[col.key];
          return (
            <div key={col.key} className="flex flex-col">
              {/* Column Header */}
              <div
                className={`mb-3 flex items-center justify-between rounded-xl border px-4 py-3 ${col.headerBg} ${col.headerBorder}`}
              >
                <div className="flex items-center gap-2">
                  <col.icon className={`h-5 w-5 ${col.headerText}`} />
                  <span className={`font-semibold ${col.headerText}`}>
                    {col.label}
                  </span>
                </div>
                <span
                  className={`${col.badgeBg} rounded-full px-2.5 py-0.5 text-xs font-bold text-white`}
                >
                  {colOrders.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-3">
                {colOrders.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center text-sm text-zinc-500">
                    No {col.label.toLowerCase()} orders
                  </div>
                ) : (
                  colOrders.map((order) => (
                    <OrderCard key={order.id} order={order} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
