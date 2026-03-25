"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  confirmCashPayment,
  confirmUpiPayment,
  cancelBooking,
  refundBooking,
} from "@/actions/admin-booking";
import {
  CheckCircle2,
  RotateCcw,
  Loader2,
  Pencil,
  Clock,
  XCircle,
} from "lucide-react";
import { EditSlotsModal } from "@/components/admin/edit-slots-modal";
import { EditBookingModal } from "@/components/admin/edit-booking-modal";

interface AdminBookingActionsProps {
  bookingId: string;
  bookingStatus: string;
  paymentMethod: string | null;
  paymentStatus: string | null;
  paymentAmount: number | null;
  isAdminCreated: boolean;
  courtConfigId: string;
  date: string;
  currentSlots: number[];
  sport: string;
  courtConfigs: {
    id: string;
    label: string;
    size: string;
    position: string;
  }[];
}

export function AdminBookingActions({
  bookingId,
  bookingStatus,
  paymentMethod,
  paymentStatus,
  paymentAmount,
  isAdminCreated,
  courtConfigId,
  date,
  currentSlots,
  sport,
  courtConfigs,
}: AdminBookingActionsProps) {
  const router = useRouter();
  const [processing, setProcessing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Cancel state
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Refund state
  const [showRefund, setShowRefund] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<
    "ORIGINAL" | "CASH" | "UPI" | "BANK_TRANSFER"
  >("ORIGINAL");
  const [refundType, setRefundType] = useState<"full" | "partial">("full");
  const [partialAmount, setPartialAmount] = useState("");

  // Edit state
  const [showEditSlots, setShowEditSlots] = useState(false);
  const [showEditBooking, setShowEditBooking] = useState(false);

  const canEditSlots = bookingStatus === "CONFIRMED";
  const canEditBooking = bookingStatus === "CONFIRMED" && isAdminCreated;

  const canConfirmPayment =
    bookingStatus === "CONFIRMED" &&
    paymentStatus === "PENDING" &&
    (paymentMethod === "CASH" || paymentMethod === "UPI_QR");

  const canCancel =
    bookingStatus === "CONFIRMED" || bookingStatus === "LOCKED";

  const canRefund =
    bookingStatus === "CONFIRMED" &&
    paymentStatus === "COMPLETED" &&
    paymentMethod !== "FREE";

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

  const handleCancel = async () => {
    if (!cancelReason.trim()) {
      setError("Please provide a cancellation reason");
      return;
    }
    setProcessing("cancel");
    setError(null);
    const result = await cancelBooking(bookingId, cancelReason);
    if (result.success) {
      setSuccessMsg("Booking cancelled. Slots are now available.");
      setShowCancel(false);
      setCancelReason("");
      router.refresh();
    } else {
      setError(result.error || "Failed to cancel");
    }
    setProcessing(null);
  };

  const handleRefund = async () => {
    if (!refundReason.trim()) {
      setError("Please provide a refund reason");
      return;
    }

    const refundAmount =
      refundType === "partial" && partialAmount
        ? Math.round(parseFloat(partialAmount) * 100)
        : undefined;

    if (refundType === "partial") {
      if (!partialAmount || parseFloat(partialAmount) <= 0) {
        setError("Please enter a valid refund amount");
        return;
      }
      if (paymentAmount && refundAmount && refundAmount > paymentAmount) {
        setError("Refund amount cannot exceed payment amount");
        return;
      }
    }

    setProcessing("refund");
    setError(null);
    const result = await refundBooking(
      bookingId,
      refundReason,
      refundMethod,
      refundAmount
    );
    if (result.success) {
      setSuccessMsg("Booking refunded and cancelled.");
      setShowRefund(false);
      setRefundReason("");
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

        {canEditSlots && (
          <button
            onClick={() => setShowEditSlots(true)}
            className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-400 hover:bg-blue-500/20"
          >
            <Clock className="h-4 w-4" />
            Edit Slots
          </button>
        )}

        {canEditBooking && (
          <button
            onClick={() => setShowEditBooking(true)}
            className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/20"
          >
            <Pencil className="h-4 w-4" />
            Edit Booking
          </button>
        )}

        {canCancel && !showCancel && !showRefund && (
          <button
            onClick={() => setShowCancel(true)}
            className="flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-2 text-sm font-medium text-orange-400 hover:bg-orange-500/20"
          >
            <XCircle className="h-4 w-4" />
            Cancel Booking
          </button>
        )}

        {canRefund && !showRefund && !showCancel && (
          <button
            onClick={() => setShowRefund(true)}
            className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20"
          >
            <RotateCcw className="h-4 w-4" />
            Refund & Cancel
          </button>
        )}
      </div>

      {/* Cancel Booking Form */}
      {showCancel && (
        <div className="space-y-3 rounded-lg border border-orange-500/20 bg-orange-500/5 p-4">
          <p className="text-sm font-medium text-orange-400">
            Cancel this booking? Slots will be freed immediately.
          </p>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Reason for cancellation (required)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-3 text-sm text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              disabled={processing !== null}
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {processing === "cancel" ? (
                <Loader2 className="h-4 w-4 animate-spin inline mr-1" />
              ) : null}
              Confirm Cancel
            </button>
            <button
              onClick={() => {
                setShowCancel(false);
                setCancelReason("");
                setError(null);
              }}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
            >
              Go Back
            </button>
          </div>
        </div>
      )}

      {/* Refund & Cancel Form */}
      {showRefund && (
        <div className="space-y-4 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-sm font-medium text-red-400">
            Refund and cancel this booking? Slots will be freed.
          </p>

          {/* Refund Type */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Refund Type
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => setRefundType("full")}
                className={`rounded-lg px-4 py-2 text-sm font-medium border transition-colors ${
                  refundType === "full"
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                    : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                Full Refund
                {paymentAmount
                  ? ` (₹${(paymentAmount / 100).toLocaleString()})`
                  : ""}
              </button>
              <button
                onClick={() => setRefundType("partial")}
                className={`rounded-lg px-4 py-2 text-sm font-medium border transition-colors ${
                  refundType === "partial"
                    ? "border-amber-500 bg-amber-500/10 text-amber-400"
                    : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                Partial Refund
              </button>
            </div>
          </div>

          {/* Partial Amount */}
          {refundType === "partial" && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Refund Amount (₹)
              </label>
              <input
                type="number"
                value={partialAmount}
                onChange={(e) => setPartialAmount(e.target.value)}
                placeholder={`Max ₹${paymentAmount ? (paymentAmount / 100).toLocaleString() : "0"}`}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-3 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none"
                min="1"
                max={paymentAmount ? paymentAmount / 100 : undefined}
              />
            </div>
          )}

          {/* Refund Method */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Refund Method
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  {
                    key: "ORIGINAL" as const,
                    label: "Original Payment Method",
                  },
                  { key: "CASH" as const, label: "Cash" },
                  { key: "UPI" as const, label: "UPI Transfer" },
                  { key: "BANK_TRANSFER" as const, label: "Bank Transfer" },
                ] as const
              ).map((method) => (
                <button
                  key={method.key}
                  onClick={() => setRefundMethod(method.key)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium border transition-colors ${
                    refundMethod === method.key
                      ? "border-red-500 bg-red-500/10 text-red-400"
                      : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {method.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reason */}
          <textarea
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            placeholder="Refund reason (required)"
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
              Process Refund
            </button>
            <button
              onClick={() => {
                setShowRefund(false);
                setRefundReason("");
                setRefundType("full");
                setPartialAmount("");
                setRefundMethod("ORIGINAL");
                setError(null);
              }}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
            >
              Go Back
            </button>
          </div>
        </div>
      )}

      <EditSlotsModal
        bookingId={bookingId}
        courtConfigId={courtConfigId}
        date={date}
        currentSlots={currentSlots}
        isOpen={showEditSlots}
        onClose={() => setShowEditSlots(false)}
        onSuccess={() => {
          setShowEditSlots(false);
          setSuccessMsg("Slots updated successfully!");
          router.refresh();
        }}
      />

      <EditBookingModal
        bookingId={bookingId}
        currentCourtConfigId={courtConfigId}
        currentDate={date}
        currentSlots={currentSlots}
        sport={sport}
        courtConfigs={courtConfigs}
        isOpen={showEditBooking}
        onClose={() => setShowEditBooking(false)}
        onSuccess={() => {
          setShowEditBooking(false);
          setSuccessMsg("Booking updated successfully!");
          router.refresh();
        }}
      />
    </div>
  );
}
