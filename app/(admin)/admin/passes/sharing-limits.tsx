"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users, Check, Loader2 } from "lucide-react";
import {
  setPassSharingLimit,
  type PassConfigOption,
} from "@/actions/admin-passes";

const sportName = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/**
 * Per sport / sub-sport shared-member caps. A pass on that court may be
 * shared with up to N additional members (0 = sharing off). The setter
 * writes the value to every config in the interchangeable court group,
 * so "Half Court" covers both halves.
 */
export function SharingLimits({ configs }: { configs: PassConfigOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(configs.map((c) => [c.id, String(c.maxPassMembers)])),
  );
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function save(configId: string) {
    const max = Number.parseInt(values[configId] ?? "0", 10);
    setError(null);
    setSavedId(null);
    start(async () => {
      const res = await setPassSharingLimit(
        configId,
        Number.isNaN(max) ? 0 : max,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedId(configId);
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-white">
        <Users className="h-4 w-4 text-emerald-400" /> Pass sharing — member
        limits
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        How many people (besides the owner) a pass can be shared with, per
        sport / sub-sport. 0 turns sharing off. Members book with the pass;
        only the owner (or you) can edit the member list.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {configs.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-200">{c.label}</p>
              <p className="text-[11px] text-zinc-500">{sportName(c.sport)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={30}
                value={values[c.id] ?? "0"}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [c.id]: e.target.value }))
                }
                className="w-16 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-center text-sm text-white focus:border-emerald-600 focus:outline-none"
              />
              <button
                onClick={() => save(c.id)}
                disabled={pending}
                title="Save limit"
                className="rounded-md border border-zinc-700 p-1.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : savedId === c.id ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </section>
  );
}
