import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireAdmin } from "@/lib/admin-auth";
import { uploadImage } from "@/lib/blob";

/**
 * Tournament hero-banner upload (wizard). Optimised server-side to a wide
 * webp; the returned URL is what the wizard stores on
 * Tournament.bannerImageUrl. MANAGE_TOURNAMENTS.
 *
 * Note on size: the client shrinks images before POSTing (lib/client-image),
 * because Vercel rejects a request body over ~4.5MB at the edge — before this
 * handler runs at all, with a non-JSON response. So a too-large upload can
 * never be reported from here; the guard below only catches callers that
 * bypass the wizard. That is also why the failure used to look like nothing
 * happening rather than an error.
 *
 * Errors are deliberately specific. The previous blanket "Couldn't process
 * that image" covered a decode failure, a missing blob token and a size
 * rejection alike, which made a broken upload impossible to diagnose from
 * the admin screen.
 */

/** Matches the client ceiling; both sit under Vercel's ~4.5MB body limit. */
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    await requireAdmin("MANAGE_TOURNAMENTS");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unauthorized" },
      { status: 401 }
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `Image must be under ${Math.round(MAX_BYTES / 1024 / 1024)}MB — that one is ${(
          file.size /
          1024 /
          1024
        ).toFixed(1)}MB.`,
      },
      { status: 413 }
    );
  }

  // Decode + re-encode. Split from the upload below so a corrupt or
  // unsupported file reports differently from a storage failure.
  let buf: Buffer;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    buf = await sharp(input)
      .rotate() // honour EXIF orientation, or phone photos land sideways
      .resize({ width: 1920, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (err) {
    console.error("[tournaments] banner decode failed", {
      name: file.name,
      type: file.type,
      size: file.size,
      err,
    });
    return NextResponse.json(
      { error: "That image couldn't be read. Try a JPEG or PNG." },
      { status: 400 }
    );
  }

  try {
    const uploaded = await uploadImage(
      new File([new Uint8Array(buf)], "tournament-banner.webp", { type: "image/webp" }),
      "tournament-banners"
    );
    return NextResponse.json({ url: uploaded.url });
  } catch (err) {
    // Nearly always a misconfigured blob store (missing or stale
    // BLOB_READ_WRITE_TOKEN). Surfaced as a 500 with a distinct message so it
    // is not mistaken for a bad image.
    console.error("[tournaments] banner store failed", err);
    return NextResponse.json(
      { error: "Couldn't save the image to storage. Check the blob store configuration." },
      { status: 500 }
    );
  }
}
