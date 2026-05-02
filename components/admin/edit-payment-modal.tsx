"use client";

import { useEffect, useState } from "react";
import { adminEditPayment } from "@/actions/admin-booking";
import { Loader2, X } from "lucide-react";

/**
 * Edit Payment modal — exposes every payment-row field the admin
 * might want to fix retroactively. Mirrors the create form's payment
 * step in shape so the muscle memory carries over.
 *
 * The modal seeds with the current payment values; only fields the
 * admin touches are sent in the patch (server treats undefined as
 * "leave alone"). Conditional render of gateway-id fields keys off
 * the SELECTED method so the admin can't accidentally orphan a
 * Razorpay id under a Cash booking.
 */

type Method = "CASH" | "UPI_QR" | "RAZORPAY" | "PHONEPE" | "FREE";
type Status =
  | "PENDING"
  | "PARTIAL"
  | "COMPLETED"
  | "REFUNDED"
  | "FAILED";

const METHOD_LABEL: Record<Method, string> = {
  CASH: "Cash",
  UPI_QR: "UPI QR",
  RAZORPAY: "Razorpay",
  PHONEPE: "PhonePe",
  FREE: "Free",
};

const STATUS_LABEL: Record<Status, string> = {
  PENDING: "Pending",
  PARTIAL: "Partial",
  COMPLETED: "Completed",
  REFUNDED: "Refunded",
  FAILED: "Failed",
};

interface EditPaymentModalProps {
  bookingId: string;
  current: {
    method: Method;
    status: Status;
    amount: number;
    isPartialPayment: boolean;
    advanceAmount: number | null;
    razorpayPaymentId: string | null;
    utrNumber: string | null;
  };
  totalAmount: number;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditPaymentModal({
  bookingId,
  current,
  totalAmount,
  isOpen,
  onClose,
  onSuccess,
}: EditPaymentModalProps) {
  const [method, setMethod] = useState<Method>(current.method);
  const [status, setStatus] = useState<Status>(current.status);
  const [totalStr, setTotalStr] = useState(String(totalAmount));
  const [isPartial, setIsPartial] = useState(current.isPartialPayment);
  const [advanceStr, setAdvanceStr] = useState(
    current.advanceAmount === null ? "" : String(current.advanceAmount),
  );
  const [razorpayId, setRazorpayId] = useState(current.razorpayPaymentId ?? "");
  const [utr, setUtr] = useState(current.utrNumber ?? "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed every time the modal is reopened so a closed-and-reopened
  // edit doesn't carry stale typed values from the previous session.
  useEffect(() => {
    if (!isOpen) return;
    setMethod(current.method);
    setStatus(current.status);
    setTotalStr(String(totalAmount));
    setIsPartial(current.isPartialPayment);
    setAdvanceStr(
      current.advanceAmount === null ? "" : String(current.advanceAmount),
    );
    setRazorpayId(current.razorpayPaymentId ?? "");
    setUtr(current.utrNumber ?? "");
    setNote("");
    setError(null);
  }, [isOpen, current, totalAmount]);

  if (!isOpen) return null;

  const parsedTotal = parseInt(totalStr, 10);
  const parsedAdvance = advanceStr.trim().length === 0 ? 0 : parseInt(advanceStr, 10);
  const totalValid = Number.isFinite(parsedTotal) && parsedTotal >= 0;
  const advanceValid =
    !isPartial ||
    (Number.isFinite(parsedAdvance) &&
      parsedAdvance >= 0 &&
      parsedAdvance < parsedTotal);

  const canSave = totalValid && advanceValid && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    // Only include fields whose final value differs from `current` so
    // the audit log entry stays accurate (and so admins don't get
    // "method CASH → CASH" noise in the history).
    const patch: Parameters<typeof adminEditPayment>[1] = {};
    if (method !== current.method) patch.method = method;
    if (status !== current.status) patch.status = status;
    if (parsedTotal !== totalAmount) patch.totalAmount = parsedTotal;
    if (isPartial !== current.isPartialPayment) patch.isPartialPayment = isPartial;
    if (isPartial && parsedAdvance !== (current.advanceAmount ?? 0)) {
      patch.advanceAmount = parsedAdvance;
    }
    if (!isPartial && current.advanceAmount !== null) {
      // toggling off partial — null out the advance explicitly
      patch.advanceAmount = null;
    }
    if (razorpayId !== (current.razorpayPaymentId ?? "")) {
      patch.razorpayPaymentId = razorpayId.trim() || null;
    }
    if (utr !== (current.utrNumber ?? "")) {
      patch.utrNumber = utr.trim() || null;
    }
    if (note.trim().length > 0) patch.note = note.trim();

    const result = await adminEditPayment(bookingId, patch);
    setSaving(false);
    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || "Failed to save");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-hidden
      />
      <div
        className="relative w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h3 className="text-base font-semibold text-white">Edit Payment</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 max-h-[70vh] overflow-y-auto">
          {/* Method */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Method
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["CASH", "UPI_QR", "RAZORPAY", "PHONEPE", "FREE"] as Method[]).map(
                (m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      method === m
                        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                        : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-800"
                    }`}
                  >
                    {METHOD_LABEL[m]}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Status
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["PENDING", "PARTIAL", "COMPLETED", "REFUNDED", "FAILED"] as Status[]).map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      status === s
                        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                        : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-800"
                    }`}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* Total */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Total amount (₹)
            </label>
            <input
              type="number"
              min={0}
              step={1}
              value={totalStr}
              onChange={(e) => setTotalStr(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            />
            {!totalValid && (
              <p className="text-xs text-red-400">
                Enter a non-negative whole number.
              </p>
            )}
          </div>

          {/* Partial advance */}
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={isPartial}
                onChange={(e) => setIsPartial(e.target.checked)}
                className="h-4 w-4 accent-amber-400"
              />
              <span className="text-sm font-medium text-white">
                Partial payment (advance + remainder)
              </span>
            </label>
            {isPartial && (
              <div className="pl-7 space-y-1">
                <label className="text-[11px] uppercase tracking-wider text-zinc-500">
                  Advance paid (₹)
                </label>
                <input
                  type="number"
                  min={0}
                  max={Math.max(parsedTotal - 1, 0)}
                  step={1}
                  value={advanceStr}
                  onChange={(e) => setAdvanceStr(e.target.value)}
                  className="w-40 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white focus:border-amber-400 focus:outline-none"
                />
                {!advanceValid && (
                  <p className="text-xs text-red-400">
                    Advance must be ≥ 0 and less than the total.
                  </p>
                )}
                {advanceValid && (
                  <p className="text-xs text-amber-300">
                    Remaining at venue:{" "}
                    <span className="font-semibold">
                      ₹{(parsedTotal - parsedAdvance).toLocaleString("en-IN")}
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Gateway IDs — only relevant for the matching method */}
          {(method === "RAZORPAY" || current.razorpayPaymentId) && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                Razorpay payment ID
              </label>
              <input
                type="text"
                value={razorpayId}
                onChange={(e) => setRazorpayId(e.target.value)}
                placeholder="pay_…"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-white focus:border-emerald-400 focus:outline-none"
              />
            </div>
          )}
          {(method === "UPI_QR" || current.utrNumber) && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                UTR / reference
              </label>
              <input
                type="text"
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                placeholder="12-digit UTR"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-white focus:border-emerald-400 focus:outline-none"
              />
            </div>
          )}

          {/* Audit note */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Note (optional)
            </label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. customer paid via Razorpay, gateway callback failed, recorded manually"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Payment
          </button>
        </div>
      </div>
    </div>
  );
}
