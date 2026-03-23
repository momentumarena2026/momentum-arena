"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createFAQ, updateFAQ, deleteFAQ } from "@/actions/admin-faqs";
import { Plus, X, Loader2, Pencil, Trash2, HelpCircle, ChevronDown } from "lucide-react";
import { FAQ_CATEGORIES } from "@/lib/faq-data";

interface FAQRow {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  category: string;
  sortOrder: number;
  isActive: boolean;
}

export function FAQManager({ faqs }: { faqs: FAQRow[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FAQRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [form, setForm] = useState({
    question: "",
    answer: "",
    keywords: "",
    category: "facility",
    sortOrder: 0,
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ question: "", answer: "", keywords: "", category: "facility", sortOrder: 0 });
    setShowForm(true);
    setError(null);
  };

  const openEdit = (faq: FAQRow) => {
    setEditing(faq);
    setForm({
      question: faq.question,
      answer: faq.answer,
      keywords: faq.keywords.join(", "),
      category: faq.category,
      sortOrder: faq.sortOrder,
    });
    setShowForm(true);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const keywords = form.keywords
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

    if (editing) {
      const result = await updateFAQ(editing.id, {
        question: form.question,
        answer: form.answer,
        keywords,
        category: form.category,
        sortOrder: form.sortOrder,
      });
      if (!result.success) setError(result.error || "Failed");
    } else {
      const result = await createFAQ({
        question: form.question,
        answer: form.answer,
        keywords,
        category: form.category,
        sortOrder: form.sortOrder,
      });
      if (!result.success) setError(result.error || "Failed");
    }

    if (!error) {
      setShowForm(false);
      router.refresh();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this FAQ?")) return;
    setDeleting(id);
    await deleteFAQ(id);
    setDeleting(null);
    router.refresh();
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await updateFAQ(id, { isActive: !isActive });
    router.refresh();
  };

  // Group by category
  const grouped = faqs.reduce((acc, faq) => {
    if (!acc[faq.category]) acc[faq.category] = [];
    acc[faq.category].push(faq);
    return acc;
  }, {} as Record<string, FAQRow[]>);

  return (
    <div className="space-y-4">
      {!showForm ? (
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-xl bg-emerald-600/10 border border-emerald-500/30 px-4 py-3 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20"
        >
          <Plus className="h-4 w-4" />
          Add FAQ
        </button>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-white">
              {editing ? "Edit FAQ" : "New FAQ"}
            </h3>
            <button onClick={() => setShowForm(false)}>
              <X className="h-4 w-4 text-zinc-500" />
            </button>
          </div>

          <div className="space-y-3">
            <input
              type="text"
              value={form.question}
              onChange={(e) => setForm((p) => ({ ...p, question: e.target.value }))}
              placeholder="Question *"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <textarea
              value={form.answer}
              onChange={(e) => setForm((p) => ({ ...p, answer: e.target.value }))}
              placeholder="Answer *"
              rows={4}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                type="text"
                value={form.keywords}
                onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))}
                placeholder="Keywords (comma separated)"
                className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
              />
              <select
                value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
              >
                {FAQ_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm((p) => ({ ...p, sortOrder: parseInt(e.target.value) || 0 }))}
                placeholder="Sort order"
                className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving || !form.question || !form.answer}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : null}
            {editing ? "Update" : "Create"}
          </button>
        </div>
      )}

      {/* FAQs grouped by category */}
      {Object.entries(grouped).map(([category, categoryFaqs]) => {
        const catInfo = FAQ_CATEGORIES.find((c) => c.id === category);
        return (
          <div key={category}>
            <h2 className="mb-2 text-sm font-medium text-zinc-500 uppercase tracking-wider">
              {catInfo?.label || category}
            </h2>
            <div className="space-y-2">
              {categoryFaqs.map((faq) => (
                <div
                  key={faq.id}
                  className={`rounded-xl border p-4 ${
                    faq.isActive ? "border-zinc-800 bg-zinc-900" : "border-zinc-800/50 bg-zinc-900/50 opacity-60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white">{faq.question}</p>
                      <p className="mt-1 text-xs text-zinc-400 line-clamp-2">
                        {faq.answer}
                      </p>
                      {faq.keywords.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {faq.keywords.map((k) => (
                            <span
                              key={k}
                              className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500"
                            >
                              {k}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleToggle(faq.id, faq.isActive)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full ${
                          faq.isActive ? "bg-emerald-600" : "bg-zinc-700"
                        }`}
                      >
                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${faq.isActive ? "translate-x-5" : "translate-x-1"}`} />
                      </button>
                      <button
                        onClick={() => openEdit(faq)}
                        className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-white"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(faq.id)}
                        disabled={deleting === faq.id}
                        className="rounded-lg p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
                      >
                        {deleting === faq.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {faqs.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <HelpCircle className="mx-auto h-8 w-8 text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-500">No FAQs yet. Default FAQs from the code will be used until you add entries here.</p>
        </div>
      )}
    </div>
  );
}
