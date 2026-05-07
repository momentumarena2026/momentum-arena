"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Top-of-page thin progress bar that surfaces "navigation in
 * progress" so users get instant feedback when they tap a link.
 *
 * Lifecycle:
 *   1. User clicks an internal anchor → bar appears, progress
 *      animates to ~20% immediately and trickles toward 90%.
 *   2. Server response lands and the new pathname mounts → progress
 *      jumps to 100% and the bar fades out.
 *   3. If the user clicks something else mid-flight, we just reset
 *      to 20% and continue (no flash off then on).
 *
 * Why custom (not nextjs-toploader): keeps the dep tree slim,
 * matches the dark/emerald theme exactly, and the component is
 * <100 lines so the maintenance burden is real-zero.
 */
export function NavLoader() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const trickleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPathRef = useRef<string | null>(null);

  // Capture-phase click listener so we catch the click BEFORE Next's
  // <Link> handler runs the actual navigation. Filter to internal
  // anchors only — external / hash / mailto / tel get nothing.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Modifier-clicks (cmd/ctrl/middle/shift) open in a new tab —
      // current page isn't navigating, don't show the bar.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      if (
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("javascript:")
      ) {
        return;
      }
      if (/^https?:\/\//i.test(href)) {
        // External — same-origin handled separately. Letting the
        // browser do a hard navigation; the bar would never get to
        // call finish() because the page tears down.
        try {
          const u = new URL(href, window.location.origin);
          if (u.origin !== window.location.origin) return;
        } catch {
          return;
        }
      }
      // target=_blank / download attributes also bypass the SPA route.
      if (
        anchor.getAttribute("target") === "_blank" ||
        anchor.hasAttribute("download")
      ) {
        return;
      }
      start();
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, []);

  // Finish the bar whenever the pathname actually changes. Skip the
  // initial mount so a fresh page load doesn't flash the bar.
  useEffect(() => {
    if (lastPathRef.current === null) {
      lastPathRef.current = pathname;
      return;
    }
    if (lastPathRef.current !== pathname) {
      lastPathRef.current = pathname;
      finish();
    }
  }, [pathname]);

  function start() {
    if (finishRef.current) {
      clearTimeout(finishRef.current);
      finishRef.current = null;
    }
    setVisible(true);
    setProgress(20);
    if (trickleRef.current) clearInterval(trickleRef.current);
    // Asymptote at 90% — the bar visibly creeps but never "finishes"
    // on its own. Real finish comes from the pathname change above.
    trickleRef.current = setInterval(() => {
      setProgress((p) => Math.min(p + (90 - p) * 0.08, 90));
    }, 200);
  }

  function finish() {
    if (trickleRef.current) {
      clearInterval(trickleRef.current);
      trickleRef.current = null;
    }
    setProgress(100);
    finishRef.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 220);
  }

  // Cleanup on unmount — extremely defensive but keeps strict-mode
  // happy.
  useEffect(() => {
    return () => {
      if (trickleRef.current) clearInterval(trickleRef.current);
      if (finishRef.current) clearTimeout(finishRef.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-0.5"
    >
      <div
        className="h-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]"
        style={{
          width: `${progress}%`,
          transition: "width 200ms ease-out, opacity 200ms ease-out",
          opacity: progress >= 100 ? 0 : 1,
        }}
      />
    </div>
  );
}
