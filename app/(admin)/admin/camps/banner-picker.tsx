"use client";

import { useState } from "react";

/**
 * Hero-image picker for a camp — shared by the create form and the edit
 * screen so the two can't drift (the edit screen previously had no way
 * to set an image at all).
 *
 * Upload is server-normalised to a 16:9 webp; the value stored here is
 * just the resulting blob URL.
 */
export function CampBannerPicker({
  value,
  onChange,
  labelClass,
}: {
  value: string;
  onChange: (url: string) => void;
  labelClass: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <label className={labelClass}>Hero image</label>
      <div className="flex flex-wrap items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob URL, no loader config
          <img
            src={value}
            alt=""
            className="h-20 w-36 rounded-lg border border-zinc-700 object-cover"
          />
        ) : (
          <div className="flex h-20 w-36 items-center justify-center rounded-lg border border-dashed border-zinc-700 text-[11px] text-zinc-600">
            Sport photo
          </div>
        )}
        <div className="flex flex-col gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700">
            {busy ? "Uploading…" : value ? "Replace image" : "Upload image"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                // Reset immediately so picking the same file twice refires.
                e.target.value = "";
                if (!file) return;
                setBusy(true);
                setError(null);
                try {
                  const fd = new FormData();
                  fd.append("file", file);
                  const res = await fetch("/api/admin/camps/banner-upload", {
                    method: "POST",
                    body: fd,
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || "Upload failed");
                  onChange(data.url);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Upload failed");
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          {value && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="text-left text-xs text-zinc-500 hover:text-red-400"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-zinc-500">
        Cropped to 16:9. Leave empty to use the sport&apos;s stock photo.
      </p>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
