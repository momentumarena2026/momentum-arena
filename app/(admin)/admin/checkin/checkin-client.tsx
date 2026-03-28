"use client";

import { useState } from "react";
import { markCheckedIn } from "@/actions/checkin";
import { CheckCircle2, Loader2 } from "lucide-react";

interface CheckinClientProps {
  qrToken: string;
  bookingId: string;
}

export function CheckinClient({ qrToken, bookingId }: CheckinClientProps) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleCheckin() {
    setLoading(true);
    setError("");
    const result = await markCheckedIn(qrToken);
    if (result.success) {
      setDone(true);
    } else {
      setError(result.error || "Failed to check in");
    }
    setLoading(false);
  }

  if (done) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
        <CheckCircle2 className="h-6 w-6 text-emerald-400 flex-shrink-0" />
        <div>
          <p className="font-semibold text-emerald-400">Checked In Successfully</p>
          <p className="text-sm text-zinc-400">Guest has been marked as arrived</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      <button
        onClick={handleCheckin}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-4 text-lg transition-colors"
      >
        {loading ? (
          <><Loader2 className="h-5 w-5 animate-spin" /> Checking in...</>
        ) : (
          <><CheckCircle2 className="h-5 w-5" /> Mark as Checked In</>
        )}
      </button>
    </div>
  );
}
