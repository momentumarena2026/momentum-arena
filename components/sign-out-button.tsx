"use client";

import { signOut } from "next-auth/react";

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
