"use client";

import { useState, useTransition } from "react";
import { GripVertical, ArrowUp, ArrowDown } from "lucide-react";

/**
 * Drag a list into the order customers will see it in.
 *
 * Two ways to move a row, deliberately. Dragging is what people reach
 * for; the arrow buttons are what actually works on a touchscreen, with
 * a keyboard, or when a list is long enough that the drop target is off
 * the bottom of the window. A reorder control that only supports
 * dragging is unusable in exactly the cases where reordering is most
 * tedious.
 *
 * Order is committed on drop rather than on a separate Save. There is no
 * half-arranged state worth preserving, and a Save button next to a list
 * that already LOOKS rearranged is how an admin walks away believing
 * they saved when they did not.
 *
 * The whole visible order is sent, not the item that moved. One index is
 * ambiguous the moment two people reorder at once; a full list is
 * idempotent and always matches what was on screen.
 */
export function ReorderableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  disabled,
}: {
  items: T[];
  onReorder: (ids: string[]) => Promise<{ success: boolean; error?: string }>;
  renderItem: (item: T, index: number) => React.ReactNode;
  disabled?: boolean;
}) {
  // Local copy so the list moves under the cursor immediately. A reorder
  // that waits for a round trip before it redraws reads as a failed drag
  // and gets repeated.
  const [order, setOrder] = useState<T[]>(items);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The server list wins whenever it genuinely changes (a camp added or
  // removed elsewhere), but not on every render — that would fight the
  // drag in progress.
  const serverKey = items.map((i) => i.id).join(",");
  const [seenKey, setSeenKey] = useState(serverKey);
  if (serverKey !== seenKey && !dragging) {
    setSeenKey(serverKey);
    setOrder(items);
  }

  function commit(next: T[]) {
    setOrder(next);
    setError(null);
    startTransition(async () => {
      const res = await onReorder(next.map((n) => n.id));
      if (!res.success) {
        // Put it back. Leaving the new order on screen after a failed
        // save is the worst outcome: it looks saved and is not.
        setOrder(items);
        setError(res.error ?? "Couldn't save the new order.");
      }
    });
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  }

  function drop(targetId: string) {
    if (!dragging || dragging === targetId) return;
    const from = order.findIndex((o) => o.id === dragging);
    const to = order.findIndex((o) => o.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  }

  return (
    <div className="space-y-2">
      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {order.map((item, i) => (
        <div
          key={item.id}
          draggable={!disabled}
          onDragStart={() => setDragging(item.id)}
          onDragEnd={() => {
            setDragging(null);
            setOver(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(item.id);
          }}
          onDragLeave={() => setOver((o) => (o === item.id ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            drop(item.id);
            setOver(null);
          }}
          className={`flex items-stretch gap-2 rounded-xl border transition-colors ${
            over === item.id && dragging !== item.id
              ? "border-emerald-500/60 bg-emerald-500/5"
              : "border-zinc-800 bg-zinc-900/40"
          } ${dragging === item.id ? "opacity-50" : ""} ${pending ? "opacity-80" : ""}`}
        >
          <div className="flex flex-col items-center justify-center gap-1 border-r border-zinc-800 px-2 py-3">
            <span
              className="cursor-grab text-zinc-600 active:cursor-grabbing"
              title="Drag to reorder"
            >
              <GripVertical size={16} />
            </span>
            {/* The half that works without a mouse. */}
            <button
              type="button"
              disabled={disabled || i === 0}
              onClick={() => move(i, -1)}
              aria-label="Move up"
              className="text-zinc-500 hover:text-white disabled:opacity-25"
            >
              <ArrowUp size={13} />
            </button>
            <span className="text-[10px] tabular-nums text-zinc-600">{i + 1}</span>
            <button
              type="button"
              disabled={disabled || i === order.length - 1}
              onClick={() => move(i, 1)}
              aria-label="Move down"
              className="text-zinc-500 hover:text-white disabled:opacity-25"
            >
              <ArrowDown size={13} />
            </button>
          </div>
          <div className="min-w-0 flex-1">{renderItem(item, i)}</div>
        </div>
      ))}
    </div>
  );
}
