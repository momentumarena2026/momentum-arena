"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmUpiPayment, confirmCashPayment, cancelBooking } from "@/actions/admin-booking";

export function UnconfirmedActions({
  bookingId,
  paymentMethod,
}: {
  bookingId: string;
  paymentMethod: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  const handleConfirm = async () => {
    setLoading("confirm");
    const action = paymentMethod === "CASH" ? confirmCashPayment : confirmUpiPayment;
    const result = await action(bookingId);
    if (result.success) {
      router.refresh();
    } else {
      alert(result.error || "Failed to confirm");
    }
    setLoading(null);
  };

  const handleReject = async () => {
    if (!reason.trim()) return;
    setLoading("reject");
    const result = await cancelBooking(bookingId, reason);
    if (result.success) {
      setShowReject(false);
      setReason("");
      router.refresh();
    } else {
      alert(result.error || "Failed to reject");
    }
    setLoading(null);
  };

  if (showReject) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason"
          className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white placeholder-zinc-500 w-28"
          autoFocus
        />
        <button
          onClick={handleReject}
          disabled={loading === "reject" || !reason.trim()}
          className="px-2 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-500 disabled:opacity-50"
        >
          {loading === "reject" ? "Rejecting..." : "Reject"}
        </button>
        <button
          onClick={() => { setShowReject(false); setReason(""); }}
          className="px-2 py-1 bg-zinc-700 text-white rounded text-xs"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleConfirm}
        disabled={loading === "confirm"}
        className="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-500 disabled:opacity-50"
      >
        {loading === "confirm" ? "..." : "Confirm"}
      </button>
      <button
        onClick={() => setShowReject(true)}
        className="px-2.5 py-1 bg-red-600/20 text-red-400 border border-red-800 rounded text-xs font-medium hover:bg-red-600/30"
      >
        Reject
      </button>
    </div>
  );
}
