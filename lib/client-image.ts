/**
 * Browser-only image downscaling, run before an admin upload.
 *
 * **Why this exists.** Vercel caps a serverless function's request body at
 * about 4.5 MB. A hero banner is exactly the field an admin fills from a phone
 * or a camera, where 6–15 MB originals are ordinary — so the POST was being
 * rejected at the platform edge, before any route handler ran. The response to
 * a rejected body is not JSON, so the caller's `await res.json()` threw a
 * SyntaxError rather than surfacing a size problem, and the upload looked like
 * it simply did nothing.
 *
 * Shrinking first removes the failure instead of reporting it: a 12 MB photo
 * leaves here at a few hundred KB, far under the limit, and uploads faster on
 * a venue's connection. The server still re-encodes to webp — this is a
 * transport guard, not a replacement for that.
 *
 * Must only be imported from a client component: it uses createImageBitmap and
 * a canvas.
 */

/** Longest edge we send. The server resizes to 1920 wide anyway. */
const MAX_EDGE = 1920;

/** Below this, re-encoding costs quality for no benefit. */
const SKIP_UNDER_BYTES = 1024 * 1024; // 1 MB

/** Hard ceiling for what we will POST, comfortably under Vercel's ~4.5 MB. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function formatBytes(n: number): string {
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Downscale and re-encode an image for upload.
 *
 * Returns the original file untouched when it is already small, or whenever
 * anything in the canvas path fails — a browser that cannot decode the format
 * (an odd HEIC, say) should still get the chance to upload, and let the server
 * give a real answer. Never throws.
 */
export async function shrinkImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= SKIP_UNDER_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    // JPEG rather than webp: every browser can encode it, and the server
    // converts to webp regardless. Quality steps down only if needed, so a
    // detailed photo still lands under the ceiling.
    for (const quality of [0.85, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (!blob) return file;
      if (blob.size <= MAX_UPLOAD_BYTES) {
        return new File([blob], replaceExt(file.name), { type: "image/jpeg" });
      }
    }
    return file;
  } catch {
    // Canvas path unavailable or the format is undecodable here. Hand back the
    // original and let the server decide — better than blocking the upload.
    return file;
  }
}

function replaceExt(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "banner";
  return `${base}.jpg`;
}

/**
 * Shrink an image, POST it, and return the parsed JSON body.
 *
 * The one place admin image uploads should go through. Every module had
 * hand-rolled this and every copy shared the same two faults: it called
 * `res.json()` before checking `res.ok`, so a non-JSON error body (a platform
 * 413, an HTML 500, an auth redirect) surfaced as "Unexpected token '<'"
 * instead of the real problem; and nothing shrank the file, so a phone photo
 * was rejected at the edge before the route ever ran.
 *
 * Generic in the response shape because the routes do not agree on one:
 * most return `{ url }`, promo-banners returns `{ imageUrl, appImageUrl,
 * aspectRatio }`.
 *
 * Throws an Error whose message is safe to show the admin.
 */
export async function postAdminImage<T>(endpoint: string, file: File): Promise<T> {
  const toSend = await shrinkImageForUpload(file);
  if (toSend.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `That image is ${formatBytes(toSend.size)} and couldn't be shrunk below ` +
        `${formatBytes(MAX_UPLOAD_BYTES)}. Try a smaller one, or export it as JPEG.`,
    );
  }

  const fd = new FormData();
  fd.append("file", toSend);
  const res = await fetch(endpoint, { method: "POST", body: fd });

  const raw = await res.text();
  let data: unknown = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    if (!res.ok) {
      throw new Error(
        res.status === 413
          ? "That image is too large for the server to accept."
          : `Upload failed (${res.status}). Please try again.`,
      );
    }
    throw new Error("The server sent an unexpected response.");
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error;
    throw new Error(msg || `Upload failed (${res.status})`);
  }
  return data as T;
}

/** `postAdminImage` for the common `{ url }` routes. */
export async function uploadAdminImage(endpoint: string, file: File): Promise<string> {
  const data = await postAdminImage<{ url?: string }>(endpoint, file);
  if (!data.url) throw new Error("Upload succeeded but no image URL came back.");
  return data.url;
}
