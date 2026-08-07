"use client";

import type { ReactNode } from "react";
import { trackDownloadAppClick } from "@/lib/analytics";

/**
 * The clickable half of a store badge.
 *
 * StoreBadges is a server component (it reads the User-Agent to decide
 * which badges to show), so the click handler has to live in a client
 * child. This is that child and nothing more — the markup stays in
 * StoreBadges so there is still one place that decides how a badge looks.
 *
 * Tracking is fire-and-forget and does NOT preventDefault: the navigation
 * to the store must happen whether or not the event makes it out. The
 * queue in lib/analytics batches and posts on its own schedule, and it
 * survives the tab going to the background, which is exactly what happens
 * when the App Store opens over the page.
 */
export function StoreBadgeLink({
  href,
  store,
  placement,
  ariaLabel,
  title,
  className,
  children,
}: {
  href: string;
  store: "ios" | "android";
  /** Where on the page this badge sits, so the funnel can tell a header
   *  tap from the sticky bar that follows the user down the page. */
  placement: "header" | "footer" | "sticky_bar" | "other";
  ariaLabel: string;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      title={title}
      className={className}
      onClick={() => trackDownloadAppClick(store, placement)}
    >
      {children}
    </a>
  );
}
