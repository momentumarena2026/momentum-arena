"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

/**
 * "Rain doesn't slow us down" banner. Rendered by server components
 * (homepage, booking page) only when `getRainBanner()` says to show it —
 * so this component just paints the strip. Dismissible for the session so
 * it doesn't nag across page views; reappears next visit.
 *
 * Colours use the app's secondary orange (amber) so it reads distinctly
 * from the green welcome-offer strip it stacks beneath.
 */
export function RainBanner({
  title,
  body,
  href = "/book",
}: {
  title: string;
  body: string;
  href?: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="relative z-30 border-b border-amber-500/20 bg-gradient-to-r from-amber-950/80 via-amber-900/40 to-orange-950/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 sm:px-6">
        {/* The whole strip is tappable (leads to booking) — no separate
            CTA button, so the message has full width and isn't clipped. */}
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-2.5">
          <span aria-hidden className="shrink-0 text-lg leading-none">
            🌧️
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-snug text-white">
              {title || "Rain doesn't slow us down"}
            </p>
            <p className="text-xs leading-snug text-amber-100/80">{body}</p>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 self-start rounded-full p-1 text-amber-100/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
