"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelWaitlist } from "@/actions/waitlist";
import { Loader2, X } from "lucide-react";

export function WaitlistCancelButton({ waitlistId }: { waitlistId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleCancel = async () => {
    if (!confirm("Remove yourself from this waitlist?")) return;
    setLoading(true);
    const result = await cancelWaitlist(waitlistId);
    if (result.success) {
      router.refresh();
    }
    setLoading(false);
  };

  return (
    <button
      onClick={handleCancel}
      disabled={loading}
      className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-red-500/50 hover:text-red-400 transition-colors disabled:opacity-50"
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
      Cancel
    </button>
  );
}
