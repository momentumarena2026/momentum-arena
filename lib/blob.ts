import { put, del } from "@vercel/blob";

/**
 * Server-side image upload helper used by every admin module that
 * stores public-facing images (shop products, cafe menu items, ...).
 *
 * Wraps `@vercel/blob`'s `put()` with a stable folder convention,
 * size + MIME validation, and a randomised pathname so two admins
 * uploading the same filename don't collide. Returns the
 * production-served URL (the `url` field from Vercel Blob) and the
 * stored pathname (which we keep on Product.imageUrl to recover for
 * future deletes).
 *
 * Configured via env:
 *   - BLOB_READ_WRITE_TOKEN (required) — Vercel auto-injects on
 *     deploys with a Blob store attached. Locally, populate via
 *     `vercel env pull`.
 *
 * Constraints:
 *   - 5 MB cap per file (server-enforced; the form input is
 *     additionally `accept`-attributed on the client)
 *   - JPEG / PNG / WebP only — keeps Edge image opt simple and
 *     blocks SVG (XSS surface) + GIF (almost always too big)
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface UploadedImage {
  /** Public URL — store on Product.imageUrl. */
  url: string;
  /** Pathname inside the blob store, needed for delete. */
  pathname: string;
  /** Mime type that was uploaded. */
  contentType: string;
  /** Size in bytes. */
  size: number;
}

/**
 * Upload a public-facing image to Vercel Blob.
 *
 * @param file  A `File` (browser) or `Blob` with a known size/type.
 * @param folder  Top-level folder inside the bucket. Use a stable
 *                module name like "products" or "cafe" so we can
 *                grep + manage the store later.
 */
export async function uploadImage(
  file: File | Blob,
  folder: string,
): Promise<UploadedImage> {
  if (file.size > MAX_BYTES) {
    throw new Error(
      `Image is too large — max ${Math.round(MAX_BYTES / 1024 / 1024)}MB.`,
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    throw new Error(
      "Unsupported image format. Use JPEG, PNG, or WebP.",
    );
  }

  // Vercel Blob's `addRandomSuffix: true` appends an opaque token
  // to the requested pathname so we never overwrite an existing
  // file even when two admins upload "ball.jpg" back-to-back.
  const safeName = ("name" in file && typeof file.name === "string"
    ? file.name
    : "image"
  )
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]/g, "-")
    .slice(0, 60);

  const result = await put(`${folder}/${safeName}`, file, {
    access: "public",
    contentType: file.type,
    addRandomSuffix: true,
  });

  return {
    url: result.url,
    pathname: result.pathname,
    contentType: file.type,
    size: file.size,
  };
}

/**
 * Best-effort delete — when an admin replaces or removes an image
 * we drop the previous blob to avoid orphans. Failures are logged
 * but never thrown; the caller's primary work (DB write) should
 * always succeed even if the blob delete races.
 */
export async function deleteImage(urlOrPathname: string): Promise<void> {
  try {
    await del(urlOrPathname);
  } catch (err) {
    console.warn("[blob] failed to delete", urlOrPathname, err);
  }
}

// Legacy aliases — the shop module called these `uploadProductImage`
// and `deleteProductImage` before the helper was generalised for the
// cafe module. Keep them so other modules don't have to change in
// lockstep.
export const uploadProductImage = (file: File | Blob, folder = "products") =>
  uploadImage(file, folder);
export const deleteProductImage = deleteImage;
