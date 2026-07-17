import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireAdmin } from "@/lib/admin-auth";
import { uploadImage } from "@/lib/blob";

/**
 * POST /api/admin/promo-banners/upload — multipart `file` field.
 *
 * Optimises the admin's upload once, server-side, into the two
 * variants the render surfaces need (per the promo-banner spec):
 *   - web: max 1920px wide, webp q80
 *   - app: max 1080px wide, webp q80
 * Both keep the original aspect ratio; the response carries it so the
 * app can reserve layout before the image loads.
 *
 * Gated on MANAGE_PROMO_BANNERS (same permission as the banners CRUD).
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin("MANAGE_PROMO_BANNERS");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unauthorized" },
      { status: 401 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  try {
    const input = Buffer.from(await file.arrayBuffer());
    const meta = await sharp(input).metadata();
    if (!meta.width || !meta.height) {
      throw new Error("Couldn't read the image dimensions.");
    }
    const aspectRatio = meta.width / meta.height;

    const [webBuf, appBuf] = await Promise.all([
      sharp(input)
        .resize({ width: 1920, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer(),
      sharp(input)
        .resize({ width: 1080, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer(),
    ]);

    const toFile = (buf: Buffer, tag: string) =>
      new File([new Uint8Array(buf)], `banner-${tag}.webp`, {
        type: "image/webp",
      });
    const [web, app] = await Promise.all([
      uploadImage(toFile(webBuf, "web"), "promo-banners"),
      uploadImage(toFile(appBuf, "app"), "promo-banners"),
    ]);

    return NextResponse.json({
      imageUrl: web.url,
      appImageUrl: app.url,
      aspectRatio,
      width: meta.width,
      height: meta.height,
    });
  } catch (err) {
    console.error("[promo-banners] upload failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 400 },
    );
  }
}
