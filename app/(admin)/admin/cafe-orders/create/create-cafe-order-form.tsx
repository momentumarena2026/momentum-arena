"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminCreateCafeOrder,
  findCafeCustomerByPhone,
} from "@/actions/admin-cafe-orders";
import { CafeItemCategory, PaymentMethod } from "@prisma/client";
import {
  Plus,
  Minus,
  X,
  Loader2,
  CheckCircle2,
  User,
  Coffee,
  Sandwich,
  UtensilsCrossed,
  IceCreamCone,
  Package,
  Tag,
} from "lucide-react";
import { formatPrice } from "@/lib/pricing";
import { PhoneInput } from "@/components/ui/phone-input";

interface MenuItem {
  id: string;
  name: string;
  category: CafeItemCategory;
  price: number;
  isVeg: boolean;
  tags: string[];
  /**
   * `true` when the item is cooked / assembled in the kitchen
   * (CafeItem.quantity is NULL — no stock tracking, made to
   * order). `false` when it's a procured ready-to-serve item
   * (CafeItem.quantity is a number — e.g. drinks, ice-cream,
   * packaged snacks). Drives the order-status routing in
   * `adminCreateCafeOrder`: an order made up entirely of
   * needsPreparation=false items lands directly in COMPLETED
   * (no kitchen ticket); anything else stays PENDING.
   */
  needsPreparation: boolean;
}

interface CartItem {
  cafeItemId: string;
  name: string;
  price: number;
  quantity: number;
  isVeg: boolean;
  // Mirrors MenuItem.needsPreparation; carried into the cart so
  // the order-summary hint can reflect "this whole order is
  // ready to hand over" vs "kitchen will prepare" without
  // looking the item back up by id.
  needsPreparation: boolean;
}

interface MatchedCustomer {
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

  // Phone-first customer flow — single input instead of Walk-in /
  // Existing toggles. On 10-digit phone we debounce a lookup;
  // matched user surfaces as a read-only name pill, unmatched
  // shows a name input the admin can fill in (creates a new User
  // on submit).
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [matchedCustomer, setMatchedCustomer] =
    useState<MatchedCustomer | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [discountAmount, setDiscountAmount] = useState("");

  // Payment-method picker. The "SPLIT" value is a UI-only psuedo-
  // method that doesn't correspond to a PaymentMethod enum row —
  // when selected, two amount inputs (Cash + UPI) appear and the
  // action receives a `split` spec instead of a single method.
  type PaymentChoice = PaymentMethod | "SPLIT";
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>("CASH");
  const [splitCash, setSplitCash] = useState("");
  const [splitUpi, setSplitUpi] = useState("");

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
          needsPreparation: item.needsPreparation,
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

  const subtotalAmount = cart.reduce(
    (sum, c) => sum + c.price * c.quantity,
    0,
  );
  const parsedDiscount = Math.max(0, Number(discountAmount) || 0);
  const effectiveDiscount = Math.min(parsedDiscount, subtotalAmount);
  const totalAmount = Math.max(0, subtotalAmount - effectiveDiscount);

  // Debounced phone → user lookup. The PhoneInput hands us the
  // local part (no +91 prefix); we fire the lookup once it crosses
  // 10 digits so the admin gets the pre-fill the moment they're
  // done typing. Cleared phone wipes the matched-customer state +
  // the typed name so a back-and-forth between two phones doesn't
  // strand stale data.
  useEffect(() => {
    const digits = customerPhone.replace(/\D/g, "");
    if (digits.length < 10) {
      setMatchedCustomer(null);
      return;
    }
    let cancelled = false;
    setLookingUp(true);
    const t = setTimeout(async () => {
      try {
        const result = await findCafeCustomerByPhone(customerPhone);
        if (cancelled) return;
        setMatchedCustomer(result.customer);
        if (result.customer?.name) {
          setCustomerName(result.customer.name);
        }
      } finally {
        if (!cancelled) setLookingUp(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [customerPhone]);

  const phoneDigits = customerPhone.replace(/\D/g, "");
  const phoneReady = phoneDigits.length >= 10;

  const handleSubmit = async () => {
    if (cart.length === 0) {
      setError("Add at least one item");
      return;
    }

    // Split-payment client-side validation. Sum must equal the
    // post-discount total and at least one of the two slices must
    // be positive. The action re-checks both rules — this is just
    // for the inline error pre-submit.
    let splitPayload: { cashAmount: number; upiAmount: number } | undefined;
    if (paymentChoice === "SPLIT") {
      const cash = Number(splitCash) || 0;
      const upi = Number(splitUpi) || 0;
      if (cash + upi <= 0) {
        setError("Split must have at least one of cash or UPI > 0");
        return;
      }
      if (Math.abs(cash + upi - totalAmount) > 0.01) {
        setError(
          `Split sums to ₹${cash + upi} but the order total is ₹${totalAmount}`,
        );
        return;
      }
      splitPayload = { cashAmount: cash, upiAmount: upi };
    }

    setSubmitting(true);
    setError(null);

    const result = await adminCreateCafeOrder({
      items: cart.map((c) => ({
        cafeItemId: c.cafeItemId,
        quantity: c.quantity,
      })),
      // Phone-first: send the typed phone (action looks up by phone
      // and creates a User if there's no match). When no phone was
      // typed at all, the order falls through as a plain anonymous
      // order — no userId, no guest data.
      customerPhone: phoneReady ? customerPhone : undefined,
      customerName: phoneReady ? customerName.trim() || undefined : undefined,
      discountAmount: effectiveDiscount > 0 ? effectiveDiscount : undefined,
      // For SPLIT the action ignores `paymentMethod` and resolves
      // the dominant slice itself — but we still need a valid
      // PaymentMethod here for the type. CASH is fine; the action
      // will overwrite with whichever slice is larger.
      paymentMethod:
        paymentChoice === "SPLIT" ? "CASH" : (paymentChoice as PaymentMethod),
      split: splitPayload,
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
              setCustomerPhone("");
              setCustomerName("");
              setMatchedCustomer(null);
              setDiscountAmount("");
              setPaymentChoice("CASH");
              setSplitCash("");
              setSplitUpi("");
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
                            {/* Fulfilment badge — tells the operator at
                                a glance whether ringing this item up
                                will skip the kitchen ("Ready" — handed
                                over at counter, order COMPLETED on
                                create) or send a ticket to the kitchen
                                ("Kitchen" — PENDING → PREPARING →
                                READY → COMPLETED via the live-order
                                board). Tied to CafeItem.quantity:
                                stocked → Ready, NULL → Kitchen. */}
                            {item.needsPreparation ? (
                              <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300">
                                Kitchen
                              </span>
                            ) : (
                              <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
                                Ready
                              </span>
                            )}
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

          {/* Fulfilment hint — tells the admin what'll happen when
              they tap Place Order:
                - all ready    → "Hand over now" — order goes
                                 straight to COMPLETED, skips the
                                 kitchen kanban entirely.
                - has kitchen  → "Send to kitchen" — order lands
                                 in PENDING and the live-order
                                 board picks it up.
              The server re-checks `CafeItem.quantity` directly to
              route status, so this is purely a UX preview; the two
              paths can't drift. */}
          {cart.length > 0 && (() => {
            const allReady = cart.every((c) => !c.needsPreparation);
            return (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  allReady
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                }`}
              >
                {allReady ? (
                  <>
                    <span className="font-semibold">Hand over now.</span>{" "}
                    Every item is ready-to-serve — the order will be marked
                    COMPLETED and won&apos;t appear on the kitchen board.
                  </>
                ) : (
                  <>
                    <span className="font-semibold">Send to kitchen.</span>{" "}
                    At least one item needs preparation — the order lands
                    in the live-order board for the kitchen to work through.
                  </>
                )}
              </div>
            );
          })()}

          {/* Customer section — phone-first. The admin types the
              customer's phone; we look them up automatically and
              pre-fill the name if there's a match (read-only).
              On miss we show a "New customer" hint + a name input
              that becomes the new User record on submit. Drops the
              prior Walk-in / Existing Customer toggle entirely. */}
          <div className="border-t border-zinc-800 pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-zinc-400" />
              <span className="text-sm font-medium text-white">Customer</span>
              {lookingUp ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
              ) : null}
              {phoneReady && matchedCustomer ? (
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                  Existing
                </span>
              ) : phoneReady && !matchedCustomer && !lookingUp ? (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                  New
                </span>
              ) : null}
            </div>

            {/* Phone field — full width on its own row so the
                "+91" prefix + input don't overflow the cart card.
                The PhoneInput keeps the local digits internally; we
                debounce a lookup at 10 digits. */}
            <PhoneInput
              value={customerPhone}
              onChange={setCustomerPhone}
              placeholder="Phone (10 digits)"
            />

            {/* Name field — pre-filled (read-only) on a match,
                editable on a miss. Hidden until a phone has been
                typed so the form doesn't ask for a name before it
                makes sense. */}
            {phoneReady ? (
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                readOnly={!!matchedCustomer}
                placeholder={
                  matchedCustomer ? "Existing customer" : "Customer name (optional)"
                }
                className={`w-full rounded-lg border p-2 text-sm placeholder-zinc-500 ${
                  matchedCustomer
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
                    : "border-zinc-700 bg-zinc-800 text-white"
                }`}
              />
            ) : null}
          </div>

          {/* Flat discount input — admin can knock the order total
              down by a typed rupee amount. Bounded server-side so
              a too-large discount lands as 100% off rather than a
              negative total. */}
          <div className="border-t border-zinc-800 pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-zinc-400" />
              <span className="text-sm font-medium text-white">
                Discount (₹)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                placeholder="0"
                className="w-32 rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm text-white placeholder-zinc-500"
              />
              {effectiveDiscount > 0 ? (
                <p className="text-xs text-amber-300">
                  Saving {formatPrice(effectiveDiscount)} →{" "}
                  <span className="font-semibold text-emerald-300">
                    {formatPrice(totalAmount)}
                  </span>
                </p>
              ) : (
                <p className="text-xs text-zinc-500">
                  Subtotal {formatPrice(subtotalAmount)}
                </p>
              )}
            </div>
          </div>

          {/* Payment method — single-method pills + a "Split" pill
              that reveals two amount inputs (Cash + UPI) for the
              mixed-tender flow. Live sum hint flips emerald when
              the split equals the order total. */}
          <div className="border-t border-zinc-800 pt-3 space-y-2">
            <span className="text-sm font-medium text-white">Payment</span>
            <div className="flex items-center gap-2 flex-wrap">
              {PAYMENT_METHODS.map((pm) => (
                <button
                  key={pm.value}
                  onClick={() => setPaymentChoice(pm.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    paymentChoice === pm.value
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
                  }`}
                >
                  {pm.label}
                </button>
              ))}
              <button
                onClick={() => setPaymentChoice("SPLIT")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  paymentChoice === "SPLIT"
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
                }`}
              >
                Split (Cash + UPI)
              </button>
            </div>

            {paymentChoice === "SPLIT" ? (
              (() => {
                const cashN = Number(splitCash) || 0;
                const upiN = Number(splitUpi) || 0;
                const sum = cashN + upiN;
                const ok = Math.abs(sum - totalAmount) < 0.01 && cashN + upiN > 0;
                return (
                  <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                          Cash ₹
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={splitCash}
                          onChange={(e) => setSplitCash(e.target.value)}
                          placeholder="0"
                          className="w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm text-white placeholder-zinc-500"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                          UPI ₹
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={splitUpi}
                          onChange={(e) => setSplitUpi(e.target.value)}
                          placeholder={
                            cashN > 0
                              ? `Suggest ${Math.max(
                                  0,
                                  totalAmount - cashN,
                                )}`
                              : "0"
                          }
                          className="w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm text-white placeholder-zinc-500"
                        />
                      </label>
                    </div>
                    <p
                      className={`text-[11px] ${
                        ok
                          ? "text-emerald-300"
                          : sum > totalAmount
                            ? "text-red-400"
                            : "text-zinc-500"
                      }`}
                    >
                      Sum: {formatPrice(sum)} / {formatPrice(totalAmount)}
                    </p>
                  </div>
                );
              })()
            ) : null}
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

          {/* Submit — button label changes with the fulfilment
              hint above. "Place & Hand Over" makes it explicit
              that ready-only orders skip the kitchen and complete
              on click. */}
          {(() => {
            const allReady =
              cart.length > 0 && cart.every((c) => !c.needsPreparation);
            return (
              <button
                onClick={handleSubmit}
                disabled={submitting || cart.length === 0}
                className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                ) : null}
                {allReady ? "Place & Hand Over" : "Place Order"}
                {cart.length > 0 && ` (${formatPrice(totalAmount)})`}
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
