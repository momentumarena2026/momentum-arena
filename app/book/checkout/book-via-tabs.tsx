"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ticket, Wallet, Loader2 } from "lucide-react";
import { setHoldBookVia } from "@/actions/booking";

/**
 * "Book via" — the top-level checkout switch shown only when the
 * customer holds an eligible pass. Tab 1 is "Pass" (full coverage:
 * one-tap book) or "Pass + Pay" (partial: the whole regular checkout
 * repriced on the remainder). Tab 2 is the untouched regular flow.
 * Switching flips the hold's pass mode server-side (which also clears
 * any applied coupon/points — they reprice on the new base) and
 * refreshes the page so every server-derived number recomputes.
 */
export function BookViaTabs({
  holdId,
  active,
  passLabel,
}: {
  holdId: string;
  active: "pass" | "online";
  passLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pick(via: "pass" | "online") {
    if (via === active || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await setHoldBookVia(holdId, via);
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const tabs = [
    { id: "pass" as const, label: passLabel, Icon: Ticket },
    { id: "online" as const, label: "Online Payment", Icon: Wallet },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-1.5">
        {tabs.map((t) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => pick(t.id)}
              disabled={pending}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
                isActive
                  ? "bg-emerald-600 text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
              }`}
            >
              {pending && !isActive ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <t.Icon className="h-4 w-4" />
              )}
              {t.label}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}
    </div>
  );
}
