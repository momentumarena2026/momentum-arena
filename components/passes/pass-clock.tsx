"use client";

import { useEffect, useRef, useState } from "react";

const fmtH = (h: number) => h.toFixed(1).replace(/\.0$/, "");

/**
 * Circular "clock" progress for a pass. Two modes:
 *
 * - Listing (no `remainingHours`): the ring fills to a full circle in the
 *   accent colour — "this pass gives you N hours". Animates when it
 *   scrolls into view (`trigger="inview"`).
 * - Owned (`remainingHours` given): the ring is split — the USED portion
 *   in a muted colour and the REMAINING portion in the accent, sweeping
 *   like a clock hand. Animates on mount and replays on hover / tap so
 *   the used-vs-left split reads clearly.
 *
 * SVG uses pathLength=100 so the arcs are expressed in whole-percent
 * units regardless of radius; the group is rotated -90° so drawing starts
 * at 12 o'clock and sweeps clockwise.
 */
export function PassClock({
  totalHours,
  remainingHours,
  accent,
  size = 128,
  stroke = 9,
  trigger = "mount",
  replayOnInteract = false,
  usedColor = "#52525b",
  dim = false,
}: {
  totalHours: number;
  remainingHours?: number;
  accent: string;
  size?: number;
  stroke?: number;
  trigger?: "mount" | "inview";
  replayOnInteract?: boolean;
  usedColor?: string;
  /** Render muted (cancelled / expired pass). */
  dim?: boolean;
}) {
  const owned = remainingHours != null;
  const total = Math.max(totalHours, 0.0001);
  const remaining = owned
    ? Math.max(0, Math.min(remainingHours as number, total))
    : total;
  const used = owned ? Math.max(0, total - remaining) : 0;
  const remPct = (remaining / total) * 100;
  const usedPct = (used / total) * 100;

  const [drawn, setDrawn] = useState(false);
  const [reduced, setReduced] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduced(
      typeof window !== "undefined" &&
        !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    );
  }, []);

  useEffect(() => {
    if (trigger === "mount") {
      const t = setTimeout(() => setDrawn(true), 80);
      return () => clearTimeout(t);
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setDrawn(true);
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [trigger]);

  function replay() {
    if (!replayOnInteract || reduced) return;
    setDrawn(false);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setDrawn(true)),
    );
  }

  const R = 42;
  const dur = 2200; // half-speed sweep — the tick should feel unhurried
  const ease = "cubic-bezier(0.22, 1, 0.36, 1)";
  const trans = reduced
    ? "none"
    : `stroke-dashoffset ${dur}ms ${ease}`;
  const remColor = dim ? usedColor : accent;

  return (
    <div
      ref={ref}
      onMouseEnter={replay}
      onPointerDown={replay}
      className="relative select-none"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        {/* track */}
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={stroke}
        />
        {/* used arc — sweeps first from 12 o'clock */}
        {owned && usedPct > 0.1 && (
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={usedColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={100}
            style={{
              strokeDasharray: `${usedPct} 100`,
              strokeDashoffset: drawn || reduced ? 0 : usedPct,
              transition: trans,
            }}
          />
        )}
        {/* remaining arc — accent, starts where used ends */}
        {remPct > 0.1 && (
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={remColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={100}
            transform={`rotate(${usedPct * 3.6} 50 50)`}
            style={{
              strokeDasharray: `${remPct} 100`,
              strokeDashoffset: drawn || reduced ? 0 : remPct,
              transition: reduced
                ? "none"
                : `stroke-dashoffset ${dur}ms ${ease} ${owned ? 440 : 0}ms`,
              filter: dim ? "none" : `drop-shadow(0 0 5px ${accent}66)`,
            }}
          />
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="flex items-baseline font-bold leading-none text-white">
          <span style={{ fontSize: size * 0.24 }}>
            {fmtH(owned ? remaining : total)}
          </span>
          <span style={{ fontSize: size * 0.13 }}>h</span>
        </span>
        <span
          className="mt-0.5 uppercase tracking-widest text-zinc-500"
          style={{ fontSize: size * 0.085 }}
        >
          {owned ? "left" : "total"}
        </span>
      </div>
    </div>
  );
}
