import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { uploadImage } from "@/lib/blob";

export const dynamic = "force-dynamic";

/**
 * Team-logo upload from the ADMIN APP. MANAGE_TOURNAMENTS.
 *
 * A third door to the same cupboard, and each exists for a different
 * credential: the captain's route reads a customer session, the web
 * admin's reads the admin cookie, and this reads the admin bearer token.
 * Loosening any one of them to cover the others would widen who can
 * write a team's logo.
 *
 * The normalisation is identical to the other two — 512px square webp —
 * because every surface renders a logo in a circle, and three upload
 * paths producing different shapes is how one ends up looking wrong
 * somewhere nobody checks.
 */

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_TOURNAMENTS");
  if ("error" in gate) return gate.error;

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
      { error: "Image must be under 4MB." },
      { status: 413 },
    );
  }

  let buf: Buffer;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    buf = await sharp(input)
      // Phone photos carry EXIF orientation; without this they land
      // sideways, which on a circular crop looks like a broken upload.
      .rotate()
      .resize({ width: 512, height: 512, fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (err) {
    console.error("[tournaments] app team-logo decode failed", err);
    return NextResponse.json(
      { error: "That image couldn't be read. Try a JPEG or PNG." },
      { status: 400 },
    );
  }

  try {
    const uploaded = await uploadImage(
      new File([new Uint8Array(buf)], "team-logo.webp", { type: "image/webp" }),
      "team-logos",
    );
    return NextResponse.json({ url: uploaded.url });
  } catch (err) {
    console.error("[tournaments] app team-logo store failed", err);
    return NextResponse.json(
      { error: "Couldn't save the image to storage." },
      { status: 500 },
    );
  }
}
