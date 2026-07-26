"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Loader2, AlertTriangle, ShieldCheck } from "lucide-react";

type EmployeeOption = {
  id: string;
  name: string;
  designation: string | null;
  salaryMonthly: number | null;
  dateOfJoining: string | null; // ISO
};

type OfferRow = {
  id: string;
  employeeName: string;
  designation: string;
  salaryMonthly: number;
  dateOfJoining: string | null;
  generatedByName: string;
  createdAt: string;
};

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white focus:border-emerald-500/50 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-zinc-400";

const inr = (n: number | null) => (n == null ? "—" : `₹${n.toLocaleString("en-IN")}`);

export function OfferGenerator({
  employees,
  records,
}: {
  employees: EmployeeOption[];
  records: OfferRow[];
}) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [joining, setJoining] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = employees.find((e) => e.id === employeeId) || null;
  const missing: string[] = [];
  if (selected) {
    if (!selected.designation) missing.push("designation");
    if (selected.salaryMonthly == null) missing.push("monthly salary");
  }
  const effectiveJoining = joining || (selected?.dateOfJoining ? selected.dateOfJoining.slice(0, 10) : "");
  const canSubmit = !!selected && missing.length === 0 && !!effectiveJoining;

  const onSelect = (id: string) => {
    setEmployeeId(id);
    setError(null);
    const e = employees.find((x) => x.id === id);
    setJoining(e?.dateOfJoining ? e.dateOfJoining.slice(0, 10) : "");
  };

  const handleGenerate = async () => {
    setError(null);
    if (!selected) {
      setError("Select an employee first.");
      return;
    }
    if (missing.length > 0) {
      setError(`Set the employee's ${missing.join(" and ")} on the Employees screen first.`);
      return;
    }
    if (!effectiveJoining) {
      setError("Provide a date of joining.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/offer-letter/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: selected.id, dateOfJoining: effectiveJoining }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate the offer letter");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Offer-Letter-${selected.name.replace(/[^a-z0-9]+/gi, "-") || "employee"}.pdf`;
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
          <h3 className="font-medium text-white">Generate Offer Letter</h3>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Employee</label>
                <select className={inputCls} value={employeeId} onChange={(e) => onSelect(e.target.value)}>
                  <option value="">Select an employee…</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.designation ? ` — ${e.designation}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Date of Joining</label>
                <input type="date" className={inputCls} value={effectiveJoining} onChange={(e) => setJoining(e.target.value)} />
              </div>
            </div>

            {selected && (
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-zinc-800 bg-zinc-800/40 p-3 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-xs text-zinc-500">Designation</div>
                  <div className="text-zinc-200">{selected.designation || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Salary / month</div>
                  <div className="text-zinc-200">{inr(selected.salaryMonthly)}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Approx. / year</div>
                  <div className="text-zinc-200">{selected.salaryMonthly != null ? inr(selected.salaryMonthly * 12) : "—"}</div>
                </div>
              </div>
            )}

            {selected && missing.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <p className="text-xs text-zinc-300">
                  {selected.name} is missing {missing.join(" and ")}.{" "}
                  <Link href="/admin/employees" className="text-amber-300 underline">
                    Set it on the Employees screen
                  </Link>
                  .
                </p>
              </div>
            )}

            <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <p className="text-xs leading-relaxed text-zinc-400">
                Compensation is taken from the employee record. The letter is
                stamped &amp; signed by Nakul Varshney (Authorised Signatory).
              </p>
            </div>

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <button
              onClick={handleGenerate}
              disabled={!canSubmit || generating}
              className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-4 py-3 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {generating ? "Generating…" : "Generate Offer Letter PDF"}
            </button>
          </>
        )}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-4 font-medium text-white">
          Recent Offer Letters <span className="text-sm font-normal text-zinc-500">({records.length})</span>
        </h3>
        {records.length === 0 ? (
          <p className="text-sm text-zinc-500">No offer letters generated yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-2 pr-4 font-medium">Employee</th>
                  <th className="py-2 pr-4 font-medium">Designation</th>
                  <th className="py-2 pr-4 font-medium">Salary / mo</th>
                  <th className="py-2 pr-4 font-medium">Joining</th>
                  <th className="py-2 pr-4 font-medium">Generated By</th>
                  <th className="py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-800/60">
                    <td className="py-2.5 pr-4 text-white">{r.employeeName}</td>
                    <td className="py-2.5 pr-4 text-zinc-400">{r.designation}</td>
                    <td className="py-2.5 pr-4 text-zinc-300">{inr(r.salaryMonthly)}</td>
                    <td className="py-2.5 pr-4 text-zinc-400">
                      {r.dateOfJoining
                        ? new Date(r.dateOfJoining).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                        : "—"}
                    </td>
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
