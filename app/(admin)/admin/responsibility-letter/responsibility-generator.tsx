"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Loader2, ShieldCheck } from "lucide-react";

type EmployeeOption = { id: string; name: string; designation: string | null };
type ItemOption = { id: string; text: string };
type LetterRow = {
  id: string;
  employeeName: string;
  designation: string | null;
  count: number;
  generatedByName: string;
  createdAt: string;
};

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white focus:border-emerald-500/50 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-zinc-400";

export function ResponsibilityGenerator({
  employees,
  items,
  records,
}: {
  employees: EmployeeOption[];
  items: ItemOption[];
  records: LetterRow[];
}) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));

  const canSubmit = !!employeeId && selected.size > 0;

  const handleGenerate = async () => {
    setError(null);
    if (!employeeId) {
      setError("Select an employee first.");
      return;
    }
    if (selected.size === 0) {
      setError("Tick at least one responsibility.");
      return;
    }
    setGenerating(true);
    try {
      const emp = employees.find((e) => e.id === employeeId);
      const res = await fetch("/api/admin/responsibility-letter/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, itemIds: [...selected] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate the letter");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Responsibilities-${(emp?.name || "employee").replace(/[^a-z0-9]+/gi, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="mb-4 flex items-center gap-2">
          <FileText className="h-5 w-5 text-emerald-400" />
          <h3 className="font-medium text-white">Generate Responsibility Letter</h3>
        </div>

        {employees.length === 0 ? (
          <p className="text-sm text-zinc-400">
            No active employees yet.{" "}
            <Link href="/admin/employees" className="text-emerald-400 underline">
              Add an employee
            </Link>{" "}
            first.
          </p>
        ) : (
          <>
            <div className="mb-4">
              <label className={labelCls}>Employee</label>
              <select className={inputCls} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">Select an employee…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.designation ? ` — ${e.designation}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-2 flex items-center justify-between">
              <label className={labelCls}>
                Responsibilities to assign{" "}
                <span className="text-zinc-500">({selected.size} selected)</span>
              </label>
              {items.length > 0 && (
                <button onClick={toggleAll} className="text-xs text-emerald-400 hover:underline">
                  {allSelected ? "Clear all" : "Select all"}
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-zinc-300">
                No enabled responsibility items.{" "}
                <Link href="/admin/responsibilities" className="text-amber-300 underline">
                  Add some on the Responsibilities screen
                </Link>{" "}
                first.
              </p>
            ) : (
              <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-zinc-800 p-2">
                {items.map((item) => {
                  const checked = selected.has(item.id);
                  return (
                    <label
                      key={item.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-lg p-2.5 text-sm ${
                        checked ? "bg-emerald-600/10 text-white" : "text-zinc-300 hover:bg-zinc-800/60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-emerald-500"
                        checked={checked}
                        onChange={() => toggle(item.id)}
                      />
                      <span>{item.text}</span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <p className="text-xs leading-relaxed text-zinc-400">
                The letter lists the ticked responsibilities and is stamped &amp;
                signed by Nakul Varshney (Authorised Signatory).
              </p>
            </div>

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <button
              onClick={handleGenerate}
              disabled={!canSubmit || generating}
              className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-4 py-3 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {generating ? "Generating…" : "Generate Responsibility Letter PDF"}
            </button>
          </>
        )}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-4 font-medium text-white">
          Recent Letters <span className="text-sm font-normal text-zinc-500">({records.length})</span>
        </h3>
        {records.length === 0 ? (
          <p className="text-sm text-zinc-500">No responsibility letters generated yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-2 pr-4 font-medium">Employee</th>
                  <th className="py-2 pr-4 font-medium">Designation</th>
                  <th className="py-2 pr-4 font-medium">Items</th>
                  <th className="py-2 pr-4 font-medium">Generated By</th>
                  <th className="py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-800/60">
                    <td className="py-2.5 pr-4 text-white">{r.employeeName}</td>
                    <td className="py-2.5 pr-4 text-zinc-400">{r.designation || "—"}</td>
                    <td className="py-2.5 pr-4 text-zinc-300">{r.count}</td>
                    <td className="py-2.5 pr-4 text-zinc-400">{r.generatedByName}</td>
                    <td className="py-2.5 text-zinc-400">
                      {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
