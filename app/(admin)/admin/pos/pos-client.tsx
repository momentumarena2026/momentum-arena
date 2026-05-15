"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ImageOff, Loader2, Minus, Plus, Search, Trash2 } from "lucide-react";
import { formatPrice } from "@/lib/pricing";
import {
  createCustomerForBooking,
  searchCustomers,
} from "@/actions/admin-booking";
import { placeAdminOrder } from "@/actions/shop-order";

interface ProductRow {
  id: string;
  name: string;
  pricePaise: number;
  stockQuantity: number;
  imageUrl: string | null;
  categoryName: string | null;
}

interface CustomerHit {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Admin walk-in sale interface. Two columns:
 *   - left: product grid (tap to add to bill)
 *   - right: bill (line items + customer picker + payment method)
 *
 * Customer flow mirrors the existing /admin/bookings/create page:
 *   search → pick existing OR create new with phone/name. The chosen
 *   customer's id is what `placeAdminOrder` needs.
 *
 * Payment defaults to CASH + markPaid=true since walk-in sales are
 * typically paid on the spot. Admin can flip to UPI_QR (with optional
 * UTR) or leave the bill PENDING for later confirmation.
 */
export function PosClient({ products }: { products: ProductRow[] }) {
  const router = useRouter();
  const [bill, setBill] = useState<Map<string, number>>(new Map());
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerHits, setCustomerHits] = useState<CustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerHit | null>(
    null,
  );
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "" });
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "UPI_QR">("CASH");
  const [markPaid, setMarkPaid] = useState(true);
  const [utr, setUtr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const productById = new Map(products.map((p) => [p.id, p]));

  function bump(productId: string, delta: number) {
    setBill((prev) => {
      const next = new Map(prev);
      const product = productById.get(productId);
      if (!product) return prev;
      const current = next.get(productId) ?? 0;
      const desired = Math.max(0, Math.min(product.stockQuantity, current + delta));
      if (desired === 0) next.delete(productId);
      else next.set(productId, desired);
      return next;
    });
  }

  function clearBill() {
    setBill(new Map());
  }

  async function runSearch() {
    if (customerSearch.trim().length < 2) return;
    setSearching(true);
    try {
      const res = await searchCustomers(customerSearch.trim());
      if (res.success) {
        setCustomerHits(res.customers);
      }
    } finally {
      setSearching(false);
    }
  }

  async function createAndSelectCustomer() {
    if (!newCustomer.name.trim() || !newCustomer.phone.trim()) {
      setError("Name and phone are required to create a customer.");
      return;
    }
    const res = await createCustomerForBooking({
      name: newCustomer.name.trim(),
      phone: newCustomer.phone.trim(),
    });
    if (!res.success) {
      setError(res.error ?? "Could not create customer");
      return;
    }
    setSelectedCustomer({
      id: res.userId,
      name: newCustomer.name.trim(),
      email: null,
      phone: newCustomer.phone.trim(),
    });
    setNewCustomer({ name: "", phone: "" });
  }

  const items = Array.from(bill.entries()).map(([productId, quantity]) => {
    const product = productById.get(productId)!;
    return { product, quantity };
  });
  const totalPaise = items.reduce(
    (s, i) => s + i.product.pricePaise * i.quantity,
    0,
  );

  function handleRing() {
    setError(null);
    if (items.length === 0) {
      setError("Add at least one item.");
      return;
    }
    if (!selectedCustomer) {
      setError("Pick or create a customer first.");
      return;
    }
    startTransition(async () => {
      const res = await placeAdminOrder({
        customerUserId: selectedCustomer.id,
        items: items.map((i) => ({
          productId: i.product.id,
          quantity: i.quantity,
        })),
        method: paymentMethod,
        markPaid,
        utrNumber: paymentMethod === "UPI_QR" && utr.trim() ? utr.trim() : undefined,
      });
      if (!res.success || !res.orderId) {
        setError(res.error ?? "Order failed");
        return;
      }
      router.push(`/admin/product-orders/${res.orderId}`);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {/* Product grid */}
      <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Products
        </h2>
        {products.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No in-stock items. Restock via /admin/products first.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {products.map((p) => {
              const qty = bill.get(p.id) ?? 0;
              const reachedMax = qty >= p.stockQuantity;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => bump(p.id, 1)}
                  disabled={reachedMax}
                  className={`flex items-center gap-3 rounded-lg border p-2 text-left transition ${
                    qty > 0
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                  } ${reachedMax ? "opacity-60" : ""}`}
                >
                  <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-zinc-800">
                    {p.imageUrl ? (
                      <Image
                        src={p.imageUrl}
                        alt={p.name}
                        fill
                        sizes="40px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-zinc-600">
                        <ImageOff className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      {p.name}
                    </p>
                    <p className="text-xs text-emerald-300">
                      {formatPrice(Math.round(p.pricePaise / 100))}
                    </p>
                  </div>
                  {qty > 0 ? (
                    <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">
                      {qty}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bill */}
      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Bill
          </h2>
          {items.length === 0 ? (
            <p className="text-sm text-zinc-500">No items yet.</p>
          ) : (
            <ul className="space-y-2">
              {items.map(({ product, quantity }) => (
                <li
                  key={product.id}
                  className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 p-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm text-white">{product.name}</p>
                    <p className="text-[10px] text-zinc-500">
                      {formatPrice(Math.round(product.pricePaise / 100))} ×{" "}
                      {quantity}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => bump(product.id, -1)}
                    className="rounded p-1 text-zinc-300 hover:text-white"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="min-w-[1rem] text-center text-sm font-semibold text-white">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => bump(product.id, 1)}
                    disabled={quantity >= product.stockQuantity}
                    className="rounded p-1 text-zinc-300 hover:text-white disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => bump(product.id, -quantity)}
                    className="rounded p-1 text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-3">
            <span className="text-sm font-semibold text-white">Total</span>
            <span className="text-lg font-bold text-emerald-300">
              {formatPrice(Math.round(totalPaise / 100))}
            </span>
          </div>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={clearBill}
              className="mt-2 text-xs text-zinc-500 hover:text-zinc-300"
            >
              Clear bill
            </button>
          ) : null}
        </div>

        {/* Customer picker */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Customer
          </h2>
          {selectedCustomer ? (
            <div className="space-y-2">
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2">
                <p className="text-sm font-medium text-white">
                  {selectedCustomer.name ?? "—"}
                </p>
                {selectedCustomer.phone ? (
                  <p className="text-xs text-zinc-400">
                    {selectedCustomer.phone}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Change customer
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void runSearch();
                    }
                  }}
                  placeholder="Search name / phone / email…"
                  className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={runSearch}
                  disabled={searching}
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-500 disabled:opacity-60"
                >
                  {searching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              {customerHits.length > 0 ? (
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {customerHits.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedCustomer(c)}
                        className="w-full rounded-md border border-zinc-800 bg-zinc-950 p-2 text-left hover:border-zinc-600"
                      >
                        <p className="text-sm font-medium text-white">
                          {c.name ?? "(unnamed)"}
                        </p>
                        <p className="text-[10px] text-zinc-500">
                          {c.phone ?? "—"}
                          {c.email ? ` · ${c.email}` : ""}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">
                  Or create new
                </p>
                <div className="space-y-2">
                  <input
                    value={newCustomer.name}
                    onChange={(e) =>
                      setNewCustomer((c) => ({ ...c, name: e.target.value }))
                    }
                    placeholder="Name"
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                  <input
                    value={newCustomer.phone}
                    onChange={(e) =>
                      setNewCustomer((c) => ({ ...c, phone: e.target.value }))
                    }
                    placeholder="Phone"
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={createAndSelectCustomer}
                    className="w-full rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
                  >
                    Create & select
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Payment + ring */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Payment
          </h2>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-white">
              <input
                type="radio"
                checked={paymentMethod === "CASH"}
                onChange={() => setPaymentMethod("CASH")}
                className="accent-emerald-500"
              />
              Cash
            </label>
            <label className="flex items-center gap-2 text-sm text-white">
              <input
                type="radio"
                checked={paymentMethod === "UPI_QR"}
                onChange={() => setPaymentMethod("UPI_QR")}
                className="accent-emerald-500"
              />
              UPI QR
            </label>
            <label className="mt-3 flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={markPaid}
                onChange={(e) => setMarkPaid(e.target.checked)}
                className="accent-emerald-500"
              />
              Already paid — mark CONFIRMED
            </label>
            {paymentMethod === "UPI_QR" ? (
              <input
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                placeholder="UTR (optional)"
                className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            ) : null}
          </div>

          {error ? (
            <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleRing}
            disabled={isPending}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Ring up{" "}
            {totalPaise > 0
              ? `· ${formatPrice(Math.round(totalPaise / 100))}`
              : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
