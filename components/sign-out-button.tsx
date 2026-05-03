"use client";

import { signOut } from "next-auth/react";
import { trackSignOutClick } from "@/lib/analytics";
import { flush as flushAnalytics, rotateSession } from "@/lib/analytics-session";

export function SignOutButton({
  className,
  redirectTo = "/",
  isAdmin = false,
}: {
  className?: string;
  redirectTo?: string;
  isAdmin?: boolean;
}) {
  return (
    <button
      onClick={async () => {
        trackSignOutClick();
        // Flush before rotating so the sign-out event itself
        // gets attributed to the OUTGOING user.
        await flushAnalytics();
        rotateSession();
        if (isAdmin) {
          // Admin uses separate auth endpoint — clear admin cookie
          await fetch("/api/admin-auth/signout", { method: "POST" });
          window.location.href = "/godmode";
        } else {
          // Customer uses default NextAuth signOut
          await signOut({ redirect: false });
          window.location.href = redirectTo;
        }
      }}
      className={className || "rounded-md bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"}
    >
      Sign Out
    </button>
  );
}
