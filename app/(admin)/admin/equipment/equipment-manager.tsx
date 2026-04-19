"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createEquipment,
  updateEquipment,
  deleteEquipment,
} from "@/actions/admin-equipment";
import { Sport } from "@prisma/client";
import { formatPrice } from "@/lib/pricing";
import { Plus, X, Loader2, Package, Pencil, Trash2 } from "lucide-react";

interface EquipmentRow {
  id: string;
  name: string;
  sport: Sport | null;
  pricePerHour: number;
  totalUnits: number;
  availableUnits: number;
  isActive: boolean;
  imageUrl: string | null;
  rentalCount: number;
}

const SPORTS: { value: Sport | ""; label: string }[] = [
  { value: "", label: "All Sports" },
  { value: "CRICKET", label: "Cricket" },
  { value: "FOOTBALL", label: "Football" },
  { value: "PICKLEBALL", label: "Pickleball" },
];

const defaultForm = {
  name: "",
  sport: "" as Sport | "",
  pricePerHour: "",
  totalUnits: "1",
  imageUrl: "",
};

export function EquipmentManager({ equipment }: { equipment: EquipmentRow[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);

  const resetForm = () => {
    setForm(defaultForm);
    setEditingId(null);
    setError(null);
  };

  const handleEdit = (eq: EquipmentRow) => {
    setForm({
      name: eq.name,
      sport: eq.sport || "",
      pricePerHour: String(eq.pricePerHour / 100),
      totalUnits: String(eq.totalUnits),
      imageUrl: eq.imageUrl || "",
    });
    setEditingId(eq.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const pricePerHour = Math.round(parseFloat(form.pricePerHour) * 100);
    const totalUnits = parseInt(form.totalUnits);

    if (isNaN(pricePerHour) || pricePerHour <= 0) {
      setError("Price must be greater than 0");
      setSaving(false);
      return;
    }

    if (isNaN(totalUnits) || totalUnits <= 0) {
      setError("Units must be at least 1");
      setSaving(false);
      return;
    }

    const data = {
      name: form.name,
      sport: (form.sport as Sport) || null,
      pricePerHour,
      totalUnits,
      imageUrl: form.imageUrl || undefined,
    };

    let result;
    if (editingId) {
      result = await updateEquipment(editingId, data);
    } else {
      result = await createEquipment(data);
    }

    if (result.success) {
      resetForm();
      setShowForm(false);
      router.refresh();
    } else {
      setError(result.error || "Failed to save");
    }
    setSaving(false);
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    await updateEquipment(id, { isActive: !isActive });
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this equipment? This cannot be undone.")) return;
    const result = await deleteEquipment(id);
    if (result.success) {
      router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      {/* Add / Edit Form */}
      {!showForm ? (
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 rounded-xl bg-emerald-600/10 border border-emerald-500/30 px-4 py-3 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Equipment
        </button>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-white">
              {editingId ? "Edit Equipment" : "New Equipment"}
            </h3>
            <button
              onClick={() => { setShowForm(false); resetForm(); }}
              className="text-zinc-500 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Equipment name (e.g., Cricket Bat)"
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <select
              value={form.sport}
              onChange={(e) => setForm((p) => ({ ...p, sport: e.target.value as Sport | "" }))}
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
            >
              {SPORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <span className="text-zinc-400 text-sm">₹</span>
              <input
                type="number"
                value={form.pricePerHour}
                onChange={(e) => setForm((p) => ({ ...p, pricePerHour: e.target.value }))}
                placeholder="Price per hour (₹)"
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
              />
            </div>
            <input
              type="number"
              min="1"
              value={form.totalUnits}
              onChange={(e) => setForm((p) => ({ ...p, totalUnits: e.target.value }))}
              placeholder="Total units available"
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <input
              type="url"
              value={form.imageUrl}
              onChange={(e) => setForm((p) => ({ ...p, imageUrl: e.target.value }))}
              placeholder="Image URL (optional)"
              className="sm:col-span-2 rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving || !form.name || !form.pricePerHour}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </span>
            ) : editingId ? (
              "Update Equipment"
            ) : (
              "Create Equipment"
            )}
          </button>
        </div>
      )}

      {/* Equipment List */}
      <div className="space-y-2">
        {equipment.map((eq) => (
          <div
            key={eq.id}
            className={`rounded-xl border p-4 ${
              eq.isActive
                ? "border-zinc-800 bg-zinc-900"
                : "border-zinc-800/50 bg-zinc-900/50 opacity-60"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-zinc-800 p-2">
                  <Package className="h-4 w-4 text-zinc-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{eq.name}</span>
                    {eq.sport && (
                      <span className="rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[10px] text-blue-400">
                        {eq.sport}
                      </span>
                    )}
                    {!eq.isActive && (
                      <span className="rounded-full bg-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {formatPrice(eq.pricePerHour)}/hr •{" "}
                    {eq.availableUnits}/{eq.totalUnits} units •{" "}
                    {eq.rentalCount} total rental{eq.rentalCount !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Active toggle */}
                <button
                  onClick={() => handleToggleActive(eq.id, eq.isActive)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    eq.isActive ? "bg-emerald-600" : "bg-zinc-700"
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      eq.isActive ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>

                <button
                  onClick={() => handleEdit(eq)}
                  className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-white transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>

                <button
                  onClick={() => handleDelete(eq.id)}
                  className="rounded-md p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {equipment.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
            <Package className="mx-auto h-8 w-8 text-zinc-600" />
            <p className="mt-2 text-sm text-zinc-500">No equipment yet</p>
            <p className="mt-1 text-xs text-zinc-600">
              Add cricket bats, footballs, rackets, etc. for customers to rent
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
