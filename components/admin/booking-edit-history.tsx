"use client";

import { formatHoursAsRanges } from "@/lib/court-config";

interface BookingEditHistoryProps {
  history: {
    id: string;
    adminUsername: string;
    editType: string;
    previousDate: string | null;
    newDate: string | null;
    previousSlots: number[];
    newSlots: number[];
    previousCourtConfigId: string | null;
    newCourtConfigId: string | null;
    previousAmount: number | null;
    newAmount: number | null;
    note: string | null;
    createdAt: string;
  }[];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const EDIT_TYPE_STYLES: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  CREATED: {
    label: "Created",
    bg: "bg-emerald-500/20",
    text: "text-emerald-300",
    dot: "bg-emerald-500",
  },
  SLOTS_CHANGED: {
    label: "Slots Changed",
    bg: "bg-blue-500/20",
    text: "text-blue-300",
    dot: "bg-blue-500",
  },
  DATE_CHANGED: {
    label: "Date Changed",
    bg: "bg-yellow-500/20",
    text: "text-yellow-300",
    dot: "bg-yellow-500",
  },
  COURT_CHANGED: {
    label: "Court Changed",
    bg: "bg-purple-500/20",
    text: "text-purple-300",
    dot: "bg-purple-500",
  },
};

function getTypeStyle(editType: string) {
  return (
    EDIT_TYPE_STYLES[editType] ?? {
      label: editType,
      bg: "bg-zinc-500/20",
      text: "text-zinc-300",
      dot: "bg-zinc-500",
    }
  );
}

export function BookingEditHistory({ history }: BookingEditHistoryProps) {
  if (history.length === 0) {
    return (
      <p className="text-sm text-zinc-500 italic">No edit history available.</p>
    );
  }

  return (
    <div className="relative">
      {history.map((entry, index) => {
        const style = getTypeStyle(entry.editType);
        const isLast = index === history.length - 1;

        return (
          <div key={entry.id} className="relative flex gap-4 pb-6">
            {/* Timeline line + dot */}
            <div className="flex flex-col items-center">
              <div
                className={`h-3 w-3 rounded-full ${style.dot} ring-4 ring-zinc-900 shrink-0`}
              />
              {!isLast && (
                <div className="w-px flex-1 bg-zinc-700 mt-1" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 -mt-0.5 min-w-0">
              {/* Header row */}
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span
                  className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
                >
                  {style.label}
                </span>
                <span className="inline-flex items-center rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">
                  {entry.adminUsername}
                </span>
              </div>

              {/* Timestamp */}
              <p className="text-xs text-zinc-500 mb-2">
                {formatTimestamp(entry.createdAt)}
              </p>

              {/* Change details */}
              <div className="space-y-1 text-sm text-zinc-400">
                {entry.editType === "CREATED" && (
                  <p>Booking created by admin</p>
                )}

                {entry.editType === "SLOTS_CHANGED" && (
                  <p>
                    Slots:{" "}
                    <span className="text-zinc-500">
                      {formatHoursAsRanges(entry.previousSlots)}
                    </span>{" "}
                    <span className="text-zinc-600">&rarr;</span>{" "}
                    <span className="text-white">
                      {formatHoursAsRanges(entry.newSlots)}
                    </span>
                  </p>
                )}

                {entry.editType === "DATE_CHANGED" &&
                  entry.previousDate &&
                  entry.newDate && (
                    <p>
                      Date:{" "}
                      <span className="text-zinc-500">
                        {formatDate(entry.previousDate)}
                      </span>{" "}
                      <span className="text-zinc-600">&rarr;</span>{" "}
                      <span className="text-white">
                        {formatDate(entry.newDate)}
                      </span>
                    </p>
                  )}

                {entry.editType === "COURT_CHANGED" && (
                  <p>Court configuration changed</p>
                )}

                {entry.previousAmount !== null &&
                  entry.newAmount !== null &&
                  entry.previousAmount !== entry.newAmount && (
                    <p>
                      Amount:{" "}
                      <span className="text-zinc-500">
                        ₹{entry.previousAmount.toLocaleString("en-IN")}
                      </span>{" "}
                      <span className="text-zinc-600">&rarr;</span>{" "}
                      <span className="text-white">
                        ₹{entry.newAmount.toLocaleString("en-IN")}
                      </span>
                    </p>
                  )}

                {entry.note && (
                  <p className="text-xs text-zinc-500 italic">
                    Note: {entry.note}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
