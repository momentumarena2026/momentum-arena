"use client";

import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";
import { Plus, X } from "lucide-react";
import { ExpenseForm } from "../expenses/expense-form";

interface Options {
  PAYMENT_TYPE: string[];
  DONE_BY: string[];
  VENDOR: string[];
  SPENT_TYPE: string[];
  TO_NAME: string[];
}

// Same sheet chrome as the DQR checkout overlay (see
// components/payment/dqr-checkout.tsx): slide-up on mobile, pop on
// desktop. Unique `rexp-` prefix so the keyframes can't collide.
const SHEET_KEYFRAMES = `
@keyframes rexp-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes rexp-sheet-up { from { transform: translateY(100%) } to { transform: translateY(0) } }
@keyframes rexp-sheet-pop { from { opacity: 0; transform: translateY(8px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
.rexp-sheet { animation: rexp-sheet-up 250ms ease-out; }
@media (min-width: 640px) { .rexp-sheet { animation: rexp-sheet-pop 200ms ease-out; } }
`;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// "New Expense" button for the Running Expenses list — opens the create
// form in an overlay modal instead of navigating to the /new route, so
// the admin never loses their scroll position / filters. On save the
// modal closes and the list refreshes in place.
export function NewRunningExpenseButton({ options }: { options: Options }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
  }

  function handleSaved() {
    setOpen(false);
    router.refresh();
  }

  function handleBackdropClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
      >
        <Plus className="h-4 w-4" />
        New Expense
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
          style={{ animation: "rexp-fade-in 200ms ease-out" }}
          onClick={handleBackdropClick}
        >
          <style>{SHEET_KEYFRAMES}</style>
          <div className="rexp-sheet bg-zinc-900 border border-zinc-800 w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <p className="text-[15px] font-semibold text-white">
                New running expense
              </p>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-full p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4">
              <ExpenseForm
                mode="create"
                module="RUNNING"
                basePath="/admin/running-expenses"
                showVendor={false}
                onSaved={handleSaved}
                onCancel={close}
                initial={{
                  date: todayISO(),
                  description: "",
                  amount: 0,
                  paymentType: "",
                  doneBy: "",
                  toName: "",
                  vendor: "",
                  spentType: "",
                  note: "",
                }}
                options={options}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
