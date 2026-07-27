import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getAuthUserId } from "@/lib/auth-unified";
import { uploadImage } from "@/lib/blob";

/** Team-logo upload for tournament registration. Logged-in customers only
 *  (web cookie or mobile bearer). The image is normalised server-side to a
 *  small square webp — nothing user-supplied is served as-is. Admin can
 *  replace/remove any logo from the Teams tab (moderation). */
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > 4 * 1024 * 1024) {
    return NextResponse.json({ error: "Image must be under 4MB" }, { status: 400 });
  }
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const buf = await sharp(input)
      .resize({ width: 512, height: 512, fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
    const uploaded = await uploadImage(
      new File([new Uint8Array(buf)], "team-logo.webp", { type: "image/webp" }),
      "tournament-logos"
    );
    return NextResponse.json({ url: uploaded.url });
  } catch (err) {
    console.error("[tournaments] logo upload failed", err);
    return NextResponse.json({ error: "Couldn't process that image" }, { status: 400 });
  }
}
