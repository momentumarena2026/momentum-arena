"use client";

import { useEffect, useRef, useState } from "react";
import { UserPlus, Search, Check, X, Loader2 } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  searchCustomers,
  createCustomerForBooking,
} from "@/actions/admin-booking";

export interface PickedCustomer {
  id: string;
  name: string | null;
  phone: string | null;
}

/**
 * Find-or-create a customer — debounced search by name/email/phone, with
 * an inline "new customer" mini-form. Shared by the pass Issue and Gift
 * flows. Emits the selected customer up via onChange (null = cleared).
 */
export function CustomerPicker({
  value,
  onChange,
  onError,
}: {
  value: PickedCustomer | null;
  onChange: (c: PickedCustomer | null) => void;
  onError?: (msg: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedCustomer[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [creating, setCreating] = useState(false);

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
    const res = await createCustomerForBooking({
      name: newName.trim(),
      phone: newPhone,
    }).catch(() => null);
    setCreating(false);
    if (!res?.success) {
      onError?.(res && "error" in res ? res.error : "Couldn't create customer");
      return;
    }
    onChange({ id: res.userId, name: newName.trim(), phone: newPhone });
    setShowNew(false);
    setNewName("");
    setNewPhone("");
    setQuery("");
    setResults([]);
  }

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">
            {value.name ?? "—"}
          </p>
          <p className="text-xs text-zinc-400">{value.phone ?? "—"}</p>
        </div>
        <button
          onClick={() => onChange(null)}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          aria-label="Change customer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (showNew) {
    return (
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
    );
  }

  return (
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
                onChange(c);
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
  );
}
