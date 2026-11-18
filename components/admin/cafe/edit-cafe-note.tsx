"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCafeOrderNote } from "@/actions/admin-cafe-orders";
import { Loader2, Pencil, StickyNote, X } from "lucide-react";

const MAX = 500;

/**
 * Inline note editor on the admin cafe order detail page.
 *
 * Collapsed it is the note as it reads today (or a prompt to add one),
 * with a pencil. Open it is a textarea, Save and Cancel.
 *
 * Two deliberate shapes:
 *
 *  - It renders even when the note is empty, because "add a note to an
 *    order that didn't have one" is the more common need than fixing a
 *    typo in one that did.
 *  - Saving an unchanged note is a no-op on the server rather than an
 *    error, so a stray Save does not litter the order's history.
 */
export function EditCafeNote({
  orderId,
  note,
}: {
  orderId: string;
  note: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);

  function openEditor() {
    // Re-seed from the prop, not from the last draft: the page may have
    // been refreshed by another edit since this component mounted.
    setDraft(note ?? "");
    setError(null);
    setOpen(true);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateCafeOrderNote(orderId, draft);
      if (result.success) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="mt-2 flex items-start gap-2">
        <StickyNote className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
        {note ? (
          <p className="min-w-0 flex-1 text-xs italic text-zinc-400 break-words">
            {note}
          </p>
        ) : (
          <p className="min-w-0 flex-1 text-xs italic text-zinc-600">
            No note on this order
          </p>
        )}
        <button
          type="button"
          onClick={openEditor}
          className="flex flex-shrink-0 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          <Pencil className="h-3 w-3" />
          {note ? "Edit" : "Add note"}
        </button>
      </div>
    );
  }

  const over = draft.trim().length > MAX;

  return (
    <div className="mt-2 space-y-2">
      <label
        htmlFor="cafe-order-note"
        className="block text-[11px] font-medium text-zinc-400"
      >
        Order note
      </label>
      <textarea
        id="cafe-order-note"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        maxLength={MAX + 50}
        placeholder="Table number, allergy, anything the kitchen or the counter needs"
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm text-white placeholder-zinc-500"
      />
      <div className="flex items-center justify-between gap-3">
        <span
          className={`text-[10px] ${over ? "text-red-400" : "text-zinc-600"}`}
        >
          {draft.trim().length}/{MAX}
          {draft.trim() === "" && note ? " — saving clears the note" : ""}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={isPending}
            className="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-60"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isPending || over}
            className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : null}
            Save note
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
