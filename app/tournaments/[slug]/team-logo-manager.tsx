"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, Trash2, ImageIcon } from "lucide-react";
import { postAdminImage } from "@/lib/client-image";

type Props = {
  teamId: string;
  teamName: string;
  logoUrl: string | null;
  canEdit: boolean;
};

/**
 * Captain's team-logo control, available any time after registering.
 *
 * The logo used to be write-once on the registration form, so a captain who
 * skipped it or picked the wrong image had to ask the venue to change it
 * from the admin Teams tab. This sits with the squad manager and the slot
 * picks — the other things a captain owns after registering.
 *
 * Two calls, deliberately: the file goes to /api/tournaments/logo-upload,
 * which normalises it to a square webp in our own blob store, and the
 * returned URL is then saved via /api/tournaments/logo. The save re-checks
 * the URL is one of ours, so neither endpoint has to trust the other.
 */
export function TeamLogoManager({ teamId, teamName, logoUrl, canEdit }: Props) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(logoUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string | null) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/tournaments/logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, logoUrl: next }),
      });
      const raw = await res.text();
      let data: { error?: string } = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`Couldn't save (${res.status}). Please try again.`);
      }
      if (!res.ok) throw new Error(data.error || "Couldn't save the logo");
      setUrl(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the logo");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    try {
      // Shared helper: shrinks before sending (a phone photo is rejected at
      // the edge otherwise) and parses the response defensively.
      const data = await postAdminImage<{ url?: string }>(
        "/api/tournaments/logo-upload",
        file,
      );
      if (!data.url) throw new Error("Upload succeeded but no image came back.");
      await save(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
        <ImageIcon className="h-4 w-4 text-zinc-500" /> Team logo
      </h3>
      <p className="mt-0.5 text-xs text-zinc-500">
        Shown on the tournament page, the points table and the bracket.
      </p>

      <div className="mt-3 flex items-center gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`${teamName} logo`}
            className="h-14 w-14 rounded-full border border-zinc-700 object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-zinc-700 text-sm font-bold text-zinc-600">
            {teamName.slice(0, 2).toUpperCase()}
          </div>
        )}

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={`flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 ${
                busy ? "cursor-wait opacity-60" : "cursor-pointer hover:bg-zinc-800"
              }`}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {busy ? "Saving…" : url ? "Change logo" : "Add logo"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Cleared so re-picking the same file after a failure
                  // fires onChange again.
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </label>
            {url && !busy && (
              <button
                type="button"
                onClick={() => void save(null)}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-500 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            The tournament has ended — the logo is locked.
          </p>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
