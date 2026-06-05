import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { uploadImage } from "@/lib/blob";

/**
 * POST /api/admin/cafe/upload-image
 *
 * Multipart upload endpoint for the cafe-menu admin form. Returns
 * the Vercel Blob URL to set on CafeItem.image. Gated on
 * MANAGE_CAFE_MENU so only the admins who maintain the menu can
 * write to the blob store under the cafe/ folder.
 *
 * Body: FormData with a single `file` field. The blob helper enforces
 * size + MIME constraints (5MB, JPEG/PNG/WebP) — keep those
 * authoritative on the server even if the client also blocks.
 *
 * Mirror of /api/admin/shop/upload-image; the two share `uploadImage`
 * in `lib/blob.ts` and differ only in the folder + permission gate.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin("MANAGE_CAFE_MENU");
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
    const uploaded = await uploadImage(file, "cafe");
    return NextResponse.json(uploaded);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 400 },
    );
  }
}
