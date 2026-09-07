import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireAdmin } from "@/lib/admin-auth";
import { uploadImage } from "@/lib/blob";

/**
 * Team-logo upload from the ADMIN side. MANAGE_TOURNAMENTS.
 *
 * A separate door from the captain's /api/tournaments/logo-upload, which
 * authenticates a CUSTOMER session. An admin signed into the admin shell
 * has no customer session, so reusing that route would have meant either
 * signing them in as a customer or loosening its gate — both worse than
 * one more small handler.
 *
 * Same 512px square webp as the captain's route, deliberately: every
 * surface renders a team logo in a circle, and two upload paths producing
 * different shapes is how one of them ends up looking wrong somewhere
 * nobody checks. The URL is stored by adminEditTeam.
 *
 * Note on size: the client shrinks before POSTing (lib/client-image),
 * because Vercel rejects a body over ~4.5MB at the edge before this
 * handler runs at all. The guard below only catches callers that bypass
 * the admin UI.
 */

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    await requireAdmin("MANAGE_TOURNAMENTS");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unauthorized" },
      { status: 401 },
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
      { status: 413 },
    );
  }

  // Decode and re-encode separately from storing, so a corrupt file
  // reports differently from a blob-store failure. The two need
  // completely different fixes and used to look identical.
  let buf: Buffer;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    buf = await sharp(input)
      // Honour EXIF orientation, or a phone photo lands sideways.
      .rotate()
      .resize({ width: 512, height: 512, fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (err) {
    console.error("[tournaments] admin team-logo decode failed", {
      name: file.name,
      type: file.type,
      size: file.size,
      err,
    });
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
    console.error("[tournaments] admin team-logo store failed", err);
    return NextResponse.json(
      { error: "Couldn't save the image to storage. Check the blob store configuration." },
      { status: 500 },
    );
  }
}
