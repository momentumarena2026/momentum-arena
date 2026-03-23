"use client";

import { useState, useEffect } from "react";
import { Timer } from "lucide-react";

interface CountdownTimerProps {
  expiresAt: Date;
  onExpired: () => void;
}

export function CountdownTimer({ expiresAt, onExpired }: CountdownTimerProps) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const diff = Math.max(
        0,
        Math.floor((expiresAt.getTime() - Date.now()) / 1000)
      );
      setRemaining(diff);
      if (diff === 0) {
        clearInterval(interval);
        onExpired();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpired]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const isUrgent = remaining < 120;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
        isUrgent
          ? "border-red-500/30 bg-red-500/10"
          : "border-yellow-500/30 bg-yellow-500/10"
      }`}
    >
      <Timer
        className={`h-4 w-4 ${isUrgent ? "text-red-400 animate-pulse" : "text-yellow-400"}`}
      />
      <span
        className={`text-sm font-mono font-bold ${
          isUrgent ? "text-red-400" : "text-yellow-400"
        }`}
      >
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
      </span>
      <span className="text-xs text-zinc-500">to complete payment</span>
    </div>
  );
}
