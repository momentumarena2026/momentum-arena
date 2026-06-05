"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateCafeOrderStatus,
  cancelCafeOrder,
  addItemsToCafeOrder,
  cancelItemsFromCafeOrder,
  updateCafeItemQuantity,
  updateCafePayment,
  addCafePaymentSplit,
  removeCafePaymentSplit,
} from "@/actions/admin-cafe-orders";
import {
  CafeOrderStatus,
  CafeItemCategory,
  PaymentMethod,
  PaymentStatus,
} from "@prisma/client";
import {
  ChefHat,
  Bell,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  Minus,
  Trash2,
  Clock,
  History,
  Search,
  Wallet,
  CreditCard,
  Receipt,
} from "lucide-react";
import { formatPrice } from "@/lib/pricing";

interface OrderItem {
  id: string;
  cafeItemId: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  isVeg: boolean;
}

interface AvailableItem {
  id: string;
  name: string;
  category: CafeItemCategory;
  price: number;
  isVeg: boolean;
}

interface HistoryEntry {
  id: string;
  editType: string;
  adminUsername: string;
  note: string | null;
  previousAmount: number | null;
  newAmount: number | null;
  createdAt: string;
}

const NEXT_STATUS: Partial<
  Record<CafeOrderStatus, { status: CafeOrderStatus; label: string; icon: typeof ChefHat; color: string }>
> = {
  PENDING: { status: "PREPARING", label: "Start Preparing", icon: ChefHat, color: "bg-blue-600 hover:bg-blue-700" },
  PREPARING: { status: "READY", label: "Mark Ready", icon: Bell, color: "bg-purple-600 hover:bg-purple-700" },
  READY: { status: "COMPLETED", label: "Complete", icon: CheckCircle2, color: "bg-emerald-600 hover:bg-emerald-700" },
};

const EDIT_TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  ORDER_CREATED: { color: "text-emerald-400", label: "Order Created" },
  STATUS_CHANGED: { color: "text-blue-400", label: "Status Changed" },
  ITEMS_ADDED: { color: "text-cyan-400", label: "Items Added" },
  ITEMS_REMOVED: { color: "text-orange-400", label: "Items Removed" },
  QUANTITY_CHANGED: { color: "text-yellow-400", label: "Quantity Changed" },
  ORDER_CANCELLED: { color: "text-red-400", label: "Order Cancelled" },
  PAYMENT_EDITED: { color: "text-fuchsia-400", label: "Payment Edited" },
  PAYMENT_SPLIT_ADDED: { color: "text-fuchsia-400", label: "Split Added" },
  PAYMENT_SPLIT_REMOVED: { color: "text-fuchsia-400", label: "Split Removed" },
};

// Payment-method options surfaced in the admin payment editor +
// split form. PHONEPE is admin-rare for cafe; surface it anyway so
// the operator can reconcile an external PhonePe transfer when
// needed.
const PAYMENT_METHOD_OPTIONS: PaymentMethod[] = [
  "CASH",
  "UPI_QR",
  "RAZORPAY",
  "PHONEPE",
  "FREE",
];

const PAYMENT_STATUS_OPTIONS: PaymentStatus[] = [
  "PENDING",
  "COMPLETED",
  "FAILED",
  "REFUNDED",
];

export interface PaymentSplit {
  id: string;
  method: PaymentMethod;
  amount: number;
  utrNumber: string | null;
  note: string | null;
  createdAt: string;
}

export interface PaymentInfo {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  utrNumber: string | null;
  splits: PaymentSplit[];
}

export function CafeOrderActions({
  order,
  availableItems,
  editHistory,
  payment,
}: {
  order: {
    id: string;
    status: CafeOrderStatus;
    totalAmount: number;
    items: OrderItem[];
  };
  availableItems: AvailableItem[];
  editHistory: HistoryEntry[];
  payment: PaymentInfo | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [showAddItems, setShowAddItems] = useState(false);
  const [addItemSearch, setAddItemSearch] = useState("");
  const [itemsToAdd, setItemsToAdd] = useState<
    { cafeItemId: string; name: string; quantity: number }[]
  >([]);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);

  // ─── Payment editor + splits ───
  const [showPaymentEdit, setShowPaymentEdit] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    method: payment?.method ?? "CASH",
    status: payment?.status ?? "PENDING",
    amount: payment?.amount?.toString() ?? "",
    utrNumber: payment?.utrNumber ?? "",
  });
  const [showSplitAdd, setShowSplitAdd] = useState(false);
  const [splitForm, setSplitForm] = useState({
    method: "CASH" as PaymentMethod,
    amount: "",
    utrNumber: "",
    note: "",
  });
  const paidSoFar = payment
    ? payment.splits.length > 0
      ? payment.splits.reduce((s, sp) => s + sp.amount, 0)
      : payment.status === "COMPLETED"
        ? payment.amount
        : 0
    : 0;
  const remainingDue = Math.max(0, order.totalAmount - paidSoFar);

  const isEditable =
    order.status === "PENDING" || order.status === "PREPARING";
  const nextStatusInfo = NEXT_STATUS[order.status];

  const handleStatusChange = async () => {
    if (!nextStatusInfo) return;
    setLoading(true);
    const result = await updateCafeOrderStatus(order.id, nextStatusInfo.status);
    if (!result.success) alert(result.error);
    setLoading(false);
    router.refresh();
  };

  const handleCancel = async () => {
    if (!cancelReason.trim()) {
      alert("Please provide a reason");
      return;
    }
    setLoading(true);
    const result = await cancelCafeOrder(order.id, cancelReason);
    if (!result.success) alert(result.error);
    setLoading(false);
    setShowCancel(false);
    router.refresh();
  };

  const handlePaymentEdit = async () => {
    if (!payment) return;
    const amt = paymentForm.amount.trim();
    const parsedAmount = amt === "" ? undefined : Number(amt);
    if (parsedAmount !== undefined && (Number.isNaN(parsedAmount) || parsedAmount < 0)) {
      alert("Amount must be a non-negative number");
      return;
    }
    setLoading(true);
    const result = await updateCafePayment(order.id, {
      method: paymentForm.method as PaymentMethod,
      status: paymentForm.status as PaymentStatus,
      amount: parsedAmount,
      utrNumber: paymentForm.utrNumber.trim() || null,
    });
    if (!result.success) alert(result.error);
    setLoading(false);
    setShowPaymentEdit(false);
    router.refresh();
  };

  const handleAddSplit = async () => {
    const amt = Number(splitForm.amount.trim());
    if (Number.isNaN(amt) || amt <= 0) {
      alert("Split amount must be a positive number");
      return;
    }
    setLoading(true);
    const result = await addCafePaymentSplit(order.id, {
      method: splitForm.method,
      amount: amt,
      utrNumber: splitForm.utrNumber.trim() || undefined,
      note: splitForm.note.trim() || undefined,
    });
    if (!result.success) {
      alert(result.error);
    } else {
      setSplitForm({ method: "CASH", amount: "", utrNumber: "", note: "" });
      setShowSplitAdd(false);
    }
    setLoading(false);
    router.refresh();
  };

  const handleRemoveSplit = async (splitId: string) => {
    if (!confirm("Remove this split payment?")) return;
    setLoading(true);
    const result = await removeCafePaymentSplit(order.id, splitId);
    if (!result.success) alert(result.error);
    setLoading(false);
    router.refresh();
  };

  const handleRemoveItem = async (orderItemId: string) => {
    if (!confirm("Remove this item from the order?")) return;
    setUpdatingItemId(orderItemId);
    const result = await cancelItemsFromCafeOrder(order.id, [orderItemId]);
    if (!result.success) alert(result.error);
    setUpdatingItemId(null);
    router.refresh();
  };

  const handleQuantityChange = async (
    orderItemId: string,
    newQuantity: number
  ) => {
    if (newQuantity < 1) return;
    setUpdatingItemId(orderItemId);
    const result = await updateCafeItemQuantity(
      order.id,
      orderItemId,
      newQuantity
    );
    if (!result.success) alert(result.error);
    setUpdatingItemId(null);
    router.refresh();
  };

  const handleAddItems = async () => {
    if (itemsToAdd.length === 0) return;
    setLoading(true);
    const result = await addItemsToCafeOrder(
      order.id,
      itemsToAdd.map((i) => ({
        cafeItemId: i.cafeItemId,
        quantity: i.quantity,
      }))
    );
    if (!result.success) {
      alert(result.error);
    } else {
      setItemsToAdd([]);
      setShowAddItems(false);
    }
    setLoading(false);
    router.refresh();
  };

  const addToNewItems = (item: AvailableItem) => {
    setItemsToAdd((prev) => {
      const existing = prev.find((i) => i.cafeItemId === item.id);
      if (existing) {
        return prev.map((i) =>
          i.cafeItemId === item.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { cafeItemId: item.id, name: item.name, quantity: 1 }];
    });
  };

  const filteredAvailable = addItemSearch
    ? availableItems.filter((i) =>
        i.name.toLowerCase().includes(addItemSearch.toLowerCase())
      )
    : availableItems;

  return (
    <div className="space-y-4">
      {/* Status actions */}
      {(nextStatusInfo || order.status !== "CANCELLED") && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-xs font-medium text-zinc-500 uppercase mb-3">
            Actions
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            {nextStatusInfo && (
              <button
                onClick={handleStatusChange}
                disabled={loading}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white ${nextStatusInfo.color} disabled:opacity-50`}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <nextStatusInfo.icon className="h-4 w-4" />
                )}
                {nextStatusInfo.label}
              </button>
            )}
            {order.status !== "CANCELLED" && order.status !== "COMPLETED" && (
              <button
                onClick={() => setShowCancel(!showCancel)}
                className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20"
              >
                <XCircle className="h-4 w-4" />
                Cancel Order
              </button>
            )}
          </div>

          {showCancel && (
            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason for cancellation"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm text-white placeholder-zinc-500"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCancel}
                  disabled={loading}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Confirm Cancel
                </button>
                <button
                  onClick={() => setShowCancel(false)}
                  className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-700"
                >
                  Nevermind
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Payment editor + splits — admin reconciliation surface.
          Available regardless of order status so a paid-but-not-yet-
          completed order can be reconciled, and a refund can be
          recorded on a CANCELLED order. */}
      {payment ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-zinc-500 uppercase">
              Payment
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setShowPaymentEdit((p) => !p);
                  setShowSplitAdd(false);
                }}
                className="flex items-center gap-1 text-xs text-fuchsia-400 hover:text-fuchsia-300"
              >
                <Wallet className="h-3 w-3" />
                {showPaymentEdit ? "Close" : "Edit Payment"}
              </button>
              <button
                onClick={() => {
                  setShowSplitAdd((p) => !p);
                  setShowPaymentEdit(false);
                }}
                className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300"
              >
                <CreditCard className="h-3 w-3" />
                {showSplitAdd ? "Close" : "Add Split"}
              </button>
            </div>
          </div>

          {/* Summary line */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                {payment.method.replace("_", " ")} · {payment.status}
              </p>
              {payment.utrNumber ? (
                <p className="text-[11px] text-zinc-500">
                  UTR {payment.utrNumber}
                </p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-emerald-400">
                {formatPrice(payment.amount)}
              </p>
              <p className="text-[11px] text-zinc-500">
                {paidSoFar > 0
                  ? `Paid ${formatPrice(paidSoFar)} of ${formatPrice(order.totalAmount)}`
                  : `Due ${formatPrice(order.totalAmount)}`}
              </p>
            </div>
          </div>

          {/* Split-payment rows */}
          {payment.splits.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                Splits
              </p>
              {payment.splits.map((sp) => (
                <div
                  key={sp.id}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Receipt className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-white">
                        {sp.method.replace("_", " ")} ·{" "}
                        <span className="font-medium text-emerald-400">
                          {formatPrice(sp.amount)}
                        </span>
                      </p>
                      {sp.utrNumber || sp.note ? (
                        <p className="text-[10px] text-zinc-500 truncate">
                          {sp.utrNumber ? `UTR ${sp.utrNumber}` : ""}
                          {sp.utrNumber && sp.note ? " · " : ""}
                          {sp.note ?? ""}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveSplit(sp.id)}
                    className="text-[10px] text-red-400 hover:text-red-300 shrink-0"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <p className="text-[10px] text-zinc-500 text-right">
                {remainingDue > 0
                  ? `Remaining due ${formatPrice(remainingDue)}`
                  : "Fully settled"}
              </p>
            </div>
          ) : null}

          {/* Edit payment inline form */}
          {showPaymentEdit ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 p-3">
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">
                  Method
                </span>
                <select
                  value={paymentForm.method}
                  onChange={(e) =>
                    setPaymentForm((p) => ({ ...p, method: e.target.value as PaymentMethod }))
                  }
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                >
                  {PAYMENT_METHOD_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">
                  Status
                </span>
                <select
                  value={paymentForm.status}
                  onChange={(e) =>
                    setPaymentForm((p) => ({ ...p, status: e.target.value as PaymentStatus }))
                  }
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                >
                  {PAYMENT_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">
                  Amount (₹)
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={(e) =>
                    setPaymentForm((p) => ({ ...p, amount: e.target.value }))
                  }
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">
                  UTR / reference
                </span>
                <input
                  type="text"
                  value={paymentForm.utrNumber}
                  onChange={(e) =>
                    setPaymentForm((p) => ({ ...p, utrNumber: e.target.value }))
                  }
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                />
              </label>
              <div className="sm:col-span-2 flex items-center gap-2 pt-1">
                <button
                  onClick={handlePaymentEdit}
                  disabled={loading}
                  className="rounded-md bg-fuchsia-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-fuchsia-700 disabled:opacity-50"
                >
                  {loading ? "Saving…" : "Save Payment"}
                </button>
                <button
                  onClick={() => setShowPaymentEdit(false)}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {/* Add-split inline form */}
          {showSplitAdd ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">
                  Method
                </span>
                <select
                  value={splitForm.method}
                  onChange={(e) =>
                    setSplitForm((p) => ({ ...p, method: e.target.value as PaymentMethod }))
                  }
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                >
                  {PAYMENT_METHOD_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">
                  Amount (₹)
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={splitForm.amount}
                  onChange={(e) =>
                    setSplitForm((p) => ({ ...p, amount: e.target.value }))
                  }
                  placeholder={
                    remainingDue > 0 ? `Suggest ${remainingDue}` : "0"
                  }
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">
                  UTR / reference{" "}
                  <span className="text-zinc-600 normal-case">— optional</span>
                </span>
                <input
                  type="text"
                  value={splitForm.utrNumber}
                  onChange={(e) =>
                    setSplitForm((p) => ({ ...p, utrNumber: e.target.value }))
                  }
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">
                  Note{" "}
                  <span className="text-zinc-600 normal-case">— optional</span>
                </span>
                <input
                  type="text"
                  value={splitForm.note}
                  onChange={(e) =>
                    setSplitForm((p) => ({ ...p, note: e.target.value }))
                  }
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                />
              </label>
              <div className="sm:col-span-2 flex items-center gap-2 pt-1">
                <button
                  onClick={handleAddSplit}
                  disabled={loading}
                  className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  {loading ? "Adding…" : "Record Split"}
                </button>
                <button
                  onClick={() => setShowSplitAdd(false)}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Edit order items (only when PENDING or PREPARING) */}
      {isEditable && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-zinc-500 uppercase">
              Edit Order Items
            </h3>
            <button
              onClick={() => setShowAddItems(!showAddItems)}
              className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
            >
              <Plus className="h-3 w-3" />
              Add Items
            </button>
          </div>

          {/* Current items with edit controls */}
          <div className="space-y-2">
            {order.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className={`inline-block h-2 w-2 rounded-sm flex-shrink-0 ${
                      item.isVeg ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <span className="text-sm text-white truncate">
                    {item.itemName}
                  </span>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <button
                    onClick={() =>
                      handleQuantityChange(item.id, item.quantity - 1)
                    }
                    disabled={
                      item.quantity <= 1 || updatingItemId === item.id
                    }
                    className="rounded p-0.5 text-zinc-500 hover:text-white disabled:opacity-30"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-5 text-center text-sm font-medium text-white">
                    {updatingItemId === item.id ? (
                      <Loader2 className="h-3 w-3 animate-spin inline" />
                    ) : (
                      item.quantity
                    )}
                  </span>
                  <button
                    onClick={() =>
                      handleQuantityChange(item.id, item.quantity + 1)
                    }
                    disabled={updatingItemId === item.id}
                    className="rounded p-0.5 text-zinc-500 hover:text-white disabled:opacity-30"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <span className="w-16 text-right text-xs text-zinc-400">
                    {formatPrice(item.totalPrice)}
                  </span>
                  <button
                    onClick={() => handleRemoveItem(item.id)}
                    disabled={updatingItemId === item.id}
                    className="rounded p-1 text-zinc-600 hover:text-red-400 disabled:opacity-30"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add items panel */}
          {showAddItems && (
            <div className="mt-3 border-t border-zinc-800 pt-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-500" />
                <input
                  type="text"
                  value={addItemSearch}
                  onChange={(e) => setAddItemSearch(e.target.value)}
                  placeholder="Search menu items..."
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2 pl-8 text-sm text-white placeholder-zinc-500"
                />
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {filteredAvailable.slice(0, 15).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addToNewItems(item)}
                    className="w-full flex items-center justify-between rounded-lg p-2 text-sm hover:bg-zinc-800"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-sm ${
                          item.isVeg ? "bg-green-500" : "bg-red-500"
                        }`}
                      />
                      <span className="text-white">{item.name}</span>
                    </div>
                    <span className="text-xs text-emerald-400">
                      {formatPrice(item.price)}
                    </span>
                  </button>
                ))}
              </div>
              {itemsToAdd.length > 0 && (
                <div className="space-y-1 border-t border-zinc-800 pt-2">
                  <p className="text-xs text-zinc-500">Items to add:</p>
                  {itemsToAdd.map((item) => (
                    <div
                      key={item.cafeItemId}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-zinc-300">{item.name}</span>
                      <span className="text-xs text-zinc-400">
                        x{item.quantity}
                      </span>
                    </div>
                  ))}
                  <button
                    onClick={handleAddItems}
                    disabled={loading}
                    className="w-full rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
                    ) : null}
                    Add {itemsToAdd.length} Item(s) to Order
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edit History */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="text-xs font-medium text-zinc-500 uppercase mb-3 flex items-center gap-2">
          <History className="h-3.5 w-3.5" />
          Edit History
        </h3>
        {editHistory.length === 0 ? (
          <p className="text-sm text-zinc-500">No history yet</p>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-zinc-800" />
            <div className="space-y-4">
              {editHistory.map((entry) => {
                const config = EDIT_TYPE_CONFIG[entry.editType] || {
                  color: "text-zinc-400",
                  label: entry.editType,
                };
                return (
                  <div key={entry.id} className="flex gap-3 relative">
                    <div
                      className={`mt-1 h-3.5 w-3.5 rounded-full border-2 border-zinc-900 flex-shrink-0 ${
                        entry.editType === "ORDER_CREATED"
                          ? "bg-emerald-500"
                          : entry.editType === "ORDER_CANCELLED"
                          ? "bg-red-500"
                          : "bg-zinc-600"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-medium ${config.color}`}>
                          {config.label}
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          by {entry.adminUsername}
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          {new Date(entry.createdAt).toLocaleString("en-IN", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </span>
                      </div>
                      {entry.note && (
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {entry.note}
                        </p>
                      )}
                      {entry.previousAmount !== null &&
                        entry.newAmount !== null &&
                        entry.previousAmount !== entry.newAmount && (
                          <p className="text-[10px] text-zinc-500 mt-0.5">
                            Amount: {formatPrice(entry.previousAmount)} &rarr;{" "}
                            {formatPrice(entry.newAmount)}
                          </p>
                        )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
