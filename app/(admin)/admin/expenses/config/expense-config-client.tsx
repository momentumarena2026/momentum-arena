"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Plus,
  Pencil,
  Check,
  X,
  Eye,
  EyeOff,
  Trash2,
  ArrowUp,
  ArrowDown,
  AlertCircle,
} from "lucide-react";
import {
  createExpenseOption,
  updateExpenseOption,
  deleteExpenseOption,
  reorderExpenseOptions,
} from "@/actions/admin-expenses";
import type { ExpenseOptionFieldKey } from "@/lib/expenses";

interface OptionRow {
  id: string;
  field: ExpenseOptionFieldKey;
  label: string;
  isActive: boolean;
  sortOrder: number;
}

interface Props {
  grouped: Record<ExpenseOptionFieldKey, OptionRow[]>;
  fieldTabs: {
    field: ExpenseOptionFieldKey;
    label: string;
    count: number;
    activeCount: number;
  }[];
}

// Tabbed editor — one tab per dropdown, with add / rename / toggle /
// reorder / delete actions. Everything writes through server actions
// and triggers router.refresh() so the server-rendered group stays in
// sync.
export function ExpenseConfigClient({ grouped, fieldTabs }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ExpenseOptionFieldKey>(
    fieldTabs[0]?.field ?? "PAYMENT_TYPE"
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Local edit state: which row is being renamed + the working label.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  // Add-new form state per tab
  const [newLabel, setNewLabel] = useState("");

  const rows = grouped[activeTab] ?? [];

  function clearError() {
    setError(null);
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    const label = newLabel.trim();
    if (!label) return;
    startTransition(async () => {
      const res = await createExpenseOption({ field: activeTab, label });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setNewLabel("");
      router.refresh();
    });
  }

  function startEdit(row: OptionRow) {
    clearError();
    setEditingId(row.id);
    setEditLabel(row.label);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditLabel("");
  }
  function saveEdit() {
    if (!editingId) return;
    const label = editLabel.trim();
    if (!label) return;
    startTransition(async () => {
      const res = await updateExpenseOption(editingId, { label });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setEditingId(null);
      setEditLabel("");
      router.refresh();
    });
  }

  function toggleActive(row: OptionRow) {
    clearError();
    startTransition(async () => {
      const res = await updateExpenseOption(row.id, { isActive: !row.isActive });
      if (!res.success) setError(res.error);
      else router.refresh();
    });
  }

  function remove(row: OptionRow) {
    clearError();
    if (
      !confirm(
        `Delete "${row.label}" permanently? Historical expense rows keep the label, but it disappears from dropdowns.`
      )
    )
      return;
    startTransition(async () => {
      const res = await deleteExpenseOption(row.id);
      if (!res.success) setError(res.error);
      else router.refresh();
    });
  }

  function move(row: OptionRow, direction: -1 | 1) {
    clearError();
    const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((r) => r.id === row.id);
    const target = idx + direction;
    if (target < 0 || target >= sorted.length) return;
    const reordered = [...sorted];
    [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
    const orderedIds = reordered.map((r) => r.id);
    startTransition(async () => {
      const res = await reorderExpenseOptions(activeTab, orderedIds);
      if (!res.success) setError(res.error);
      else router.refresh();
    });
  }

  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {fieldTabs.map((t) => {
          const active = t.field === activeTab;
          return (
            <button
              key={t.field}
              type="button"
              onClick={() => {
                setActiveTab(t.field);
                clearError();
                setEditingId(null);
              }}
              className={`rounded-lg border px-3 py-2 text-sm transition ${
                active
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700"
              }`}
            >
              {t.label}
              <span className="ml-2 text-xs text-zinc-500">
                {t.activeCount}/{t.count}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-4">
        {/* Add new */}
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New option label"
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending || newLabel.trim().length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </form>

        {/* Options list */}
        {sorted.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-500">
            No options yet — add the first one above.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {sorted.map((row, idx) => {
              const isEditing = editingId === row.id;
              return (
                <li
                  key={row.id}
                  className={`flex flex-wrap items-center gap-3 py-2 ${
                    row.isActive ? "" : "opacity-60"
                  }`}
                >
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => move(row, -1)}
                      disabled={idx === 0 || pending}
                      className="rounded p-0.5 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(row, 1)}
                      disabled={idx === sorted.length - 1 || pending}
                      className="rounded p-0.5 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                        autoFocus
                        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
                      />
                    ) : (
                      <span className="text-sm text-zinc-200">{row.label}</span>
                    )}
                  </div>

                  {!row.isActive && (
                    <span className="text-[10px] uppercase tracking-wide rounded-md bg-zinc-800 px-2 py-0.5 text-zinc-400">
                      Hidden
                    </span>
                  )}

                  <div className="flex items-center gap-1">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={pending}
                          className="rounded p-1.5 text-emerald-400 hover:bg-zinc-800"
                          aria-label="Save"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800"
                          aria-label="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          disabled={pending}
                          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800"
                          aria-label="Rename"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(row)}
                          disabled={pending}
                          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800"
                          aria-label={row.isActive ? "Hide" : "Show"}
                        >
                          {row.isActive ? (
                            <Eye className="h-4 w-4" />
                          ) : (
                            <EyeOff className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(row)}
                          disabled={pending}
                          className="rounded p-1.5 text-red-400 hover:bg-red-500/10"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
