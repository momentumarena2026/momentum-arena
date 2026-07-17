"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Ticket,
  Trash2,
  X,
} from "lucide-react";
import {
  createPromoBanner,
  updatePromoBanner,
  togglePromoBanner,
  deletePromoBanner,
  type PromoBannerInput,
} from "@/actions/admin-promo-banners";
import { PROMO_SCREENS } from "@/lib/promo-banner-screens";

interface BannerRow {
  id: string;
  title: string;
  imageUrl: string;
  appImageUrl: string | null;
  aspectRatio: number;
  linkUrl: string | null;
  screens: string[];
  couponId: string | null;
  couponCode: string | null;
  couponLive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  sortOrder: number;
}

interface CouponOption {
  id: string;
  code: string;
  validUntil: string;
}

const SCREEN_LABEL = new Map(PROMO_SCREENS.map((s) => [s.value as string, s.label]));

/** ISO → value for <input type="datetime-local"> (local time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY_FORM = {
  title: "",
  imageUrl: "",
  appImageUrl: "" as string | null,
  aspectRatio: 3,
  linkUrl: "",
  screens: [] as string[],
  couponId: "",
  startsAt: "",
  endsAt: "",
  isActive: true,
  sortOrder: 0,
};

export function PromoBannersManager({
  initialBanners,
  coupons,
}: {
  initialBanners: BannerRow[];
  coupons: CouponOption[];
}) {
  const router = useRouter();
  const [banners] = useState(initialBanners);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setError(null);
    setFormOpen(true);
  }

  function openEdit(b: BannerRow) {
    setEditingId(b.id);
    setForm({
      title: b.title,
      imageUrl: b.imageUrl,
      appImageUrl: b.appImageUrl,
      aspectRatio: b.aspectRatio,
      linkUrl: b.linkUrl ?? "",
      screens: [...b.screens],
      couponId: b.couponId ?? "",
      startsAt: toLocalInput(b.startsAt),
      endsAt: toLocalInput(b.endsAt),
      isActive: b.isActive,
      sortOrder: b.sortOrder,
    });
    setError(null);
    setFormOpen(true);
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/promo-banners/upload", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setForm((p) => ({
        ...p,
        imageUrl: data.imageUrl,
        appImageUrl: data.appImageUrl,
        aspectRatio: data.aspectRatio,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const input: PromoBannerInput = {
      title: form.title,
      imageUrl: form.imageUrl,
      appImageUrl: form.appImageUrl,
      aspectRatio: form.aspectRatio,
      linkUrl: form.linkUrl || null,
      screens: form.screens,
      couponId: form.couponId || null,
      // datetime-local values are LOCAL wall-clock — Date() parses them
      // in the browser's zone, so the stored instant matches what the
      // admin picked on their machine.
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      isActive: form.isActive,
      sortOrder: form.sortOrder,
    };
    const result = editingId
      ? await updatePromoBanner(editingId, input)
      : await createPromoBanner(input);
    setSaving(false);
    if (result.ok) {
      setFormOpen(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="space-y-4">
      <button
        onClick={openCreate}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
      >
        <Plus className="h-4 w-4" /> New banner
      </button>

      {banners.length === 0 && (
        <p className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 text-sm text-zinc-500">
          No banners yet — create one to promote an offer on the website and app.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {banners.map((b) => (
          <div
            key={b.id}
            className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={b.imageUrl}
              alt={b.title}
              className="max-h-40 w-full object-cover"
            />
            <div className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-white">{b.title}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    b.isActive
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {b.isActive ? "Active" : "Off"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {b.screens.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300"
                  >
                    {SCREEN_LABEL.get(s) ?? s}
                  </span>
                ))}
              </div>
              <div className="space-y-1 text-xs text-zinc-500">
                {b.linkUrl && <p className="truncate">→ {b.linkUrl}</p>}
                {b.couponCode && (
                  <p className="flex items-center gap-1">
                    <Ticket className="h-3 w-3" /> {b.couponCode}
                    {!b.couponLive && (
                      <span className="text-amber-400">
                        (coupon expired — banner hidden)
                      </span>
                    )}
                  </p>
                )}
                {(b.startsAt || b.endsAt) && (
                  <p className="flex items-center gap-1">
                    <CalendarClock className="h-3 w-3" />
                    {b.startsAt ? new Date(b.startsAt).toLocaleString("en-IN") : "now"}
                    {" → "}
                    {b.endsAt ? new Date(b.endsAt).toLocaleString("en-IN") : "open-ended"}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => openEdit(b)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
                <button
                  onClick={async () => {
                    await togglePromoBanner(b.id, !b.isActive);
                    router.refresh();
                  }}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
                >
                  {b.isActive ? "Turn off" : "Turn on"}
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`Delete banner "${b.title}"?`)) return;
                    await deletePromoBanner(b.id);
                    router.refresh();
                  }}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Create / edit modal ── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-10">
          <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                {editingId ? "Edit banner" : "New banner"}
              </h2>
              <button onClick={() => setFormOpen(false)}>
                <X className="h-5 w-5 text-zinc-400" />
              </button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Title (also the image alt text)
                </span>
                <input
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
                  placeholder="Worldcup Final — 25% off football"
                />
              </label>

              {/* Image upload — optimized + resized server-side into web
                  and app variants. */}
              <div>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Banner image
                </span>
                {form.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.imageUrl}
                    alt="Banner preview"
                    className="mb-2 max-h-40 w-full rounded-lg object-cover"
                  />
                ) : null}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImagePlus className="h-4 w-4" />
                  )}
                  {form.imageUrl ? "Replace image" : "Upload image"}
                </button>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Automatically optimised and resized for web (1920px) and app
                  (1080px), aspect ratio preserved.
                </p>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Navigation URL (where a tap lands)
                </span>
                <input
                  value={form.linkUrl}
                  onChange={(e) => setForm((p) => ({ ...p, linkUrl: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
                  placeholder="/book/football — resolved to the matching screen in the app"
                />
              </label>

              {/* Screens multiselect */}
              <div>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Show on screens
                </span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PROMO_SCREENS.map((s) => (
                    <label
                      key={s.value}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 p-2.5 text-sm text-zinc-300"
                    >
                      <input
                        type="checkbox"
                        checked={form.screens.includes(s.value)}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            screens: e.target.checked
                              ? [...p.screens, s.value]
                              : p.screens.filter((v) => v !== s.value),
                          }))
                        }
                        className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-emerald-600"
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Coupon link */}
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Linked coupon (banner lives while the coupon is valid)
                </span>
                <select
                  value={form.couponId}
                  onChange={(e) => setForm((p) => ({ ...p, couponId: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
                >
                  <option value="">No coupon — use the schedule below</option>
                  {coupons.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} (valid till{" "}
                      {new Date(c.validUntil).toLocaleDateString("en-IN")})
                    </option>
                  ))}
                </select>
              </label>

              {/* Schedule */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Live from (date &amp; time — blank = immediately)
                  </span>
                  <input
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) => setForm((p) => ({ ...p, startsAt: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Live until (blank = coupon expiry / open-ended)
                  </span>
                  <input
                    type="datetime-local"
                    value={form.endsAt}
                    onChange={(e) => setForm((p) => ({ ...p, endsAt: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2.5 text-sm text-white"
                  />
                </label>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                    className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-emerald-600"
                  />
                  Active
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  Sort order
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, sortOrder: parseInt(e.target.value) || 0 }))
                    }
                    className="w-20 rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm text-white"
                  />
                </label>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleSave()}
                  disabled={saving || uploading}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {editingId ? "Save changes" : "Create banner"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
