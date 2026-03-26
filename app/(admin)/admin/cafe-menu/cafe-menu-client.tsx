"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createCafeItem,
  updateCafeItem,
  deleteCafeItem,
  toggleCafeItemAvailability,
} from "@/actions/admin-cafe";
import { CafeItemCategory } from "@prisma/client";
import {
  Plus,
  X,
  Loader2,
  Pencil,
  Coffee,
  UtensilsCrossed,
  IceCreamCone,
  Sandwich,
  Package,
  Search,
} from "lucide-react";
import { formatPrice } from "@/lib/pricing";

interface CafeItemRow {
  id: string;
  name: string;
  description: string | null;
  category: CafeItemCategory;
  price: number;
  image: string | null;
  isVeg: boolean;
  isAvailable: boolean;
  sortOrder: number;
  tags: string[];
}

const CATEGORIES: { value: CafeItemCategory; label: string; icon: typeof Coffee }[] = [
  { value: "BEVERAGES", label: "Beverages", icon: Coffee },
  { value: "SNACKS", label: "Snacks", icon: Sandwich },
  { value: "MEALS", label: "Meals", icon: UtensilsCrossed },
  { value: "DESSERTS", label: "Desserts", icon: IceCreamCone },
  { value: "COMBOS", label: "Combos", icon: Package },
];

const EMPTY_FORM = {
  name: "",
  description: "",
  category: "SNACKS" as CafeItemCategory,
  price: "",
  image: "",
  isVeg: true,
  tags: "",
};

export function CafeMenuClient({ items }: { items: CafeItemRow[] }) {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<CafeItemRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  // Category filter
  const categoryFiltered =
    activeCategory === "ALL"
      ? items
      : items.filter((i) => i.category === activeCategory);

  // Fuzzy search filter
  const filteredItems = searchQuery.trim()
    ? categoryFiltered.filter((item) => {
        const query = searchQuery.toLowerCase().trim();
        const tokens = query.split(/\s+/);
        const searchText = [
          item.name,
          item.description || "",
          item.tags.join(" "),
          item.category,
          item.isVeg ? "veg vegetarian" : "non-veg nonveg",
        ]
          .join(" ")
          .toLowerCase();

        return tokens.every(
          (token) =>
            searchText.includes(token) ||
            // Fuzzy: check if all chars appear in order
            (() => {
              let idx = 0;
              for (const ch of token) {
                idx = searchText.indexOf(ch, idx);
                if (idx < 0) return false;
                idx++;
              }
              return true;
            })()
        );
      })
    : categoryFiltered;

  // Group filtered items by category for display
  const grouped: Record<string, CafeItemRow[]> = {};
  for (const item of filteredItems) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  const openEdit = (item: CafeItemRow) => {
    setEditingItem(item);
    setForm({
      name: item.name,
      description: item.description || "",
      category: item.category,
      price: String(item.price / 100),
      image: item.image || "",
      isVeg: item.isVeg,
      tags: item.tags.join(", "),
    });
    setShowForm(true);
    setError(null);
  };

  const openCreate = () => {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const priceInPaise = Math.round(parseFloat(form.price) * 100);
    if (isNaN(priceInPaise) || priceInPaise <= 0) {
      setError("Price must be a positive number");
      setSaving(false);
      return;
    }

    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (editingItem) {
      const result = await updateCafeItem(editingItem.id, {
        name: form.name,
        description: form.description || null,
        category: form.category,
        price: priceInPaise,
        image: form.image || null,
        isVeg: form.isVeg,
        tags,
      });
      if (!result.success) {
        setError(result.error || "Failed to update");
        setSaving(false);
        return;
      }
    } else {
      const result = await createCafeItem({
        name: form.name,
        description: form.description || undefined,
        category: form.category,
        price: priceInPaise,
        image: form.image || undefined,
        isVeg: form.isVeg,
        tags,
      });
      if (!result.success) {
        setError(result.error || "Failed to create");
        setSaving(false);
        return;
      }
    }

    setShowForm(false);
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setSaving(false);
    router.refresh();
  };

  const handleToggle = async (id: string) => {
    setTogglingId(id);
    await toggleCafeItemAvailability(id);
    setTogglingId(null);
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Mark this item as unavailable?")) return;
    await deleteCafeItem(id);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search menu items by name, description, tags..."
          className="w-full pl-10 pr-10 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-emerald-600 transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {searchQuery && (
        <p className="text-xs text-zinc-400">
          {filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""} found
        </p>
      )}

      {/* Category tabs + Add button */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setActiveCategory("ALL")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activeCategory === "ALL"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
            }`}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeCategory === cat.value
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Item
        </button>
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-white">
              {editingItem ? "Edit Item" : "New Menu Item"}
            </h3>
            <button onClick={() => { setShowForm(false); setEditingItem(null); }}>
              <X className="h-4 w-4 text-zinc-500" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Item name"
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <select
              value={form.category}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  category: e.target.value as CafeItemCategory,
                }))
              }
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              value={form.price}
              onChange={(e) =>
                setForm((p) => ({ ...p, price: e.target.value }))
              }
              placeholder="Price in ₹ (e.g., 150)"
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <input
              type="text"
              value={form.image}
              onChange={(e) =>
                setForm((p) => ({ ...p, image: e.target.value }))
              }
              placeholder="Image URL (optional)"
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              placeholder="Description (optional)"
              rows={2}
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500 sm:col-span-2"
            />
            <input
              type="text"
              value={form.tags}
              onChange={(e) =>
                setForm((p) => ({ ...p, tags: e.target.value }))
              }
              placeholder="Tags (comma separated: Bestseller, Spicy)"
              className="rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
            />
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isVeg}
                onChange={(e) =>
                  setForm((p) => ({ ...p, isVeg: e.target.checked }))
                }
                className="rounded border-zinc-600 bg-zinc-800 text-emerald-500"
              />
              <span className="flex items-center gap-1.5">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    form.isVeg ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                {form.isVeg ? "Vegetarian" : "Non-Vegetarian"}
              </span>
            </label>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !form.name || !form.price}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin inline mr-1" />
              ) : null}
              {editingItem ? "Update Item" : "Create Item"}
            </button>
            {editingItem && (
              <button
                onClick={() => handleDelete(editingItem.id)}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20"
              >
                Mark Unavailable
              </button>
            )}
          </div>
        </div>
      )}

      {/* Items grid by category */}
      {Object.keys(grouped).length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <Coffee className="mx-auto h-12 w-12 text-zinc-600" />
          <p className="mt-3 text-zinc-400">No menu items yet</p>
          <p className="text-sm text-zinc-500">Add your first item to get started</p>
        </div>
      ) : (
        Object.entries(grouped).map(([category, categoryItems]) => {
          const catInfo = CATEGORIES.find((c) => c.value === category);
          const CatIcon = catInfo?.icon || Coffee;
          return (
            <div key={category} className="space-y-2">
              <div className="flex items-center gap-2">
                <CatIcon className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-emerald-400">
                  {catInfo?.label || category}
                </h3>
                <span className="text-xs text-zinc-500">
                  ({categoryItems.length})
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {categoryItems.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-4 transition-all ${
                      item.isAvailable
                        ? "border-zinc-800 bg-zinc-900"
                        : "border-zinc-800/50 bg-zinc-900/50 opacity-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-sm border ${
                              item.isVeg
                                ? "border-green-500 bg-green-500"
                                : "border-red-500 bg-red-500"
                            }`}
                          />
                          <span className="font-medium text-white truncate">
                            {item.name}
                          </span>
                        </div>
                        {item.description && (
                          <p className="mt-1 text-xs text-zinc-500 line-clamp-2">
                            {item.description}
                          </p>
                        )}
                        <p className="mt-1 text-sm font-semibold text-emerald-400">
                          {formatPrice(item.price)}
                        </p>
                        {item.tags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {item.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <button
                          onClick={() => openEdit(item)}
                          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-white transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleToggle(item.id)}
                          disabled={togglingId === item.id}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            item.isAvailable ? "bg-emerald-600" : "bg-zinc-700"
                          }`}
                        >
                          <span
                            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                              item.isAvailable
                                ? "translate-x-5"
                                : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
