"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPromoBanner, updatePromoBanner, deletePromoBanner } from "@/actions/admin-banners";
import { BannerPlacement } from "@prisma/client";
import { Plus, X, Loader2, Megaphone, Trash2, Sparkles } from "lucide-react";

interface BannerRow {
  id: string;
  title: string;
  description: string;
  discountInfo: string | null;
  placement: BannerPlacement[];
  razorpayOfferId: string | null;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
}

const PLACEMENTS: { value: BannerPlacement; label: string }[] = [
  { value: "BOOK_PAGE", label: "Sport Selection" },
  { value: "SLOT_SELECTION", label: "Slot Selection" },
  { value: "CHECKOUT", label: "Checkout" },
];

export function BannerManager({ banners }: { banners: BannerRow[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    discountInfo: "",
    placement: ["BOOK_PAGE"] as BannerPlacement[],
    razorpayOfferId: "",
    startsAt: new Date().toISOString().split("T")[0],
    endsAt: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
  });

  const handleCreate = async () => {
    setSaving(true);
    setError(null);
    const result = await createPromoBanner({
      title: form.title,
      description: form.description,
      discountInfo: form.discountInfo || undefined,
      placement: form.placement,
      razorpayOfferId: form.razorpayOfferId || undefined,
      startsAt: form.startsAt,
      endsAt: form.endsAt,
    });
    if (result.success) {
      setShowForm(false);
      router.refresh();
    } else {
      setError(result.error || "Failed");
    }
    setSaving(false);
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await updatePromoBanner(id, { isActive: !isActive });
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this banner?")) return;
    await deletePromoBanner(id);
    router.refresh();
  };

  const togglePlacement = (p: BannerPlacement) => {
    setForm((prev) => ({
      ...prev,
      placement: prev.placement.includes(p)
        ? prev.placement.filter((x) => x !== p)
        : [...prev.placement, p],
    }));
  };

  return (
    <div className="space-y-4">
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl bg-yellow-600/10 border border-yellow-500/30 px-4 py-3 text-sm font-medium text-yellow-400 hover:bg-yellow-600/20"
        >
          <Plus className="h-4 w-4" />
          Create Banner
        </button>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-white">New Promo Banner</h3>
            <button onClick={() => setShowForm(false)}><X className="h-4 w-4 text-zinc-500" /></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input type="text" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Title *" className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500" />
            <input type="text" value={form.discountInfo} onChange={(e) => setForm((p) => ({ ...p, discountInfo: e.target.value }))} placeholder="Discount info (e.g., Flat ₹200 off)" className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500" />
            <input type="text" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Description *" className="sm:col-span-2 rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500" />
            <input type="text" value={form.razorpayOfferId} onChange={(e) => setForm((p) => ({ ...p, razorpayOfferId: e.target.value }))} placeholder="Razorpay Offer ID (optional)" className="sm:col-span-2 rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500" />
            <input type="date" value={form.startsAt} onChange={(e) => setForm((p) => ({ ...p, startsAt: e.target.value }))} className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white" />
            <input type="date" value={form.endsAt} onChange={(e) => setForm((p) => ({ ...p, endsAt: e.target.value }))} className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white" />
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-2">Show on:</p>
            <div className="flex gap-2">
              {PLACEMENTS.map((p) => (
                <button key={p.value} onClick={() => togglePlacement(p.value)} className={`rounded-lg px-3 py-1.5 text-xs border ${form.placement.includes(p.value) ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" : "bg-zinc-800 text-zinc-400 border-zinc-700"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button onClick={handleCreate} disabled={saving || !form.title || !form.description} className="rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : null}
            Create Banner
          </button>
        </div>
      )}

      {/* Banners List */}
      <div className="space-y-2">
        {banners.map((banner) => (
          <div key={banner.id} className={`rounded-xl border p-4 ${banner.isActive ? "border-zinc-800 bg-zinc-900" : "border-zinc-800/50 bg-zinc-900/50 opacity-60"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-yellow-400" />
                <div>
                  <p className="font-medium text-white">{banner.title}</p>
                  <p className="text-xs text-zinc-500">
                    {banner.description} • {banner.placement.join(", ")} • {banner.startsAt} to {banner.endsAt}
                    {banner.razorpayOfferId && ` • Razorpay: ${banner.razorpayOfferId}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleToggle(banner.id, banner.isActive)} className={`relative inline-flex h-5 w-9 items-center rounded-full ${banner.isActive ? "bg-emerald-600" : "bg-zinc-700"}`}>
                  <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${banner.isActive ? "translate-x-5" : "translate-x-1"}`} />
                </button>
                <button onClick={() => handleDelete(banner.id)} className="rounded-lg p-2 text-zinc-500 hover:bg-red-500/10 hover:text-red-400">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {banners.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
            <Megaphone className="mx-auto h-8 w-8 text-zinc-600" />
            <p className="mt-2 text-sm text-zinc-500">No banners yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
