"use client";

import { useRef, useState } from "react";
import Image from "next/image";
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
  ImagePlus,
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
  // Cost-of-goods for the item, in rupees. Null when the venue
  // hasn't filled it in yet — reporting paths treat that as
  // "unknown margin," not zero.
  costPrice: number | null;
  // Stock count. Null = unlimited / kitchen-prepared (cooked to
  // order — never depletes). Integer = on-hand count;
  // order paths decrement on order create.
  quantity: number | null;
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
  // Empty string = "leave unset" on the form; we only persist a
  // costPrice when the admin actually types a number.
  costPrice: "",
  // Stock quantity. Empty string = kitchen-prepared / unlimited
  // (CafeItem.quantity stays NULL). Integer = on-hand count.
  quantity: "",
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

  // Image upload — mirrors /admin/products's UX. File input is
  // hidden, triggered by an "Upload image" button; on success we
  // stamp the Vercel Blob URL into form.image. The server route
  // enforces 5MB + JPEG/PNG/WebP via lib/blob's `uploadImage`.
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleImageFile(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/cafe/upload-image", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setForm((p) => ({ ...p, image: data.url }));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

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
      // Values are stored in rupees (Float, decimals allowed), so
      // display them as-is. Leading "0." or trailing ".50" round-
      // trips cleanly via String(<number>).
      price: String(item.price),
      // null costPrice → leave the field blank so the admin can
      // still skip filling it in.
      costPrice: item.costPrice != null ? String(item.costPrice) : "",
      // null quantity → kitchen-prepared / unlimited. Show blank
      // so the admin sees "this item doesn't track stock" and
      // can opt in by typing a number later (or stay null by
      // leaving it blank on edit).
      quantity: item.quantity != null ? String(item.quantity) : "",
      image: item.image || "",
      isVeg: item.isVeg,
      tags: item.tags.join(", "),
    });
    setShowForm(true);
    setError(null);
    setUploadError(null);
  };

  const openCreate = () => {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError(null);
    setUploadError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    // Selling price — rupees with optional decimals. The DB stores
    // it as a Float so we hand over `parseFloat` directly; the
    // gateway adapters multiply by 100 on the way to Razorpay /
    // PhonePe (see app/api/razorpay/cafe-create-order and the
    // PhonePe initiator).
    const priceRupees = parseFloat(form.price);
    if (isNaN(priceRupees) || priceRupees <= 0) {
      setError("Price must be a positive number");
      setSaving(false);
      return;
    }

    // Cost price is optional. Empty form value → null (skip /
    // clear). A typed value must parse to a non-negative number
    // and shouldn't exceed the selling price (the venue isn't
    // making negative margin in the regular case; we let admins
    // catch typos before they break the margin reports).
    let costRupees: number | null = null;
    const costRaw = form.costPrice.trim();
    if (costRaw !== "") {
      const parsed = parseFloat(costRaw);
      if (isNaN(parsed) || parsed < 0) {
        setError("Cost price must be a non-negative number");
        setSaving(false);
        return;
      }
      if (parsed > priceRupees) {
        setError(
          "Cost price is higher than selling price — double-check the figures",
        );
        setSaving(false);
        return;
      }
      costRupees = parsed;
    }

    // Stock quantity is optional. Empty form value → null →
    // kitchen-prepared / unlimited (the DB column stays NULL and
    // the order paths skip the stock check for this item). A
    // typed value must be a non-negative integer; "10.5 bottles"
    // makes no sense, and Math.round would silently round it.
    let quantityValue: number | null = null;
    const qtyRaw = form.quantity.trim();
    if (qtyRaw !== "") {
      const parsed = Number(qtyRaw);
      if (!Number.isInteger(parsed) || parsed < 0) {
        setError("Stock quantity must be a non-negative whole number");
        setSaving(false);
        return;
      }
      quantityValue = parsed;
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
        price: priceRupees,
        // Explicit `null` clears a previously-set cost price.
        costPrice: costRupees,
        // Same semantics — null clears stock tracking (back to
        // unlimited / kitchen-prepared); a number sets the new
        // on-hand count.
        quantity: quantityValue,
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
        price: priceRupees,
        costPrice: costRupees,
        quantity: quantityValue,
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

          {/* Every field now wears a small uppercase caption so the
              admin can tell name from category and price from cost
              from stock at a glance — without the placeholders the
              previous unlabelled layout left three numeric inputs
              in a row that all looked identical once filled. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-1">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Item name
              </span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Cold Coffee"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
              />
            </label>
            <label className="block sm:col-span-1">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Category
              </span>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    category: e.target.value as CafeItemCategory,
                  }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-1">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Selling price (₹)
              </span>
              <input
                type="number"
                step="0.01"
                value={form.price}
                onChange={(e) =>
                  setForm((p) => ({ ...p, price: e.target.value }))
                }
                placeholder="e.g. 150"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
              />
            </label>
            <label className="block sm:col-span-1">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Cost price (₹) <span className="text-zinc-600">— optional</span>
              </span>
              <input
                type="number"
                step="0.01"
                value={form.costPrice}
                onChange={(e) =>
                  setForm((p) => ({ ...p, costPrice: e.target.value }))
                }
                placeholder="What it costs to source"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
              />
            </label>
            {/* Stock quantity — optional integer for procured-good
                items (drinks, ice-cream, packaged snacks). Leave
                blank for kitchen-prepared items (cooked to order)
                so the order paths skip the stock check entirely. */}
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Stock quantity{" "}
                <span className="text-zinc-600">
                  — optional, leave blank for kitchen-prepared items
                </span>
              </span>
              <input
                type="number"
                step="1"
                min={0}
                value={form.quantity}
                onChange={(e) =>
                  setForm((p) => ({ ...p, quantity: e.target.value }))
                }
                placeholder="e.g. 24"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
              />
            </label>
            {/* Image picker — replaces the previous raw URL text
                input. The admin clicks "Upload image" which opens
                the OS file picker; on success the helper POSTs to
                /api/admin/cafe/upload-image and stamps the returned
                Vercel Blob URL into form.image. 80×80 thumbnail
                renders the current pick (or a dashed placeholder
                when none). Same UX as /admin/products. */}
            <div className="sm:col-span-2">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Image <span className="text-zinc-600">— optional</span>
              </span>
              <div className="flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800 p-2.5">
              {form.image ? (
                <Image
                  src={form.image}
                  alt="Preview"
                  width={80}
                  height={80}
                  className="h-20 w-20 rounded-md object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-zinc-700 text-zinc-600">
                  <ImagePlus className="h-5 w-5" />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleImageFile(f);
                    e.target.value = "";
                  }}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-500 disabled:opacity-60"
                  >
                    {uploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="h-3.5 w-3.5" />
                    )}
                    {form.image ? "Replace image" : "Upload image"}
                  </button>
                  {form.image ? (
                    <button
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, image: "" }))}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <p className="text-[11px] text-zinc-500">
                  JPEG / PNG / WebP, ≤ 5 MB.
                </p>
                {uploadError ? (
                  <p className="text-xs text-red-400">{uploadError}</p>
                ) : null}
              </div>
              </div>
            </div>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Description <span className="text-zinc-600">— optional</span>
              </span>
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm((p) => ({ ...p, description: e.target.value }))
                }
                placeholder="Short description for the menu (e.g. 200 ml)"
                rows={2}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
              />
            </label>
            <label className="block sm:col-span-1">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Tags <span className="text-zinc-600">— comma separated</span>
              </span>
              <input
                type="text"
                value={form.tags}
                onChange={(e) =>
                  setForm((p) => ({ ...p, tags: e.target.value }))
                }
                placeholder="Bestseller, Spicy"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white placeholder-zinc-500"
              />
            </label>
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
                        <div className="flex items-center gap-2 flex-wrap">
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
                          {/* Category pill — surfaces the item's
                              category assignment on the list card
                              itself, not just inside the edit form.
                              Pulled from CATEGORIES so the label
                              matches the dropdown verbatim. */}
                          <span className="shrink-0 rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-300">
                            {CATEGORIES.find((c) => c.value === item.category)
                              ?.label ?? item.category}
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
                        {/* Stock indicator. NULL quantity = the
                            item doesn't track stock (kitchen-
                            prepared, cooked to order). Otherwise
                            show on-hand count; "Out of stock" in
                            red when 0, amber when low (≤ 3),
                            muted otherwise. Lets the admin scan
                            the menu and spot what needs
                            restocking without opening the edit
                            form. */}
                        {item.quantity === null ? (
                          <p className="mt-1 text-[11px] text-zinc-500">
                            Kitchen item · no stock tracking
                          </p>
                        ) : item.quantity === 0 ? (
                          <p className="mt-1 text-[11px] font-medium text-red-400">
                            Out of stock
                          </p>
                        ) : item.quantity <= 3 ? (
                          <p className="mt-1 text-[11px] font-medium text-amber-400">
                            {item.quantity} left — restock soon
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] text-zinc-500">
                            {item.quantity} in stock
                          </p>
                        )}
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
