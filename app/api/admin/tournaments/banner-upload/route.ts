import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireAdmin } from "@/lib/admin-auth";
import { uploadImage } from "@/lib/blob";

/** Tournament hero-banner upload (wizard). Mirrors the promo-banner
 *  upload: optimised server-side to a wide webp; the returned URL is what
 *  the wizard stores on Tournament.bannerImageUrl. MANAGE_TOURNAMENTS. */
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
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const buf = await sharp(input)
      .resize({ width: 1920, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const uploaded = await uploadImage(
      new File([new Uint8Array(buf)], "tournament-banner.webp", { type: "image/webp" }),
      "tournament-banners"
    );
    return NextResponse.json({ url: uploaded.url });
  } catch (err) {
    console.error("[tournaments] banner upload failed", err);
    return NextResponse.json({ error: "Couldn't process that image" }, { status: 400 });
  }
}
