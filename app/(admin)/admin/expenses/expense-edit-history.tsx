"use client";

// Displays the ExpenseEditHistory audit trail for a single expense row.
// Each `changes` entry is a { field, from, to } triple, so we render
// each change as a diff line. CREATED entries have an empty changes
// array — we show a single "created" line instead.

import { formatExpenseAmount } from "@/lib/expenses";

type ChangeEntry = {
  field: string;
  from: string | number | null;
  to: string | number | null;
};

interface HistoryEntry {
  id: string;
  adminUsername: string | null;
  editType: string;
  changes: ChangeEntry[];
  note: string | null;
  createdAt: string;
}

const FIELD_LABELS: Record<string, string> = {
  date: "Date",
  description: "Description",
  amount: "Amount",
  paymentType: "Payment Type",
  doneBy: "Done By",
  toName: "To",
  vendor: "Vendor",
  spentType: "Spent Type",
  note: "Note",
};

function formatValue(field: string, value: string | number | null) {
  if (value == null || value === "") return <span className="text-zinc-600">—</span>;
  if (field === "amount" && typeof value === "number") {
    return <span>{formatExpenseAmount(value)}</span>;
  }
  return <span>{String(value)}</span>;
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const STYLES: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  CREATED: {
    label: "Created",
    bg: "bg-emerald-500/20",
    text: "text-emerald-300",
    dot: "bg-emerald-500",
  },
  UPDATED: {
    label: "Updated",
    bg: "bg-blue-500/20",
    text: "text-blue-300",
    dot: "bg-blue-500",
  },
};

function getStyle(type: string) {
  return (
    STYLES[type] ?? {
      label: type,
      bg: "bg-zinc-500/20",
      text: "text-zinc-300",
      dot: "bg-zinc-500",
    }
  );
}

export function ExpenseEditHistory({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) {
    return (
      <p className="text-sm text-zinc-500 italic">
        No edit history available.
      </p>
    );
  }

  return (
    <div className="relative">
      {history.map((entry, idx) => {
        const style = getStyle(entry.editType);
        const isLast = idx === history.length - 1;
        return (
          <div key={entry.id} className="relative flex gap-4 pb-5">
            {/* Timeline rail */}
            <div className="flex flex-col items-center">
              <div
                className={`h-3 w-3 rounded-full ${style.dot} ring-4 ring-zinc-900 shrink-0`}
              />
              {!isLast && <div className="w-px flex-1 bg-zinc-700 mt-1" />}
            </div>

            <div className="flex-1 -mt-0.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span
                  className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
                >
                  {style.label}
                </span>
                <span className="inline-flex items-center rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">
                  {entry.adminUsername || "system"}
                </span>
              </div>
              <p className="text-xs text-zinc-500 mb-2">
                {formatTimestamp(entry.createdAt)}
              </p>

              {entry.editType === "CREATED" && entry.changes.length === 0 ? (
                <p className="text-sm text-zinc-400">Expense created.</p>
              ) : null}

              {entry.changes.length > 0 && (
                <ul className="space-y-1 text-sm text-zinc-400">
                  {entry.changes.map((c, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-x-2">
                      <span className="text-zinc-300">
                        {FIELD_LABELS[c.field] || c.field}:
                      </span>
                      <span className="text-zinc-500">
                        {formatValue(c.field, c.from)}
                      </span>
                      <span className="text-zinc-600">→</span>
                      <span className="text-white">
                        {formatValue(c.field, c.to)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {entry.note && (
                <p className="mt-1 text-xs text-zinc-500 italic">
                  Note: {entry.note}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
