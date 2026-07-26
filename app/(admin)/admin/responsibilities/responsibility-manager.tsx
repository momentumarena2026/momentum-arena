"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Pencil, Check, X, ToggleLeft, ToggleRight } from "lucide-react";
import {
  createResponsibilityItem,
  updateResponsibilityItem,
  setResponsibilityItemActive,
  type ResponsibilityItemDTO,
} from "@/actions/admin-responsibilities";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none";

export function ResponsibilityManager({ items }: { items: ResponsibilityItemDTO[] }) {
  const router = useRouter();
  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    if (!newText.trim()) return;
    setAdding(true);
    try {
      const res = await createResponsibilityItem(newText);
      if (!res.success) {
        setError(res.error || "Failed to add");
        return;
      }
      setNewText("");
      router.refresh();
    } finally {
      setAdding(false);
    }
  };

  const saveEdit = async (id: string) => {
    if (!editText.trim()) return;
    setBusyId(id);
    try {
      const res = await updateResponsibilityItem(id, editText);
      if (res.success) {
        setEditingId(null);
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  const toggle = async (item: ResponsibilityItemDTO) => {
    setBusyId(item.id);
    try {
      await setResponsibilityItemActive(item.id, !item.isActive);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = items.filter((i) => i.isActive).length;

  return (
    <div className="space-y-4">
      {/* Add new item */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <label className="mb-2 block text-sm font-medium text-white">Add a responsibility</label>
        <div className="flex gap-2">
          <input
            className={inputCls}
            placeholder="e.g. Manage front-desk bookings and customer check-ins"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <button
            onClick={add}
            disabled={adding || !newText.trim()}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20 disabled:opacity-40"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>

      {/* Items list */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-4 font-medium text-white">
          Responsibility Items{" "}
          <span className="text-sm font-normal text-zinc-500">
            ({activeCount} enabled / {items.length} total)
          </span>
        </h3>
        {items.length === 0 ? (
          <p className="text-sm text-zinc-500">No items yet. Add your first responsibility above.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className={`flex items-center gap-3 rounded-lg border p-3 ${
                  item.isActive ? "border-zinc-800 bg-zinc-800/40" : "border-zinc-800/60 bg-zinc-900 opacity-60"
                }`}
              >
                {editingId === item.id ? (
                  <>
                    <input
                      className={inputCls}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(item.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                    />
                    <button
                      onClick={() => saveEdit(item.id)}
                      disabled={busyId === item.id}
                      className="rounded-lg border border-emerald-500/30 p-1.5 text-emerald-400 hover:bg-emerald-600/20"
                      title="Save"
                    >
                      {busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 hover:bg-zinc-800"
                      title="Cancel"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-zinc-200">{item.text}</span>
                    <span className={`text-xs ${item.isActive ? "text-emerald-400" : "text-zinc-500"}`}>
                      {item.isActive ? "Enabled" : "Disabled"}
                    </span>
                    <button
                      onClick={() => {
                        setEditingId(item.id);
                        setEditText(item.text);
                      }}
                      className="rounded-lg border border-zinc-700 p-1.5 text-zinc-300 hover:bg-zinc-800"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => toggle(item)}
                      disabled={busyId === item.id}
                      className="rounded-lg border border-zinc-700 p-1.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                      title={item.isActive ? "Disable" : "Enable"}
                    >
                      {busyId === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : item.isActive ? (
                        <ToggleRight className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
