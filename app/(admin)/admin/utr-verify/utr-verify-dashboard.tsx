"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { verifyBookingUtr, verifyCafeUtr, rejectUtr } from "@/actions/upi-payment";

interface PaymentItem {
  id: string;
  amount: number;
  utrNumber: string | null;
  utrSubmittedAt: string | null;
  utrExpiresAt: string | null;
  createdAt: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  details: string;
  type: "booking" | "cafe";
}

function formatPrice(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function expiresIn(dateStr: string | null) {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function UtrVerifyDashboard({
  initialData,
}: {
  initialData: { bookingPayments: unknown[]; cafePayments: unknown[] };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"booking" | "cafe">("booking");
  const [loading, setLoading] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [, setTick] = useState(0);

  // Auto-refresh every 15s
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(interval);
  }, [router]);

  // Tick for countdown updates
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Transform data
  const bookingItems: PaymentItem[] = (
    initialData.bookingPayments as Array<{
      id: string;
      amount: number;
      utrNumber: string | null;
      utrSubmittedAt: string | null;
      utrExpiresAt: string | null;
      createdAt: string;
      booking: {
        user: { name: string | null; email: string | null; phone: string | null };
        courtConfig: { sport: string; label: string; size: string };
        date: string;
        slots: { startHour: number }[];
      };
    }>
  ).map((p) => ({
    id: p.id,
    amount: p.amount,
    utrNumber: p.utrNumber,
    utrSubmittedAt: p.utrSubmittedAt,
    utrExpiresAt: p.utrExpiresAt,
    createdAt: p.createdAt,
    customerName: p.booking.user?.name || "Guest",
    customerEmail: p.booking.user?.email || "",
    customerPhone: p.booking.user?.phone || "",
    details: `${p.booking.courtConfig.sport} — ${p.booking.courtConfig.label} (${p.booking.courtConfig.size}) | ${new Date(p.booking.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} | ${p.booking.slots.map((s: { startHour: number }) => `${s.startHour > 12 ? s.startHour - 12 : s.startHour}:00 ${s.startHour >= 12 ? "PM" : "AM"}`).join(", ")}`,
    type: "booking" as const,
  }));

  const cafeItems: PaymentItem[] = (
    initialData.cafePayments as Array<{
      id: string;
      amount: number;
      utrNumber: string | null;
      utrSubmittedAt: string | null;
      utrExpiresAt: string | null;
      createdAt?: string;
      order: {
        orderNumber: string;
        guestName: string | null;
        user: { name: string | null; email: string | null; phone: string | null } | null;
        items: { itemName: string; quantity: number }[];
      };
    }>
  ).map((p) => ({
    id: p.id,
    amount: p.amount,
    utrNumber: p.utrNumber,
    utrSubmittedAt: p.utrSubmittedAt,
    utrExpiresAt: p.utrExpiresAt,
    createdAt: p.createdAt || p.utrSubmittedAt || "",
    customerName: p.order.user?.name || p.order.guestName || "Guest",
    customerEmail: p.order.user?.email || "",
    customerPhone: p.order.user?.phone || "",
    details: `Order #${p.order.orderNumber} — ${p.order.items.map((i: { itemName: string; quantity: number }) => `${i.quantity}x ${i.itemName}`).join(", ")}`,
    type: "cafe" as const,
  }));

  const items = tab === "booking" ? bookingItems : cafeItems;

  async function handleVerify(item: PaymentItem) {
    setLoading(item.id);
    try {
      if (item.type === "booking") {
        await verifyBookingUtr(item.id, "admin");
      } else {
        await verifyCafeUtr(item.id, "admin");
      }
      router.refresh();
    } catch {
      alert("Failed to verify");
    }
    setLoading(null);
  }

  async function handleReject(id: string) {
    if (!rejectReason.trim()) return;
    setLoading(id);
    try {
      await rejectUtr(id, "admin", rejectReason);
      setRejectId(null);
      setRejectReason("");
      router.refresh();
    } catch {
      alert("Failed to reject");
    }
    setLoading(null);
  }

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Pending Sports</p>
          <p className="text-2xl font-bold text-amber-400 mt-1">{bookingItems.length}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Pending Cafe</p>
          <p className="text-2xl font-bold text-amber-400 mt-1">{cafeItems.length}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Total Pending</p>
          <p className="text-2xl font-bold text-white mt-1">{bookingItems.length + cafeItems.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(["booking", "cafe"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === t
                ? "bg-emerald-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {t === "booking" ? `Sports (${bookingItems.length})` : `Cafe (${cafeItems.length})`}
          </button>
        ))}
      </div>

      {/* List */}
      {items.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          No pending payment verifications
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const expiry = expiresIn(item.utrExpiresAt);
            const isExpired = expiry === "Expired";

            return (
              <div
                key={item.id}
                className={`bg-zinc-900 border rounded-xl p-5 ${
                  isExpired ? "border-red-800/50 opacity-60" : "border-zinc-800"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Amount + UTR */}
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-lg font-bold text-white">
                        {formatPrice(item.amount)}
                      </span>
                      {item.utrNumber ? (
                        <code className="text-sm font-mono font-bold text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-lg">
                          UTR: {item.utrNumber}
                        </code>
                      ) : (
                        <span className="text-xs font-medium text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-lg">
                          Awaiting Screenshot
                        </span>
                      )}
                    </div>

                    {/* Customer */}
                    <p className="text-sm text-white font-medium">
                      {item.customerName}
                      {item.customerPhone && (
                        <span className="text-zinc-500 ml-2">{item.customerPhone}</span>
                      )}
                      {item.customerEmail && (
                        <span className="text-zinc-500 ml-2">{item.customerEmail}</span>
                      )}
                    </p>

                    {/* Details */}
                    <p className="text-sm text-zinc-400 mt-1">{item.details}</p>

                    {/* Time info */}
                    <div className="flex items-center gap-4 mt-2 text-xs">
                      <span className="text-zinc-500">
                        {item.utrSubmittedAt
                          ? `Submitted ${timeAgo(item.utrSubmittedAt)}`
                          : `Created ${timeAgo(item.createdAt)}`}
                      </span>
                      {expiry && (
                        <span className={isExpired ? "text-red-400" : "text-amber-400"}>
                          {isExpired ? "Expired" : `Expires in ${expiry}`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 shrink-0">
                    {rejectId === item.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Rejection reason"
                          className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 w-48"
                          autoFocus
                        />
                        <button
                          onClick={() => handleReject(item.id)}
                          disabled={loading === item.id}
                          className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-500 disabled:opacity-50"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => { setRejectId(null); setRejectReason(""); }}
                          className="px-3 py-2 bg-zinc-700 text-white rounded-lg text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => handleVerify(item)}
                          disabled={loading === item.id || isExpired}
                          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 flex items-center gap-1"
                        >
                          {loading === item.id ? "..." : "Verify ✓"}
                        </button>
                        <button
                          onClick={() => setRejectId(item.id)}
                          disabled={loading === item.id}
                          className="px-4 py-2 bg-red-600/20 text-red-400 border border-red-800 rounded-lg text-sm font-medium hover:bg-red-600/30 disabled:opacity-50"
                        >
                          Reject ✗
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
