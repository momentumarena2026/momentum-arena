"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import {
  ImagePlus,
  Loader2,
  Minus,
  Pencil,
  Plus,
  PowerOff,
  Trash2,
  Zap,
} from "lucide-react";
import { formatPrice } from "@/lib/pricing";
import {
  adjustProductStock,
  createProduct,
  createProductCategory,
  deleteProduct,
  deleteProductCategory,
  updateProduct,
  updateProductCategory,
} from "@/actions/admin-products";

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  pricePaise: number;
  /** Cost-of-goods per unit in paise. 0 means "margin unknown". */
  costPaise: number;
  stockQuantity: number;
  lowStockThreshold: number;
  imageUrl: string | null;
  isActive: boolean;
  displayOrder: number;
  categoryId: string | null;
  categoryName: string | null;
  orderCount: number;
}

interface Category {
  id: string;
  name: string;
  displayOrder: number;
}

interface Props {
  products: ProductRow[];
  categories: Category[];
}

interface ProductFormState {
  id: string | null;
  name: string;
  description: string;
  priceRupees: string;
  costRupees: string;
  stockQuantity: string;
  lowStockThreshold: string;
  categoryId: string;
  imageUrl: string | null;
}

const EMPTY_FORM: ProductFormState = {
  id: null,
  name: "",
  description: "",
  priceRupees: "",
  costRupees: "",
  stockQuantity: "",
  lowStockThreshold: "3",
  categoryId: "",
  imageUrl: null,
};

/**
 * Admin client for the shop catalog. Shows products grouped by
 * category with inline stock adjust, edit drawer, and a separate
 * "manage categories" toggle. Image upload posts to
 * /api/admin/shop/upload-image which writes to Vercel Blob and
 * returns the URL we persist on Product.imageUrl.
 */
export function ProductsManager({ products, categories }: Props) {
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [stockTarget, setStockTarget] = useState<ProductRow | null>(null);
  const [stockDelta, setStockDelta] = useState("");
  const [stockNote, setStockNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function openCreate() {
    setForm(EMPTY_FORM);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(p: ProductRow) {
    setForm({
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      priceRupees: String(Math.round(p.pricePaise / 100)),
      costRupees: p.costPaise > 0 ? String(Math.round(p.costPaise / 100)) : "",
      stockQuantity: String(p.stockQuantity),
      lowStockThreshold: String(p.lowStockThreshold),
      categoryId: p.categoryId ?? "",
      imageUrl: p.imageUrl,
    });
    setError(null);
    setFormOpen(true);
  }

  function handleSave() {
    const pricePaise = Math.round(parseFloat(form.priceRupees || "0") * 100);
    // Empty cost stays 0 (= "margin unknown"). Admins fill it in
    // later when they want margin reporting on this product.
    const costPaise = form.costRupees.trim() === ""
      ? 0
      : Math.round(parseFloat(form.costRupees) * 100);
    const stockQuantity = parseInt(form.stockQuantity || "0", 10);
    const lowStockThreshold = parseInt(form.lowStockThreshold || "0", 10);

    if (!form.name.trim()) return setError("Name is required");
    if (!Number.isFinite(pricePaise) || pricePaise <= 0)
      return setError("Price must be a positive number");
    if (!Number.isFinite(costPaise) || costPaise < 0)
      return setError("Cost must be a non-negative number");
    if (!Number.isFinite(stockQuantity) || stockQuantity < 0)
      return setError("Stock must be a non-negative integer");

    startTransition(async () => {
      try {
        const res = form.id
          ? await updateProduct(form.id, {
              name: form.name,
              description: form.description || null,
              pricePaise,
              costPaise,
              lowStockThreshold,
              categoryId: form.categoryId || null,
              imageUrl: form.imageUrl,
            })
          : await createProduct({
              name: form.name,
              description: form.description || null,
              pricePaise,
              costPaise,
              stockQuantity,
              lowStockThreshold,
              categoryId: form.categoryId || null,
              imageUrl: form.imageUrl ?? null,
            });
        if (!res.success) {
          setError(res.error ?? "Save failed");
          return;
        }
        setForm(EMPTY_FORM);
        setFormOpen(false);
        // Server-side revalidatePath will refresh the list on
        // navigation; force a soft reload so the table reflects
        // the change immediately without an extra round-trip.
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  function handleDelete(p: ProductRow) {
    if (
      !confirm(
        `Delete "${p.name}"? ${
          p.orderCount > 0
            ? "It will be DEACTIVATED (kept for order history)."
            : "This is permanent."
        }`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await deleteProduct(p.id);
      if (!res.success) {
        setError(res.error ?? "Delete failed");
        return;
      }
      window.location.reload();
    });
  }

  function handleStockAdjust() {
    if (!stockTarget) return;
    const delta = parseInt(stockDelta, 10);
    if (!Number.isFinite(delta) || delta === 0) {
      setError("Enter a non-zero integer (positive to add, negative to remove)");
      return;
    }
    if (!stockNote.trim()) {
      setError("Add a short note for the audit trail");
      return;
    }
    startTransition(async () => {
      const res = await adjustProductStock({
        productId: stockTarget.id,
        delta,
        note: stockNote.trim(),
      });
      if (!res.success) {
        setError(res.error ?? "Stock adjustment failed");
        return;
      }
      setStockTarget(null);
      setStockDelta("");
      setStockNote("");
      setError(null);
      window.location.reload();
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-zinc-500">
          {products.length} item{products.length === 1 ? "" : "s"}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCategoriesOpen((v) => !v)}
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-700"
          >
            {categoriesOpen ? "Hide categories" : "Manage categories"}
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            <Plus className="h-3.5 w-3.5" />
            New product
          </button>
        </div>
      </div>

      {categoriesOpen ? (
        <CategoryEditor categories={categories} />
      ) : null}

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-950 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2 text-right">Margin</th>
              <th className="px-3 py-2 text-right">Stock</th>
              <th className="px-3 py-2 text-right">Orders</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {products.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">
                  No products yet. Click "New product" to add one.
                </td>
              </tr>
            ) : null}
            {products.map((p) => {
              const isLow =
                p.stockQuantity > 0 && p.stockQuantity <= p.lowStockThreshold;
              const isOut = p.stockQuantity <= 0;
              return (
                <tr
                  key={p.id}
                  className={`${p.isActive ? "" : "opacity-50"}`}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {p.imageUrl ? (
                        <Image
                          src={p.imageUrl}
                          alt={p.name}
                          width={36}
                          height={36}
                          className="h-9 w-9 rounded object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded bg-zinc-800 text-zinc-500">
                          <ImagePlus className="h-4 w-4" />
                        </div>
                      )}
                      <div>
                        <div className="font-medium text-white">{p.name}</div>
                        {!p.isActive ? (
                          <div className="text-[10px] text-zinc-500">INACTIVE</div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">
                    {p.categoryName ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-300">
                    {formatPrice(Math.round(p.pricePaise / 100))}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-400">
                    {p.costPaise > 0
                      ? formatPrice(Math.round(p.costPaise / 100))
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {p.costPaise > 0 && p.pricePaise > 0 ? (
                      (() => {
                        const marginPaise = p.pricePaise - p.costPaise;
                        const pct = Math.round(
                          (marginPaise / p.pricePaise) * 100,
                        );
                        const colour =
                          marginPaise < 0
                            ? "text-red-400"
                            : pct < 10
                              ? "text-amber-400"
                              : "text-emerald-300";
                        return (
                          <span className={colour}>
                            {formatPrice(Math.round(marginPaise / 100))} ({pct}%)
                          </span>
                        );
                      })()
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={`font-mono ${
                        isOut
                          ? "text-red-400"
                          : isLow
                            ? "text-amber-400"
                            : "text-zinc-300"
                      }`}
                    >
                      {p.stockQuantity}
                    </span>
                    {isLow && !isOut ? (
                      <span className="ml-1 text-[10px] text-amber-500">low</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-400">
                    {p.orderCount}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setStockTarget(p);
                          setStockDelta("");
                          setStockNote("");
                          setError(null);
                        }}
                        title="Adjust stock"
                        className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                      >
                        <Zap className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        title="Edit"
                        className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        title={p.orderCount > 0 ? "Deactivate" : "Delete"}
                        className="rounded p-1.5 text-zinc-400 hover:bg-red-500/10 hover:text-red-400"
                      >
                        {p.orderCount > 0 ? (
                          <PowerOff className="h-3.5 w-3.5" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit / create drawer */}
      {formOpen ? (
        <ProductForm
          form={form}
          categories={categories}
          isEditing={!!form.id}
          isPending={isPending}
          error={error}
          onChange={setForm}
          onSave={handleSave}
          onCancel={() => {
            setForm(EMPTY_FORM);
            setFormOpen(false);
            setError(null);
          }}
        />
      ) : null}

      {/* Stock adjust drawer */}
      {stockTarget ? (
        <StockAdjustDialog
          product={stockTarget}
          delta={stockDelta}
          note={stockNote}
          isPending={isPending}
          error={error}
          onDeltaChange={setStockDelta}
          onNoteChange={setStockNote}
          onConfirm={handleStockAdjust}
          onCancel={() => {
            setStockTarget(null);
            setStockDelta("");
            setStockNote("");
            setError(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Product form ────────────────────────────────────────────────────

function ProductForm({
  form,
  categories,
  isEditing,
  isPending,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  form: ProductFormState;
  categories: Category[];
  isEditing: boolean;
  isPending: boolean;
  error: string | null;
  onChange: (next: ProductFormState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/shop/upload-image", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      onChange({ ...form, imageUrl: data.url });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-white">
          {isEditing ? "Edit product" : "New product"}
        </h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Name"
            value={form.name}
            onChange={(v) => onChange({ ...form, name: v })}
            full
          />
          <Field
            label="Description (optional)"
            value={form.description}
            onChange={(v) => onChange({ ...form, description: v })}
            full
          />
          <Field
            label="Price (₹)"
            type="number"
            value={form.priceRupees}
            onChange={(v) => onChange({ ...form, priceRupees: v })}
          />
          <Field
            label="Cost (₹) — optional"
            type="number"
            value={form.costRupees}
            onChange={(v) => onChange({ ...form, costRupees: v })}
            placeholder="What you paid per unit"
          />
          <Field
            label={isEditing ? "Stock (use stock adjust button to change)" : "Initial stock"}
            type="number"
            value={form.stockQuantity}
            onChange={(v) => onChange({ ...form, stockQuantity: v })}
            disabled={isEditing}
          />
          <Field
            label="Low-stock threshold"
            type="number"
            value={form.lowStockThreshold}
            onChange={(v) => onChange({ ...form, lowStockThreshold: v })}
          />
          <SelectField
            label="Category"
            value={form.categoryId}
            onChange={(v) => onChange({ ...form, categoryId: v })}
            options={[
              { value: "", label: "— None —" },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>

        <div className="mt-4">
          <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Image
          </label>
          <div className="mt-2 flex items-center gap-3">
            {form.imageUrl ? (
              <Image
                src={form.imageUrl}
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
                  if (f) void handleFile(f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-500 disabled:opacity-60"
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5" />
                )}
                {form.imageUrl ? "Replace image" : "Upload image"}
              </button>
              {form.imageUrl ? (
                <button
                  type="button"
                  onClick={() => onChange({ ...form, imageUrl: null })}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              ) : null}
              <p className="text-[11px] text-zinc-500">
                JPEG / PNG / WebP, ≤ 5 MB.
              </p>
              {uploadError ? (
                <p className="text-xs text-red-400">{uploadError}</p>
              ) : null}
            </div>
          </div>
        </div>

        {error ? (
          <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stock adjust dialog ─────────────────────────────────────────────

function StockAdjustDialog({
  product,
  delta,
  note,
  isPending,
  error,
  onDeltaChange,
  onNoteChange,
  onConfirm,
  onCancel,
}: {
  product: ProductRow;
  delta: string;
  note: string;
  isPending: boolean;
  error: string | null;
  onDeltaChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold text-white">
          Adjust stock
        </h2>
        <p className="mb-4 text-sm text-zinc-400">
          {product.name} · currently {product.stockQuantity} in stock
        </p>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                onDeltaChange(String(Math.abs(parseInt(delta || "0", 10)) * -1 - 1))
              }
              className="rounded-md border border-zinc-700 p-2 text-zinc-300 hover:border-zinc-500"
              title="Decrement"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <input
              type="number"
              value={delta}
              onChange={(e) => onDeltaChange(e.target.value)}
              placeholder="e.g. 5 (add) or -2 (remove)"
              className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() =>
                onDeltaChange(String(Math.abs(parseInt(delta || "0", 10)) + 1))
              }
              className="rounded-md border border-zinc-700 p-2 text-zinc-300 hover:border-zinc-500"
              title="Increment"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <Field
            label="Reason / note"
            value={note}
            onChange={onNoteChange}
            placeholder="e.g. monthly restock, damaged unit removed"
            full
          />
          {error ? (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Category editor ─────────────────────────────────────────────────

function CategoryEditor({ categories }: { categories: Category[] }) {
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const res = await createProductCategory({ name: newName.trim() });
      if (!res.success) {
        setError(res.error ?? "Failed");
        return;
      }
      setNewName("");
      window.location.reload();
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete category? Products inside will become uncategorised."))
      return;
    startTransition(async () => {
      const res = await deleteProductCategory(id);
      if (!res.success) {
        setError(res.error ?? "Failed");
        return;
      }
      window.location.reload();
    });
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">Categories</h3>
      <div className="space-y-2">
        {categories.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No categories yet — products work fine without one, but a
            category groups them on the customer shop.
          </p>
        ) : null}
        {categories.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2"
          >
            <input
              defaultValue={c.name}
              onBlur={(e) => {
                const newVal = e.target.value.trim();
                if (newVal && newVal !== c.name) {
                  startTransition(async () => {
                    await updateProductCategory(c.id, { name: newVal });
                  });
                }
              }}
              className="flex-1 bg-transparent text-sm text-white focus:outline-none"
            />
            <button
              type="button"
              onClick={() => handleDelete(c.id)}
              className="rounded p-1 text-zinc-400 hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New category name"
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
        {error ? (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ─── Tiny form helpers ───────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  full?: boolean;
}) {
  return (
    <label className={`block text-sm ${full ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-white focus:border-emerald-500 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
