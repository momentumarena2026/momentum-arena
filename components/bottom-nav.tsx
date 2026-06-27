"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { trackBottomNavClick } from "@/lib/analytics";

const HIDDEN_PATHS = [
  "/book/checkout",
  "/shop/checkout",
  "/cafe/checkout",
];

function isSlotSelectionPage(pathname: string): boolean {
  // Matches /book/{sport}/{configId} but NOT /book/{sport} alone
  const parts = pathname.split("/").filter(Boolean);
  return parts.length === 3 && parts[0] === "book";
}

export function BottomNav() {
  const pathname = usePathname();

  // Hide on slot selection, checkout, and admin pages
  if (
    HIDDEN_PATHS.some((p) => pathname.startsWith(p)) ||
    isSlotSelectionPage(pathname) ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/godmode")
  ) {
    return null;
  }

  // Tab order: Home, Sports, Cafe, Shop, Account. Chat moved out of
  // the bottom nav and into the Account screen instead (logged-in:
  // under My Waitlist; logged-out: above the version footer).
  // Account points at /account so anonymous users see a sign-in
  // hero rather than getting redirected to /login.
  const tabs = [
    { href: "/", label: "Home", emoji: "\u{1F3E0}", match: (p: string) => p === "/" },
    { href: "/book", label: "Sports", emoji: "\u{1F3DF}\uFE0F", match: (p: string) => p.startsWith("/book") },
    { href: "/cafe", label: "Cafe", emoji: "\u2615", match: (p: string) => p.startsWith("/cafe") },
    { href: "/shop", label: "Shop", emoji: "\u{1F6CD}\uFE0F", match: (p: string) => p.startsWith("/shop") },
    { href: "/account", label: "Account", emoji: "\u{1F464}", match: (p: string) => p === "/account" || p === "/dashboard" || p.startsWith("/bookings") || p.startsWith("/profile") || p.startsWith("/referral") || p.startsWith("/waitlist") || p.startsWith("/rewards") },
  ];

  return (
    <>
      {/*
        Document-flow spacer so page content never sits underneath the
        fixed bar at the bottom. Without this, the last ~80px of any
        scrollable mobile page is hidden behind the nav — which reads
        as "content runs out one page early / blank section at the
        bottom". Sized to cover the nav itself (~56px) plus the iOS
        home-indicator safe area on notched devices.

        Kept inside this component (rather than added to every layout)
        so the spacer disappears automatically wherever the nav itself
        is hidden (admin / godmode / checkout / slot picker).
      */}
      <div
        aria-hidden
        className="md:hidden"
        style={{ height: "calc(4.5rem + env(safe-area-inset-bottom, 0px))" }}
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-black/95 backdrop-blur-md border-t border-zinc-800"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-center justify-around py-2.5">
          {tabs.map((tab) => {
            const isActive = tab.match(pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => trackBottomNavClick(tab.label)}
                className={`flex flex-col items-center gap-0.5 transition ${
                  isActive ? "text-emerald-400" : "text-zinc-400 hover:text-white"
                }`}
              >
                <span className="text-lg">{tab.emoji}</span>
                <span className={`text-[10px] font-medium ${isActive ? "text-emerald-400" : ""}`}>
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
