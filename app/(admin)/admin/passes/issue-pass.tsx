"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Search, Ticket, Check, X, Loader2 } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { issuePassToUser } from "@/actions/admin-passes";
import {
  searchCustomers,
  createCustomerForBooking,
} from "@/actions/admin-booking";

interface Plan {
  id: string;
  name: string;
  sport: string;
  price: number;
  totalMinutes: number;
  validityDays: number;
  isActive: boolean;
}
interface Customer {
  id: string;
  name: string | null;
  phone: string | null;
}
type Method = "CASH" | "UPI_QR" | "FREE";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const hrs = (m: number) => `${(m / 60).toFixed(1).replace(/\.0$/, "")}h`;

const METHODS: { value: Method; label: string; hint: string }[] = [
  { value: "CASH", label: "Cash", hint: "Paid in cash at the counter" },
  { value: "UPI_QR", label: "Static QR", hint: "Scanned the venue UPI QR" },
  { value: "FREE", label: "Free", hint: "Complimentary — no charge" },
];

/**
 * Issue a pass at the venue — for a walk-in who bought a pass and paid
 * by cash or the static UPI QR (or a comp pass). Pick a plan, find or
 * create the customer, record how they paid, and the hours land on
 * their account immediately (same as an online purchase).
 */
export function IssuePass({ plans }: { plans: Plan[] }) {
  const router = useRouter();
  const activePlans = useMemo(() => plans.filter((p) => p.isActive), [plans]);

  const [planId, setPlanId] = useState(activePlans[0]?.id ?? "");
  const selectedPlan = activePlans.find((p) => p.id === planId) ?? null;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [creating, setCreating] = useState(false);

  const [method, setMethod] = useState<Method>("CASH");
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Prefill the amount with the plan price whenever the plan changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAmount(selectedPlan ? String(selectedPlan.price) : "");
  }, [selectedPlan]);

  // Debounced customer search.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const res = await searchCustomers(query.trim()).catch(() => null);
      if (res?.success) setResults(res.customers);
      setSearching(false);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  async function createCustomer() {
    if (!newName.trim() || newPhone.length !== 10) return;
    setCreating(true);
    setError(null);
    const res = await createCustomerForBooking({
      name: newName.trim(),
      phone: newPhone,
    }).catch(() => null);
    setCreating(false);
    if (!res?.success) {
      setError(res && "error" in res ? res.error : "Couldn't create customer");
      return;
    }
    setCustomer({ id: res.userId, name: newName.trim(), phone: newPhone });
    setShowNew(false);
    setNewName("");
    setNewPhone("");
    setQuery("");
    setResults([]);
  }

  function submit() {
    if (!selectedPlan || !customer) return;
    setError(null);
    setDone(null);
    const amt =
      method === "FREE" ? 0 : Number.parseInt(amount, 10);
    if (method !== "FREE" && (Number.isNaN(amt) || amt < 0)) {
      setError("Enter a valid amount collected.");
      return;
    }
    start(async () => {
      const res = await issuePassToUser({
        planId: selectedPlan.id,
        userId: customer.id,
        paymentMethod: method,
        amountCollected: amt,
        offlineRef: ref.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(
        `${selectedPlan.name} issued to ${customer.name ?? customer.phone ?? "customer"}.`,
      );
      // Reset for the next walk-in; keep the plan + method selected.
      setCustomer(null);
      setRef("");
      router.refresh();
    });
  }

  if (activePlans.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
        Create and activate a plan above to start issuing passes at the venue.
      </div>
    );
  }

  const canSubmit = !!selectedPlan && !!customer && !pending;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/25">
          <Ticket className="h-5 w-5 text-emerald-400" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-white">Issue a pass</h2>
          <p className="text-xs text-zinc-500">
            Sell a pass at the venue — cash or static QR. Hours land on the
            customer&apos;s account instantly.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Plan */}
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Plan
          </label>
          <select
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-emerald-600 focus:outline-none"
          >
            {activePlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {inr(p.price)} · {hrs(p.totalMinutes)} · {p.validityDays}d
              </option>
            ))}
          </select>
        </div>

        {/* Customer */}
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Customer
          </label>
          {customer ? (
            <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">
                  {customer.name ?? "—"}
                </p>
                <p className="text-xs text-zinc-400">{customer.phone ?? "—"}</p>
              </div>
              <button
                onClick={() => setCustomer(null)}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                aria-label="Change customer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : showNew ? (
            <div className="space-y-2 rounded-lg border border-zinc-700 bg-zinc-900 p-3">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Full name"
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-600 focus:outline-none"
              />
              <PhoneInput
                value={newPhone}
                onChange={setNewPhone}
                placeholder="10-digit mobile"
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-600 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={createCustomer}
                  disabled={creating || !newName.trim() || newPhone.length !== 10}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {creating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Add
                </button>
                <button
                  onClick={() => setShowNew(false)}
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="relative">
              <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-zinc-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, email or phone…"
                  className="w-full bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none"
                />
                <button
                  onClick={() => setShowNew(true)}
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300"
                >
                  <UserPlus className="h-3.5 w-3.5" /> New
                </button>
              </div>
              {(searching || results.length > 0) && (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
                  {searching && (
                    <p className="px-3 py-2 text-xs text-zinc-500">Searching…</p>
                  )}
                  {results.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setCustomer(c);
                        setResults([]);
                        setQuery("");
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-800"
                    >
                      <span className="text-sm text-white">{c.name ?? "—"}</span>
                      <span className="text-xs text-zinc-500">{c.phone ?? "—"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Payment method */}
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Payment method
          </label>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMethod(m.value)}
                title={m.hint}
                className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
                  method === m.value
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Amount + reference */}
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            {method === "FREE" ? "Amount collected" : "Amount collected (₹)"}
          </label>
          {method === "FREE" ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-500">
              ₹0 — complimentary pass
            </div>
          ) : (
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-emerald-600 focus:outline-none"
            />
          )}
          {method === "UPI_QR" && (
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="UTR / reference (optional)"
              className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-600 focus:outline-none"
            />
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {done && <p className="mt-3 text-sm text-emerald-400">{done}</p>}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">
          {selectedPlan && (
            <>
              Issues {hrs(selectedPlan.totalMinutes)}, valid{" "}
              {selectedPlan.validityDays} days from today.
            </>
          )}
        </p>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Ticket className="h-4 w-4" />
          )}
          Issue pass
        </button>
      </div>
    </section>
  );
}
