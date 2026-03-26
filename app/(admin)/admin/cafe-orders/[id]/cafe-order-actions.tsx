"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateCafeOrderStatus,
  cancelCafeOrder,
  addItemsToCafeOrder,
  cancelItemsFromCafeOrder,
  updateCafeItemQuantity,
} from "@/actions/admin-cafe-orders";
import { CafeOrderStatus, CafeItemCategory } from "@prisma/client";
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
};

export function CafeOrderActions({
  order,
  availableItems,
  editHistory,
}: {
  order: {
    id: string;
    status: CafeOrderStatus;
    totalAmount: number;
    items: OrderItem[];
  };
  availableItems: AvailableItem[];
  editHistory: HistoryEntry[];
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
