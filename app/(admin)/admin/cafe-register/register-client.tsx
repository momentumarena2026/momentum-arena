"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, Check, X, Trash2, AlertTriangle } from "lucide-react";
import {
  extractRegisterImage,
  confirmRegisterOrders,
  deleteCafeAlias,
  type AliasRow,
  type ReviewRow,
} from "@/actions/admin-cafe-register";

type MenuOption = { id: string; name: string; price: number };

/**
 * Photograph the register page, check what was read, create the orders.
 *
 * The review table is the feature. Transcription saves the typing; the
 * checking is not optional, because these rows become real orders against
 * real tills and a misread digit is money. So every row arrives editable,
 * every row shows HOW it was matched, and nothing is created until the
 * admin presses the button.
 */
export function CafeRegisterClient({
  menu,
  aliases,
}: {
  menu: MenuOption[];
  aliases: AliasRow[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    uploadId: string | null;
    autoMatched: number;
  } | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  // Which rows the admin changed. Kept apart from the rows themselves
  // because it is about the EDIT, not the value — and it decides what
  // gets learned as a deliberate correction rather than a lucky match.
  const [corrected, setCorrected] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<string | null>(null);

  const byId = new Map(menu.map((m) => [m.id, m]));

  async function onPick(file: File) {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      // Read locally to a data URL. The page stays in the cafe; nothing
      // needs a public copy of the day's takings to exist.
      const dataUrl = await shrinkToDataUrl(file);
      const res = await extractRegisterImage(dataUrl);
      setResult({ uploadId: res.uploadId, autoMatched: res.autoMatched });
      setRows(res.rows);
      setCorrected(new Set());
      if (res.error) setError(res.error);
      else if (res.rows.length === 0) {
        setError("Nothing readable on that page. Try a straighter, brighter photo.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that image.");
    } finally {
      setBusy(false);
    }
  }

  function setRow(i: number, patch: Partial<ReviewRow>, isCorrection = false) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    if (isCorrection) setCorrected((c) => new Set(c).add(i));
  }

  const ready = rows.filter((r) => r.cafeItemId && r.payment);
  const blocked = rows.length - ready.length;

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await confirmRegisterOrders({
        uploadId: result?.uploadId ?? null,
        rows: rows
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => r.cafeItemId && r.payment)
          .map(({ r, i }) => ({
            rawItem: r.rawItem,
            cafeItemId: r.cafeItemId as string,
            qty: r.qty,
            payment: r.payment as "CASH" | "UPI_QR",
            corrected: corrected.has(i),
          })),
      });
      if (!res.success) {
        setError(res.error ?? "Couldn't create the orders.");
        return;
      }
      setDone(
        `Created ${res.created} order${res.created === 1 ? "" : "s"}` +
          (res.failed ? `, ${res.failed} failed` : "") +
          `. Learned ${res.learned} shorthand${res.learned === 1 ? "" : "s"}.`,
      );
      setRows([]);
      setResult(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* ── Upload ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPick(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ? "Reading the page…" : "Photograph or upload a page"}
        </button>
        <p className="mt-2 text-xs text-zinc-500">
          A straight, well-lit photo of one page. Every row comes back editable —
          nothing is created until you press the button at the bottom.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
      {done ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {done}
        </div>
      ) : null}

      {/* ── Review ───────────────────────────────────────────────── */}
      {rows.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">
              {rows.length} row{rows.length === 1 ? "" : "s"} read
            </h2>
            <p className="text-xs text-zinc-500">
              {result?.autoMatched ?? 0} matched automatically
              {blocked > 0 ? ` · ${blocked} need an item or a payment method` : ""}
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">As written</th>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Price</th>
                  <th className="px-3 py-2 font-medium">Paid by</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {rows.map((r, i) => {
                  const item = r.cafeItemId ? byId.get(r.cafeItemId) : null;
                  return (
                    <tr key={i} className={r.cafeItemId ? "" : "bg-amber-500/5"}>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs text-zinc-300">{r.rawItem}</span>
                        {r.time ? (
                          <span className="ml-2 text-[11px] text-zinc-600">{r.time}</span>
                        ) : null}
                        {/* How it was matched. A reviewer scanning twelve
                            rows needs to know which ones to actually
                            look at. */}
                        <div className="mt-0.5">
                          <SourceTag source={r.matchSource} />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={r.cafeItemId ?? ""}
                          onChange={(e) =>
                            setRow(
                              i,
                              {
                                cafeItemId: e.target.value || null,
                                itemName: byId.get(e.target.value)?.name ?? null,
                              },
                              true,
                            )
                          }
                          className={`w-full rounded border bg-zinc-950 px-2 py-1.5 text-sm text-white ${
                            r.cafeItemId ? "border-zinc-700" : "border-amber-500/60"
                          }`}
                        >
                          <option value="">— pick an item —</option>
                          {menu.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} · ₹{m.price}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          value={r.qty}
                          onChange={(e) =>
                            setRow(i, { qty: Math.max(1, Number(e.target.value) || 1) })
                          }
                          className="w-16 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-white"
                        />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {item ? (
                          <span className="text-zinc-300">₹{item.price * r.qty}</span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                        {/* The written figure is shown, never merged. A
                            price change, a staff discount and a misread
                            digit look identical here and need different
                            answers — so the admin gets both numbers. */}
                        {r.priceWarning ? (
                          <span
                            className="ml-2 inline-flex items-center gap-1 text-amber-300"
                            title={`The page says ₹${r.priceWarning.written}; the menu says ₹${r.priceWarning.expected}`}
                          >
                            <AlertTriangle size={11} />₹{r.priceWarning.written} on page
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={r.payment ?? ""}
                          onChange={(e) =>
                            setRow(i, {
                              payment: (e.target.value || null) as ReviewRow["payment"],
                            })
                          }
                          className={`rounded border bg-zinc-950 px-2 py-1.5 text-sm text-white ${
                            r.payment ? "border-zinc-700" : "border-amber-500/60"
                          }`}
                        >
                          <option value="">— pick —</option>
                          <option value="CASH">Cash</option>
                          <option value="UPI_QR">Online</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                          title="Drop this row"
                          className="text-zinc-600 hover:text-red-400"
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={create}
              disabled={pending || ready.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Create {ready.length} order{ready.length === 1 ? "" : "s"}
            </button>
            {blocked > 0 ? (
              <span className="text-xs text-amber-300">
                {blocked} row{blocked === 1 ? "" : "s"} still need an item or a payment
                method — they won&apos;t be created.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ── What it has learned ──────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">
          Shorthand it knows <span className="text-zinc-500">({aliases.length})</span>
        </h2>
        <p className="max-w-3xl text-sm text-zinc-400">
          Every row you approve teaches the shorthand on that line. Nothing here
          was configured by hand — it is what the register has actually been
          written as. Remove one and the next page will ask about it again.
        </p>
        {aliases.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-sm text-zinc-500">
            Nothing learned yet. Upload a page and approve it.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {aliases.map((a) => (
              <li
                key={a.id}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm"
              >
                <span className="font-mono text-xs text-white">{a.term}</span>
                <span className="text-zinc-600">→</span>
                <span className="text-emerald-300">{a.itemName}</span>
                <span className="text-[10px] text-zinc-600">×{a.seenCount}</span>
                <button
                  onClick={() =>
                    startTransition(async () => {
                      await deleteCafeAlias(a.id);
                      router.refresh();
                    })
                  }
                  title="Forget this"
                  className="text-zinc-600 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SourceTag({ source }: { source: ReviewRow["matchSource"] }) {
  const map = {
    alias: ["you taught this", "border-emerald-500/40 text-emerald-300"],
    exact: ["menu name", "border-zinc-700 text-zinc-400"],
    fuzzy: ["close spelling — check", "border-amber-500/40 text-amber-300"],
    none: ["not recognised", "border-amber-500/60 text-amber-200"],
  } as const;
  const [label, cls] = map[source];
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${cls}`}>{label}</span>
  );
}

/**
 * Downscale in the browser before sending.
 *
 * A modern phone photo is several megabytes, and the provider caps a
 * request at 20MB — but the real reason is cost and latency: the model
 * charges a flat token price per image and reads a 1600px page as well
 * as a 4000px one.
 */
async function shrinkToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  // JPEG at 0.85: handwriting survives it, and PNG would triple the size
  // for no legibility a model can use.
  return canvas.toDataURL("image/jpeg", 0.85);
}
