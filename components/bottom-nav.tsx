"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Coffee,
  Home,
  MapPin,
  Medal,
  Plus,
  ShoppingBag,
  Ticket,
  Trophy,
  User,
} from "lucide-react";
import { trackBottomNavClick } from "@/lib/analytics";

/**
 * Mobile-web bottom navigation — a 1:1 mirror of the native app's
 * MomentumTabBar (apps/mobile/src/navigation/MomentumTabBar.tsx):
 * four destinations split two-and-two around a raised action button
 * that fans open a semicircle of the things you *do* at the venue.
 * Geometry, angles, stagger and easing all match the app so the two
 * surfaces feel like one product. Keep the two files in sync when
 * either changes.
 */

/** Where the venue is — same pin the app's arc opens. */
const VENUE_MAPS_URL = "https://maps.google.com/?q=27.509167,77.638917";

const FAB_SIZE = 60;
const BAR_HEIGHT = 62;
/** One radius shared by the sheet and the item fan — icon centres sit
 *  exactly on the curve (see the app file for the full rationale). */
const SHEET_R = 100;
const ICON_SIZE = 46;
const LABEL_BLOCK = 18;
const ICON_CENTRE_OFFSET = LABEL_BLOCK + ICON_SIZE / 2;
/** Motion tokens — mirrors apps/mobile/src/theme/motion.ts. */
const DURATION_BASE = 220;
const DURATION_SLOW = 340;
const STAGGER_MS = 45;
/** Easing.out(Easing.back(1.3)) ≈ this overshoot curve. */
const EASE_SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const EASE_IN = "cubic-bezier(0.32, 0, 0.67, 0)";

/** Distance from the viewport bottom to the bar's top border. */
const BAR_TOP = `calc(${BAR_HEIGHT}px + max(env(safe-area-inset-bottom, 0px), 10px))`;

type ArcItem = {
  key: string;
  label: string;
  angle: number;
  Icon: typeof Coffee;
};

const ARC_ITEMS_BASE: ArcItem[] = [
  { key: "Cafe", label: "Cafe", angle: 145, Icon: Coffee },
  { key: "Location", label: "Reach us", angle: 90, Icon: MapPin },
  { key: "Shop", label: "Shop", angle: 35, Icon: ShoppingBag },
];

const ARC_ITEMS_WITH_TOURNAMENTS: ArcItem[] = [
  { key: "Cafe", label: "Cafe", angle: 150, Icon: Coffee },
  { key: "Location", label: "Reach us", angle: 108, Icon: MapPin },
  { key: "Tournaments", label: "Tourneys", angle: 72, Icon: Medal },
  { key: "Shop", label: "Shop", angle: 30, Icon: ShoppingBag },
];

const TABS = [
  {
    name: "Home",
    label: "Home",
    href: "/",
    Icon: Home,
    match: (p: string) => p === "/",
  },
  {
    name: "Sports",
    label: "Sports",
    href: "/book",
    Icon: Trophy,
    match: (p: string) => p.startsWith("/book"),
  },
  {
    name: "Passes",
    label: "Passes",
    href: "/passes",
    Icon: Ticket,
    match: (p: string) => p.startsWith("/passes"),
  },
  {
    name: "Account",
    label: "Account",
    href: "/account",
    Icon: User,
    match: (p: string) =>
      p === "/account" ||
      p === "/dashboard" ||
      p.startsWith("/bookings") ||
      p.startsWith("/profile") ||
      p.startsWith("/referral") ||
      p.startsWith("/waitlist") ||
      p.startsWith("/rewards") ||
      p.startsWith("/my-passes") ||
      p.startsWith("/notifications"),
  },
] as const;

const HIDDEN_PATHS = ["/book/checkout", "/shop/checkout", "/cafe/checkout"];

function isSlotSelectionPage(pathname: string): boolean {
  // Matches /book/{sport}/{configId} but NOT /book/{sport} alone
  const parts = pathname.split("/").filter(Boolean);
  return parts.length === 3 && parts[0] === "book";
}

export function BottomNav({
  tournamentsEnabled = false,
}: {
  /** Module master-switch — with it ON the arc gains the Tourneys item
   *  and re-spreads to four (same rule as the app). */
  tournamentsEnabled?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Kept mounted through the closing animation so the arc animates out
  // instead of vanishing (mirror of the app's arcMounted state).
  const [mounted, setMounted] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openArc = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setMounted(true);
    // Double-rAF so the mount renders in its closed pose first — a
    // same-tick open would skip the transition entirely.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setOpen(true)),
    );
  }, []);
  const closeArc = useCallback(() => {
    setOpen(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMounted(false), DURATION_BASE);
  }, []);

  // Hardware/keyboard escape mirrors the Modal's onRequestClose.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeArc();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, closeArc]);

  const arcItems = tournamentsEnabled
    ? ARC_ITEMS_WITH_TOURNAMENTS
    : ARC_ITEMS_BASE;

  const onArcPress = useCallback(
    (key: string) => {
      closeArc();
      if (key === "Location") {
        trackBottomNavClick("VenueLocation");
        window.open(VENUE_MAPS_URL, "_blank", "noopener");
        return;
      }
      trackBottomNavClick(key);
      router.push(
        key === "Cafe" ? "/cafe" : key === "Shop" ? "/shop" : "/tournaments",
      );
    },
    [closeArc, router],
  );

  // Hide on slot selection, checkout, and admin pages (web-specific —
  // the app has no equivalent surfaces under this navigator).
  if (
    HIDDEN_PATHS.some((p) => pathname.startsWith(p)) ||
    isSlotSelectionPage(pathname) ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/godmode")
  ) {
    return null;
  }

  const transition = open
    ? `all ${DURATION_SLOW}ms ${EASE_SPRING}`
    : `all ${DURATION_BASE}ms ${EASE_IN}`;

  return (
    <>
      {/* Document-flow spacer so page content never hides behind the
          fixed bar (disappears automatically wherever the nav does). */}
      <div
        aria-hidden
        className="md:hidden"
        style={{
          height: `calc(${BAR_HEIGHT + 14}px + env(safe-area-inset-bottom, 0px))`,
        }}
      />

      {/* ── Quick-actions arc (scrim + half-disc + fanned items) ── */}
      {mounted && (
        <div className="fixed inset-0 z-[60] md:hidden">
          {/* Scrim */}
          <button
            aria-label="Close quick actions"
            onClick={closeArc}
            className="absolute inset-0 w-full cursor-default"
            style={{
              backgroundColor: "rgba(0,0,0,0.55)",
              opacity: open ? 1 : 0,
              transition,
            }}
          />

          {/* Half-disc sheet — flat edge resting on the bar's border. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2"
            style={{
              bottom: BAR_TOP,
              width: SHEET_R * 2,
              height: SHEET_R,
              marginLeft: -SHEET_R,
              borderTopLeftRadius: SHEET_R,
              borderTopRightRadius: SHEET_R,
              backgroundColor: "#121212",
              border: "1px solid #262626",
              borderBottom: "none",
              transformOrigin: "50% 100%",
              opacity: open ? 1 : 0,
              transform: open
                ? "scale(1) rotate(0deg)"
                : "scale(0.3) rotate(-38deg)",
              transition,
            }}
          />

          {arcItems.map((item, i) => {
            const rad = (item.angle * Math.PI) / 180;
            const dx = Math.cos(rad) * SHEET_R;
            const dy = -Math.sin(rad) * SHEET_R;
            return (
              <div
                key={item.key}
                className="absolute left-1/2 flex flex-col items-center gap-1"
                style={{
                  bottom: `calc(${BAR_TOP} - ${ICON_CENTRE_OFFSET}px)`,
                  transform: open
                    ? `translate(calc(-50% + ${dx}px), ${dy}px) scale(1)`
                    : "translate(-50%, 0) scale(0.4)",
                  opacity: open ? 1 : 0,
                  // Staggered arrival, together on the way out. Delay
                  // lives INSIDE the shorthand — mixing `transition`
                  // with a separate transitionDelay makes React warn
                  // about conflicting shorthand/longhand updates.
                  transition: open
                    ? `all ${DURATION_SLOW}ms ${EASE_SPRING} ${i * STAGGER_MS}ms`
                    : `all ${DURATION_BASE}ms ${EASE_IN} 0ms`,
                }}
              >
                <button
                  onClick={() => onArcPress(item.key)}
                  aria-label={item.label}
                  className="flex items-center justify-center rounded-full border border-emerald-500/30 bg-[#0a0a0a] active:opacity-75"
                  style={{ width: ICON_SIZE, height: ICON_SIZE }}
                >
                  <item.Icon
                    size={22}
                    strokeWidth={2}
                    className="text-emerald-400"
                  />
                </button>
                <span className="text-[10px] text-zinc-300">{item.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Bar ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-800 bg-[#0a0a0a] md:hidden"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 10px)" }}
      >
        <div
          className="flex items-center pt-1.5"
          style={{ height: BAR_HEIGHT }}
        >
          {TABS.slice(0, 2).map((t) => (
            <TabButton key={t.name} tab={t} active={t.match(pathname)} />
          ))}
          {/* FAB slot */}
          <div style={{ width: FAB_SIZE + 16 }} />
          {TABS.slice(2).map((t) => (
            <TabButton key={t.name} tab={t} active={t.match(pathname)} />
          ))}
        </div>
      </nav>

      {/* Raised action button — above the scrim so it stays tappable
          while open, rotating into an × exactly like the app's. */}
      <button
        onClick={open ? closeArc : openArc}
        aria-label={open ? "Close quick actions" : "Quick actions"}
        aria-expanded={open}
        className="fixed left-1/2 z-[70] flex items-center justify-center rounded-full bg-emerald-500 active:opacity-85 md:hidden"
        style={{
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)",
          width: FAB_SIZE,
          height: FAB_SIZE,
          marginLeft: -FAB_SIZE / 2,
          boxShadow: "0 4px 12px rgba(16,185,129,0.45)",
          transform: open ? "rotate(135deg)" : "rotate(0deg)",
          transition,
        }}
      >
        <Plus size={28} strokeWidth={2.5} className="text-[#04140d]" />
      </button>
    </>
  );
}

function TabButton({
  tab,
  active,
}: {
  tab: (typeof TABS)[number];
  active: boolean;
}) {
  const router = useRouter();
  return (
    <button
      onClick={() => {
        trackBottomNavClick(tab.label);
        router.push(tab.href);
      }}
      aria-current={active ? "page" : undefined}
      aria-label={tab.label}
      className="flex flex-1 flex-col items-center gap-[3px]"
    >
      {/* Active is neutral-bright, not emerald — the accent's one job
          is "this is the thing to tap" (same rule as the app). */}
      <tab.Icon
        size={22}
        strokeWidth={active ? 2.4 : 2}
        className={active ? "text-white" : "text-zinc-400"}
      />
      <span
        className={`text-[10px] ${
          active ? "font-semibold text-white" : "text-zinc-400"
        }`}
      >
        {tab.label}
      </span>
    </button>
  );
}
