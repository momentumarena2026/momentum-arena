"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, ShieldCheck } from "lucide-react";

type NdaRow = {
  id: string;
  employeeName: string;
  employeePhone: string;
  employeeEmail: string;
  aadhaarLast4: string;
  generatedByName: string;
  createdAt: string;
};

const EMPTY = { name: "", phone: "", email: "", aadhaar: "", address: "" };

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-zinc-400";

export function NdaGenerator({ records }: { records: NdaRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aadhaarDigits = form.aadhaar.replace(/\D/g, "");
  const canSubmit =
    form.name.trim() &&
    form.phone.replace(/\D/g, "").length >= 10 &&
    /^\S+@\S+\.\S+$/.test(form.email.trim()) &&
    form.address.trim() &&
    aadhaarDigits.length === 12;

  const handleGenerate = async () => {
    setError(null);
    if (!canSubmit) {
      setError("Fill every field. Aadhaar must be 12 digits and the email valid.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/nda/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate the NDA");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `NDA-${form.name.trim().replace(/[^a-z0-9]+/gi, "-") || "employee"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setForm(EMPTY);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Generator form */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="mb-4 flex items-center gap-2">
          <FileText className="h-5 w-5 text-emerald-400" />
          <h3 className="font-medium text-white">Employee Details</h3>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Full Name</label>
            <input
              className={inputCls}
              placeholder="As per Aadhaar"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input
              className={inputCls}
              placeholder="10-digit mobile"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input
              className={inputCls}
              placeholder="name@example.com"
              inputMode="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelCls}>
              Aadhaar Number{" "}
              <span className="text-zinc-500">
                ({aadhaarDigits.length}/12)
              </span>
            </label>
            <input
              className={inputCls}
              placeholder="12 digits"
              inputMode="numeric"
              value={form.aadhaar}
              onChange={(e) => setForm((f) => ({ ...f, aadhaar: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Address</label>
            <textarea
              className={inputCls}
              rows={2}
              placeholder="Full residential address"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </div>
        </div>

        {/* Privacy note */}
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p className="text-xs leading-relaxed text-zinc-400">
            The full Aadhaar is used only to print the PDF and is{" "}
            <span className="text-zinc-200">never stored</span>. The audit log
            below keeps only the last 4 digits (per the DPDP Act, 2023). Rows
            can&apos;t re-produce the PDF — to reissue, re-enter the details.
          </p>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button
          onClick={handleGenerate}
          disabled={!canSubmit || generating}
          className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-4 py-3 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
          {generating ? "Generating…" : "Generate NDA PDF"}
        </button>
      </div>

      {/* Audit log */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-4 font-medium text-white">
          Recent NDAs{" "}
          <span className="text-sm font-normal text-zinc-500">
            ({records.length})
          </span>
        </h3>
        {records.length === 0 ? (
          <p className="text-sm text-zinc-500">No NDAs generated yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-2 pr-4 font-medium">Employee</th>
                  <th className="py-2 pr-4 font-medium">Contact</th>
                  <th className="py-2 pr-4 font-medium">Aadhaar</th>
                  <th className="py-2 pr-4 font-medium">Generated By</th>
                  <th className="py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-800/60">
                    <td className="py-2.5 pr-4 text-white">{r.employeeName}</td>
                    <td className="py-2.5 pr-4 text-zinc-400">
                      <div>{r.employeePhone}</div>
                      <div className="text-xs text-zinc-500">{r.employeeEmail}</div>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-zinc-400">
                      XXXX XXXX {r.aadhaarLast4}
                    </td>
                    <td className="py-2.5 pr-4 text-zinc-400">{r.generatedByName}</td>
                    <td className="py-2.5 text-zinc-400">
                      {new Date(r.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
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
