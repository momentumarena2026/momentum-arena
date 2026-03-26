"use client";

import { signOut } from "next-auth/react";

export function SignOutButton({
  className,
  redirectTo = "/",
}: {
  className?: string;
  redirectTo?: string;
}) {
  return (
    <button
      onClick={async () => {
        await signOut({ redirect: false });
        window.location.href = redirectTo;
      }}
      className={className || "rounded-md bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"}
    >
      Sign Out
    </button>
  );
}
