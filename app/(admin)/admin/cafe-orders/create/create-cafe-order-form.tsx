"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  adminCreateCafeOrder,
  searchCafeCustomers,
} from "@/actions/admin-cafe-orders";
import { CafeItemCategory, PaymentMethod } from "@prisma/client";
import {
  Plus,
  Minus,
  X,
  Loader2,
  CheckCircle2,
  Search,
  User,
  Coffee,
  Sandwich,
  UtensilsCrossed,
  IceCreamCone,
  Package,
} from "lucide-react";
import { formatPrice } from "@/lib/pricing";

interface MenuItem {
  id: string;
  name: string;
  category: CafeItemCategory;
  price: number;
  isVeg: boolean;
  tags: string[];
}

interface CartItem {
  cafeItemId: string;
  name: string;
  price: number;
  quantity: number;
  isVeg: boolean;
}

interface Customer {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

const CATEGORIES: { value: CafeItemCategory; label: string; icon: typeof Coffee }[] = [
  { value: "BEVERAGES", label: "Beverages", icon: Coffee },
  { value: "SNACKS", label: "Snacks", icon: Sandwich },
  { value: "MEALS", label: "Meals", icon: UtensilsCrossed },
  { value: "DESSERTS", label: "Desserts", icon: IceCreamCone },
  { value: "COMBOS", label: "Combos", icon: Package },
];

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "UPI_QR", label: "UPI QR" },
  { value: "RAZORPAY", label: "Razorpay" },
  { value: "FREE", label: "Free" },
];

export function CreateCafeOrderForm({
  menuItems,
}: {
  menuItems: MenuItem[];
}) {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<string>("ALL");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isWalkin, setIsWalkin] = useState(true);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successOrder, setSuccessOrder] = useState<string | null>(null);

  const filteredMenu =
    activeCategory === "ALL"
      ? menuItems
      : menuItems.filter((i) => i.category === activeCategory);

  // Group by category
  const groupedMenu: Record<string, MenuItem[]> = {};
  for (const item of filteredMenu) {
    if (!groupedMenu[item.category]) groupedMenu[item.category] = [];
    groupedMenu[item.category].push(item);
  }

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.cafeItemId === item.id);
      if (existing) {
        return prev.map((c) =>
          c.cafeItemId === item.id
            ? { ...c, quantity: c.quantity + 1 }
            : c
        );
      }
      return [
        ...prev,
        {
          cafeItemId: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
          isVeg: item.isVeg,
        },
      ];
    });
  };

  const updateQuantity = (cafeItemId: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((c) => {
          if (c.cafeItemId === cafeItemId) {
            const newQ = c.quantity + delta;
            return newQ > 0 ? { ...c, quantity: newQ } : null;
          }
          return c;
        })
        .filter(Boolean) as CartItem[];
    });
  };

  const removeFromCart = (cafeItemId: string) => {
    setCart((prev) => prev.filter((c) => c.cafeItemId !== cafeItemId));
  };

  const getCartQuantity = (itemId: string) => {
    return cart.find((c) => c.cafeItemId === itemId)?.quantity || 0;
  };

  const totalAmount = cart.reduce(
    (sum, c) => sum + c.price * c.quantity,
    0
  );

  const handleCustomerSearch = useCallback(
    async (query: string) => {
      setCustomerSearch(query);
      if (query.length < 2) {
        setCustomers([]);
        return;
      }
      setSearchingCustomers(true);
      const result = await searchCafeCustomers(query);
      setCustomers(result.customers);
      setSearchingCustomers(false);
    },
    []
  );

  const handleSubmit = async () => {
    if (cart.length === 0) {
      setError("Add at least one item");
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await adminCreateCafeOrder({
      items: cart.map((c) => ({
        cafeItemId: c.cafeItemId,
        quantity: c.quantity,
      })),
      userId: selectedCustomer?.id,
      guestName: isWalkin ? guestName || "Walk-in" : undefined,
      guestPhone: isWalkin ? guestPhone || undefined : undefined,
      paymentMethod,
      note: note || undefined,
    });

    if (result.success && result.order) {
      setSuccessOrder(result.order.orderNumber);
    } else {
      setError(result.error || "Failed to create order");
    }
    setSubmitting(false);
  };

  if (successOrder) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center">
        <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-400" />
        <h2 className="mt-4 text-2xl font-bold text-white">Order Created!</h2>
        <p className="mt-2 text-4xl font-mono font-bold text-emerald-400">
          {successOrder}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              setSuccessOrder(null);
              setCart([]);
              setNote("");
              setGuestName("");
              setGuestPhone("");
              setSelectedCustomer(null);
            }}
            className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            New Order
          </button>
          <button
            onClick={() => router.push("/admin/cafe-orders")}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-6 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700"
          >
            View Orders
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* LEFT: Menu grid */}
      <div className="lg:col-span-3 space-y-4">
        {/* Category tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setActiveCategory("ALL")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activeCategory === "ALL"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
            }`}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeCategory === cat.value
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Menu items */}
        {Object.entries(groupedMenu).map(([category, catItems]) => {
          const catInfo = CATEGORIES.find((c) => c.value === category);
          return (
            <div key={category} className="space-y-2">
              <h3 className="text-sm font-semibold text-zinc-400">
                {catInfo?.label || category}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {catItems.map((item) => {
                  const qty = getCartQuantity(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border p-3 transition-all ${
                        qty > 0
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`inline-block h-2 w-2 rounded-sm ${
                                item.isVeg ? "bg-green-500" : "bg-red-500"
                              }`}
                            />
                            <span className="text-sm font-medium text-white truncate">
                              {item.name}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-emerald-400 mt-0.5">
                            {formatPrice(item.price)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {qty > 0 ? (
                            <>
                              <button
                                onClick={() => updateQuantity(item.id, -1)}
                                className="rounded-lg border border-zinc-700 bg-zinc-800 p-1 text-zinc-400 hover:text-white"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <span className="w-7 text-center text-sm font-bold text-white">
                                {qty}
                              </span>
                              <button
                                onClick={() => updateQuantity(item.id, 1)}
                                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-1 text-emerald-400 hover:bg-emerald-500/20"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => addToCart(item)}
                              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white"
                            >
                              ADD
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* RIGHT: Order summary */}
      <div className="lg:col-span-2 space-y-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-4 sticky top-4">
          <h3 className="font-medium text-white">Order Summary</h3>

          {/* Cart items */}
          {cart.length === 0 ? (
            <p className="text-sm text-zinc-500 py-4 text-center">
              No items added yet
            </p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {cart.map((item) => (
                <div
                  key={item.cafeItemId}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className={`inline-block h-2 w-2 rounded-sm flex-shrink-0 ${
                        item.isVeg ? "bg-green-500" : "bg-red-500"
                      }`}
                    />
                    <span className="text-zinc-300 truncate">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <button
                      onClick={() => updateQuantity(item.cafeItemId, -1)}
                      className="text-zinc-500 hover:text-white"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-5 text-center text-white font-medium">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(item.cafeItemId, 1)}
                      className="text-zinc-500 hover:text-white"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    <span className="w-16 text-right text-zinc-400">
                      {formatPrice(item.price * item.quantity)}
                    </span>
                    <button
                      onClick={() => removeFromCart(item.cafeItemId)}
                      className="text-zinc-600 hover:text-red-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {cart.length > 0 && (
            <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
              <span className="font-medium text-white">Total</span>
              <span className="text-lg font-bold text-emerald-400">
                {formatPrice(totalAmount)}
              </span>
            </div>
          )}

          {/* Customer section */}
          <div className="border-t border-zinc-800 pt-3 space-y-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-zinc-400" />
              <span className="text-sm font-medium text-white">Customer</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setIsWalkin(true);
                  setSelectedCustomer(null);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  isWalkin
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
                }`}
              >
                Walk-in Guest
              </button>
              <button
                onClick={() => setIsWalkin(false)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  !isWalkin
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
                }`}
              >
                Existing Customer
              </button>
            </div>

            {isWalkin ? (
              <div className="grid gap-2 grid-cols-2">
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Guest name (optional)"
                  className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm text-white placeholder-zinc-500"
                />
                <input
                  type="tel"
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  placeholder="Phone (optional)"
                  className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm text-white placeholder-zinc-500"
                />
              </div>
            ) : (
              <div className="space-y-2">
                {selectedCustomer ? (
                  <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
                    <div>
                      <p className="text-sm font-medium text-white">
                        {selectedCustomer.name || selectedCustomer.email}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {selectedCustomer.phone || selectedCustomer.email}
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedCustomer(null)}
                      className="text-zinc-500 hover:text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
                    <input
                      type="text"
                      value={customerSearch}
                      onChange={(e) => handleCustomerSearch(e.target.value)}
                      placeholder="Search by name, email, or phone"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2 pl-8 text-sm text-white placeholder-zinc-500"
                    />
                    {searchingCustomers && (
                      <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-zinc-500" />
                    )}
                    {customers.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 rounded-lg border border-zinc-700 bg-zinc-800 shadow-lg z-10 max-h-40 overflow-y-auto">
                        {customers.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => {
                              setSelectedCustomer(c);
                              setCustomers([]);
                              setCustomerSearch("");
                            }}
                            className="w-full p-2 text-left hover:bg-zinc-700 text-sm"
                          >
                            <p className="text-white">
                              {c.name || c.email}
                            </p>
                            <p className="text-xs text-zinc-500">
                              {c.phone || c.email}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Payment method */}
          <div className="border-t border-zinc-800 pt-3 space-y-2">
            <span className="text-sm font-medium text-white">Payment</span>
            <div className="flex items-center gap-2 flex-wrap">
              {PAYMENT_METHODS.map((pm) => (
                <button
                  key={pm.value}
                  onClick={() => setPaymentMethod(pm.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    paymentMethod === pm.value
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
                  }`}
                >
                  {pm.label}
                </button>
              ))}
            </div>
          </div>

          {/* Note */}
          <div className="border-t border-zinc-800 pt-3">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Order note (optional)"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm text-white placeholder-zinc-500"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || cart.length === 0}
            className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
            ) : null}
            Place Order {cart.length > 0 && `(${formatPrice(totalAmount)})`}
          </button>
        </div>
      </div>
    </div>
  );
}
