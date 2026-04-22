"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Filter, X } from "lucide-react";

interface Props {
  initial: {
    from: string;
    to: string;
    spentType: string;
    doneBy: string;
    paymentType: string;
    vendor: string;
    search: string;
  };
  options: {
    PAYMENT_TYPE: string[];
    DONE_BY: string[];
    VENDOR: string[];
    SPENT_TYPE: string[];
    TO_NAME: string[];
  };
}

// URL-driven filter bar. Each control pushes the new searchParams as a
// client-side navigation; the server component at /admin/expenses
// re-reads them on next render.
export function ExpenseFilters({ initial, options }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState(initial);

  function applyUrl(next: typeof form) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v) qs.set(k, v);
    }
    qs.set("page", "1");
    startTransition(() => {
      router.push(`/admin/expenses?${qs.toString()}`);
    });
  }

  function set<K extends keyof typeof form>(key: K, value: string) {
    const next = { ...form, [key]: value };
    setForm(next);
    applyUrl(next);
  }

  function clear() {
    const next = {
      from: "",
      to: "",
      spentType: "",
      doneBy: "",
      paymentType: "",
      vendor: "",
      search: "",
    };
    setForm(next);
    applyUrl(next);
  }

  const hasAny = Object.values(form).some((v) => v.length > 0);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
          <Filter className="h-4 w-4 text-zinc-500" />
          Filters
          {pending && (
            <span className="text-xs text-zinc-500">Updating…</span>
          )}
        </div>
        {hasAny && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" />
            Clear all
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
            From
          </span>
          <input
            type="date"
            value={form.from}
            onChange={(e) => set("from", e.target.value)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
            To
          </span>
          <input
            type="date"
            value={form.to}
            onChange={(e) => set("to", e.target.value)}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
          />
        </label>

        <FilterSelect
          label="Spent Type"
          value={form.spentType}
          onChange={(v) => set("spentType", v)}
          options={options.SPENT_TYPE}
        />
        <FilterSelect
          label="Done By"
          value={form.doneBy}
          onChange={(v) => set("doneBy", v)}
          options={options.DONE_BY}
        />
        <FilterSelect
          label="Payment"
          value={form.paymentType}
          onChange={(v) => set("paymentType", v)}
          options={options.PAYMENT_TYPE}
        />
        <FilterSelect
          label="Vendor"
          value={form.vendor}
          onChange={(v) => set("vendor", v)}
          options={options.VENDOR}
        />

        <label className="flex flex-col gap-1 col-span-2 md:col-span-4 lg:col-span-1">
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
            Search
          </span>
          <input
            type="search"
            value={form.search}
            placeholder="description / to / note"
            onChange={(e) => setForm({ ...form, search: e.target.value })}
            onBlur={() => applyUrl(form)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyUrl(form);
            }}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
          />
        </label>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
