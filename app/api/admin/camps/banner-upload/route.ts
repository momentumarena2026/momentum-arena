import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireAdmin } from "@/lib/admin-auth";
import { uploadImage } from "@/lib/blob";

/**
 * Hero-image upload for a camp. Admin-only (MANAGE_CAMPS) — unlike the
 * team-logo route, which any signed-in customer may use during
 * registration.
 *
 * Normalised server-side to a 16:9 webp so the card and the detail hero
 * crop predictably, and so nothing user-supplied is served as-is.
 */
export async function POST(request: NextRequest) {
  await requireAdmin("MANAGE_CAMPS");

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > 6 * 1024 * 1024) {
    return NextResponse.json({ error: "Image must be under 6MB" }, { status: 400 });
  }
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const buf = await sharp(input)
      .resize({ width: 1280, height: 720, fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
    const uploaded = await uploadImage(
      new File([new Uint8Array(buf)], "camp-banner.webp", { type: "image/webp" }),
      "camp-banners",
    );
    return NextResponse.json({ url: uploaded.url });
  } catch (err) {
    console.error("[camps] banner upload failed", err);
    return NextResponse.json({ error: "Couldn't process that image" }, { status: 400 });
  }
}
