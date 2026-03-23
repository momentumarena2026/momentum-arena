"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmCashPayment, confirmUpiPayment, refundBooking } from "@/actions/admin-booking";
import { CheckCircle2, RotateCcw, Loader2 } from "lucide-react";

interface AdminBookingActionsProps {
  bookingId: string;
  bookingStatus: string;
  paymentMethod: string | null;
  paymentStatus: string | null;
}

export function AdminBookingActions({
  bookingId,
  bookingStatus,
  paymentMethod,
  paymentStatus,
}: AdminBookingActionsProps) {
  const router = useRouter();
  const [processing, setProcessing] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [showRefund, setShowRefund] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const canConfirmPayment =
    bookingStatus === "CONFIRMED" &&
    paymentStatus === "PENDING" &&
    (paymentMethod === "CASH" || paymentMethod === "UPI_QR");

  const canRefund =
    bookingStatus === "CONFIRMED" && paymentStatus !== "REFUNDED";

  const handleConfirmPayment = async () => {
    setProcessing("confirm");
    setError(null);

    const action =
      paymentMethod === "CASH" ? confirmCashPayment : confirmUpiPayment;
    const result = await action(bookingId);

    if (result.success) {
      setSuccessMsg("Payment confirmed!");
      router.refresh();
    } else {
      setError(result.error || "Failed to confirm");
    }
    setProcessing(null);
  };

  const handleRefund = async () => {
    if (!refundReason.trim()) {
      setError("Please provide a refund reason");
      return;
    }

    setProcessing("refund");
    setError(null);

    const result = await refundBooking(bookingId, refundReason);

    if (result.success) {
      setSuccessMsg("Booking refunded");
      setShowRefund(false);
      router.refresh();
    } else {
      setError(result.error || "Failed to refund");
    }
    setProcessing(null);
  };

  if (bookingStatus === "CANCELLED") return null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
      <h2 className="text-sm font-medium text-zinc-500">Admin Actions</h2>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
          {successMsg}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {canConfirmPayment && (
          <button
            onClick={handleConfirmPayment}
            disabled={processing !== null}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {processing === "confirm" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Confirm {paymentMethod === "CASH" ? "Cash" : "UPI"} Payment
          </button>
        )}

        {canRefund && !showRefund && (
          <button
            onClick={() => setShowRefund(true)}
            className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20"
          >
            <RotateCcw className="h-4 w-4" />
            Refund Booking
          </button>
        )}
      </div>

      {showRefund && (
        <div className="space-y-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-sm font-medium text-red-400">
            Refund this booking?
          </p>
          <textarea
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            placeholder="Enter refund reason (required)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-3 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={handleRefund}
              disabled={processing !== null}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {processing === "refund" ? (
                <Loader2 className="h-4 w-4 animate-spin inline mr-1" />
              ) : null}
              Confirm Refund
            </button>
            <button
              onClick={() => {
                setShowRefund(false);
                setRefundReason("");
              }}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
