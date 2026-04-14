"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChatNavButton } from "@/components/chatbot/chat-nav-button";
import { trackBottomNavClick } from "@/lib/analytics";

const HIDDEN_PATHS = [
  "/book/checkout",
];

function isSlotSelectionPage(pathname: string): boolean {
  // Matches /book/{sport}/{configId} but NOT /book/{sport} alone
  const parts = pathname.split("/").filter(Boolean);
  return parts.length === 3 && parts[0] === "book";
}

export function BottomNav() {
  const pathname = usePathname();

  // Hide on slot selection and checkout pages
  if (
    HIDDEN_PATHS.some((p) => pathname.startsWith(p)) ||
    isSlotSelectionPage(pathname)
  ) {
    return null;
  }

  const tabs = [
    { href: "/", label: "Home", emoji: "\u{1F3E0}", match: (p: string) => p === "/" },
    { href: "/book", label: "Sports", emoji: "\u{1F3DF}\uFE0F", match: (p: string) => p.startsWith("/book") },
    { href: "/cafe", label: "Cafe", emoji: "\u2615", match: (p: string) => p.startsWith("/cafe") },
    { href: "/dashboard", label: "Account", emoji: "\u{1F464}", match: (p: string) => p === "/dashboard" || p.startsWith("/bookings") || p.startsWith("/profile") || p.startsWith("/referral") || p.startsWith("/rewards") },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-black/95 backdrop-blur-md border-t border-zinc-800">
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
        <ChatNavButton />
      </div>
    </div>
  );
}
