"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users, X, Loader2, UserPlus, Trash2, MessageCircle } from "lucide-react";
import {
  adjustPassMinutes,
  cancelUserPass,
  extendPassValidity,
  adminGetPassMembers,
  adminAddPassMember,
  adminRemovePassMember,
} from "@/actions/admin-passes";
import { PhoneInput } from "@/components/ui/phone-input";

interface Sold {
  id: string;
  name: string;
  customer: string;
  phone: string;
  totalMinutes: number;
  remainingMinutes: number;
  price: number;
  status: string;
  method: string;
  purchasedAt: string;
  startsAt: string;
  expiresAt: string;
  redemptionCount: number;
  memberCount: number;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const hrs = (m: number) => `${(m / 60).toFixed(1).replace(/\.0$/, "")}h`;
const dt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
  });

/** Sold-pass management: search, extend validity, adjust balance,
 *  cancel. Refunds stay manual (gateway dashboard) per policy. */
export function SoldPasses({ passes }: { passes: Sold[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [membersFor, setMembersFor] = useState<Sold | null>(null);

  const filtered = passes.filter(
    (p) =>
      !q ||
      p.phone.includes(q) ||
      p.customer.toLowerCase().includes(q.toLowerCase()),
  );

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Sold passes</h2>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name / phone…"
          className="w-56 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-600 focus:outline-none"
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {filtered.length === 0 ? (
        <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
          No passes sold yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Pass</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Paid</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-zinc-800/60 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{p.customer}</p>
                    <p className="text-xs text-zinc-500">{p.phone}</p>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">
                    {p.name}
                    <p className="text-xs text-zinc-500">
                      bought {dt(p.purchasedAt)} · {p.redemptionCount} redemption(s)
                    </p>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">
                    {hrs(p.remainingMinutes)} / {hrs(p.totalMinutes)}
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{inr(p.price)}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                      {p.method}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">
                    {dt(p.expiresAt)}
                    {p.status === "UPCOMING" && (
                      <span className="block text-[11px] text-amber-400">
                        starts {dt(p.startsAt)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {/* Cancellation is terminal — members stay viewable,
                        everything else is off. */}
                    {p.status === "CANCELLED" ? (
                      <div className="flex justify-end">
                        <button
                          disabled={pending}
                          onClick={() => setMembersFor(p)}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                        >
                          <Users className="h-3.5 w-3.5" /> {p.memberCount}
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2 text-xs">
                        <button
                          disabled={pending}
                          onClick={() => setMembersFor(p)}
                          title="Shared members"
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
                        >
                          <Users className="h-3.5 w-3.5" /> {p.memberCount}
                        </button>
                        <button
                          disabled={pending}
                          onClick={() => {
                            const d = window.prompt("Extend validity by how many days?", "7");
                            if (!d) return;
                            run(() => extendPassValidity(p.id, parseInt(d, 10)));
                          }}
                          className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
                        >
                          Extend
                        </button>
                        <button
                          disabled={pending}
                          onClick={() => {
                            const m = window.prompt(
                              "Adjust balance by minutes (e.g. 60 or -30):",
                              "60",
                            );
                            if (!m) return;
                            run(() => adjustPassMinutes(p.id, parseInt(m, 10)));
                          }}
                          className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
                        >
                          Adjust
                        </button>
                        <button
                          disabled={pending}
                          onClick={() => {
                            if (!window.confirm(`Cancel ${p.customer}'s pass? Refund (if any) is manual via the gateway dashboard.`)) return;
                            run(() => cancelUserPass(p.id));
                          }}
                          className="rounded-md border border-red-900/50 px-2 py-1 text-red-400 hover:bg-red-500/10"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {membersFor && (
        <MembersModal pass={membersFor} onClose={() => setMembersFor(null)} />
      )}
    </div>
  );
}

/** Shared-member management for one pass — list, add by phone (with a
 *  WhatsApp invite fallback for unregistered numbers), remove. */
function MembersModal({ pass, onClose }: { pass: Sold; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [data, setData] = useState<Awaited<
    ReturnType<typeof adminGetPassMembers>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invitePhone, setInvitePhone] = useState<string | null>(null);

  async function reload() {
    const d = await adminGetPassMembers(pass.id).catch(() => null);
    setData(d);
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pass.id]);

  function add() {
    if (phone.length !== 10) return;
    setError(null);
    setInvitePhone(null);
    start(async () => {
      const res = await adminAddPassMember(pass.id, phone);
      if (!res.ok) {
        setError(res.error);
        if (res.notRegistered && res.phone) setInvitePhone(res.phone);
        return;
      }
      setPhone("");
      await reload();
      router.refresh();
    });
  }

  function remove(userId: string) {
    start(async () => {
      await adminRemovePassMember(pass.id, userId);
      await reload();
      router.refresh();
    });
  }

  const cancelled = pass.status === "CANCELLED";
  const atCap = !!data && data.members.length >= data.maxMembers;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-white">
              <Users className="h-4 w-4 text-emerald-400" /> Shared members
            </h3>
            <p className="text-xs text-zinc-500">
              {pass.name} · {pass.customer}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
          </div>
        ) : !data ? (
          <p className="text-sm text-red-400">Couldn&apos;t load members.</p>
        ) : (
          <>
            <p className="text-xs text-zinc-500">
              {data.maxMembers > 0
                ? `${data.members.length}/${data.maxMembers} members added. Members can book with this pass; the owner stays in charge of the list.`
                : "Sharing is off for this court — set a member limit in the Pass sharing card first."}
            </p>

            <div className="space-y-2">
              {data.members.map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{m.name ?? "—"}</p>
                    <p className="text-xs text-zinc-500">{m.phone ?? "—"}</p>
                  </div>
                  <button
                    onClick={() => remove(m.userId)}
                    disabled={pending}
                    title="Remove member"
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {data.members.length === 0 && (
                <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-3 text-center text-xs text-zinc-500">
                  No members yet.
                </p>
              )}
            </div>

            {!cancelled && data.maxMembers > 0 && !atCap && (
              <div>
                <div className="flex gap-2">
                  <PhoneInput
                    value={phone}
                    onChange={setPhone}
                    placeholder="10-digit mobile"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-600 focus:outline-none"
                  />
                  <button
                    onClick={add}
                    disabled={pending || phone.length !== 10}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {pending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4" />
                    )}
                    Add
                  </button>
                </div>
                {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}
                {invitePhone && (
                  <a
                    href={`https://wa.me/${invitePhone}?text=${encodeURIComponent(
                      `Hi! Momentum Arena here — you've been offered a spot on a shared "${pass.name}" pass 🎟️. Sign up at ${typeof window !== "undefined" ? window.location.origin : "momentumarena.com"} with this number and we'll add you right away!`,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] px-3 py-2 text-sm font-semibold text-black hover:opacity-90"
                  >
                    <MessageCircle className="h-4 w-4" /> Invite via WhatsApp
                  </a>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
