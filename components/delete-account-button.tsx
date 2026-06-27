"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Trash2 } from "lucide-react";
import { deleteMyAccount } from "@/actions/account";

/**
 * In-app account deletion (App Store / Play requirement). Two-step: the
 * trigger reveals an inline confirm panel; confirming soft-deletes +
 * anonymizes the account server-side (see softDeleteAccount), then signs out.
 */
export function DeleteAccountButton({ className }: { className?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);
    const res = await deleteMyAccount();
    if (res.success) {
      await signOut({ redirect: false });
      window.location.href = "/";
    } else {
      setError(res.error || "Couldn't delete your account.");
      setLoading(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className={
          className ||
          "w-full flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-500 transition-all hover:border-red-500/30 hover:bg-red-500/5 hover:text-red-400"
        }
      >
        <Trash2 className="h-4 w-4" />
        Delete account
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
      <p className="text-sm text-zinc-300">
        This permanently deletes your account and cancels any upcoming
        bookings. Your name, phone and email are removed. This can&apos;t be
        undone.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => setConfirming(false)}
          disabled={loading}
          className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-60"
        >
          {loading ? "Deleting…" : "Delete account"}
        </button>
      </div>
    </div>
  );
}
