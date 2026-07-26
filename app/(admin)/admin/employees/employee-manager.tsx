"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Loader2, Pencil, UserCheck, UserX } from "lucide-react";
import {
  createEmployee,
  updateEmployee,
  setEmployeeStatus,
  type EmployeeDTO,
} from "@/actions/admin-employees";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-zinc-400";

const EMPTY = {
  name: "",
  phone: "",
  email: "",
  address: "",
  designation: "",
  department: "",
  salary: "",
  dateOfJoining: "",
  aadhaar: "",
};

function inr(n: number | null): string {
  if (n == null) return "—";
  return `₹${n.toLocaleString("en-IN")}`;
}

export function EmployeeManager({ employees }: { employees: EmployeeDTO[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<EmployeeDTO | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setError(null);
    setShowForm(true);
  };

  const openEdit = (e: EmployeeDTO) => {
    setEditing(e);
    setForm({
      name: e.name,
      phone: e.phone,
      email: e.email,
      address: e.address,
      designation: e.designation ?? "",
      department: e.department ?? "",
      salary: e.salaryMonthly != null ? String(e.salaryMonthly) : "",
      dateOfJoining: e.dateOfJoining ? e.dateOfJoining.slice(0, 10) : "",
      aadhaar: "",
    });
    setError(null);
    setShowForm(true);
  };

  const aadhaarDigits = form.aadhaar.replace(/\D/g, "");
  const canSubmit =
    form.name.trim() &&
    form.phone.trim() &&
    /^\S+@\S+\.\S+$/.test(form.email.trim()) &&
    form.address.trim();

  const handleSave = async () => {
    setError(null);
    if (!canSubmit) {
      setError("Name, phone, a valid email and address are required.");
      return;
    }
    if (aadhaarDigits && aadhaarDigits.length !== 12) {
      setError("Aadhaar must be exactly 12 digits (or left blank).");
      return;
    }
    const salaryNum = form.salary.replace(/[^\d]/g, "");
    const payload = {
      name: form.name,
      phone: form.phone,
      email: form.email,
      address: form.address,
      designation: form.designation,
      department: form.department,
      salaryMonthly: salaryNum === "" ? null : Number(salaryNum),
      dateOfJoining: form.dateOfJoining,
      aadhaar: aadhaarDigits,
    };
    setSaving(true);
    try {
      const res = editing
        ? await updateEmployee(editing.id, payload)
        : await createEmployee(payload);
      if (!res.success) {
        setError(res.error || "Failed to save");
        return;
      }
      setShowForm(false);
      setForm({ ...EMPTY });
      setEditing(null);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (e: EmployeeDTO) => {
    setBusyId(e.id);
    try {
      await setEmployeeStatus(e.id, e.status === "ACTIVE" ? "INACTIVE" : "ACTIVE");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {!showForm && (
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-4 py-3 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20"
        >
          <Plus className="h-4 w-4" />
          New Employee
        </button>
      )}

      {showForm && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-white">
              {editing ? `Edit — ${editing.name}` : "New Employee"}
            </h3>
            <button onClick={() => setShowForm(false)}>
              <X className="h-4 w-4 text-zinc-500 hover:text-zinc-300" />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Full Name *</label>
              <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Phone *</label>
              <input className={inputCls} inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Email *</label>
              <input className={inputCls} inputMode="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>
                Aadhaar {aadhaarDigits ? `(${aadhaarDigits.length}/12)` : ""}
              </label>
              <input
                className={inputCls}
                inputMode="numeric"
                placeholder={editing ? (editing.aadhaarLast4 ? `•••• •••• ${editing.aadhaarLast4} — blank to keep` : "12 digits") : "12 digits (needed for NDA)"}
                value={form.aadhaar}
                onChange={(e) => set("aadhaar", e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Designation</label>
              <input className={inputCls} placeholder="e.g. Front Desk Executive" value={form.designation} onChange={(e) => set("designation", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Department</label>
              <input className={inputCls} placeholder="e.g. Operations" value={form.department} onChange={(e) => set("department", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Salary (₹ / month)</label>
              <input className={inputCls} inputMode="numeric" placeholder="e.g. 25000" value={form.salary} onChange={(e) => set("salary", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Date of Joining</label>
              <input type="date" className={inputCls} value={form.dateOfJoining} onChange={(e) => set("dateOfJoining", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Address *</label>
              <textarea className={inputCls} rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} />
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/10 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editing ? "Save Changes" : "Create Employee"}
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Employee table */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="mb-4 font-medium text-white">
          All Employees <span className="text-sm font-normal text-zinc-500">({employees.length})</span>
        </h3>
        {employees.length === 0 ? (
          <p className="text-sm text-zinc-500">No employees yet. Add one to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Designation</th>
                  <th className="py-2 pr-4 font-medium">Contact</th>
                  <th className="py-2 pr-4 font-medium">Salary / mo</th>
                  <th className="py-2 pr-4 font-medium">Aadhaar</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="border-b border-zinc-800/60">
                    <td className="py-2.5 pr-4 text-white">
                      {e.name}
                      {e.department && <div className="text-xs text-zinc-500">{e.department}</div>}
                    </td>
                    <td className="py-2.5 pr-4 text-zinc-400">{e.designation || "—"}</td>
                    <td className="py-2.5 pr-4 text-zinc-400">
                      <div>{e.phone}</div>
                      <div className="text-xs text-zinc-500">{e.email}</div>
                    </td>
                    <td className="py-2.5 pr-4 text-zinc-300">
                      {inr(e.salaryMonthly)}
                      {e.salaryMonthly != null && (
                        <div className="text-xs text-zinc-500">{inr(e.salaryMonthly * 12)}/yr</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-zinc-400">
                      {e.hasAadhaar ? `•••• ${e.aadhaarLast4}` : <span className="text-amber-500/80">missing</span>}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className={e.status === "ACTIVE" ? "text-emerald-400" : "text-zinc-500"}>
                        {e.status === "ACTIVE" ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(e)} className="rounded-lg border border-zinc-700 p-1.5 text-zinc-300 hover:bg-zinc-800" title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => toggleStatus(e)}
                          disabled={busyId === e.id}
                          className="rounded-lg border border-zinc-700 p-1.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                          title={e.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        >
                          {busyId === e.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : e.status === "ACTIVE" ? (
                            <UserX className="h-3.5 w-3.5" />
                          ) : (
                            <UserCheck className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
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
