import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { uploadProductImage } from "@/lib/blob";

/**
 * POST /api/admin/shop/upload-image
 *
 * Multipart upload endpoint for the admin product form. Returns the
 * Vercel Blob URL to set on Product.imageUrl. Gated on
 * MANAGE_SHOP_CATALOG so the same admins who CRUD products own this.
 *
 * Body: FormData with a single `file` field. The blob helper enforces
 * size + MIME constraints (5MB, JPEG/PNG/WebP) — keep those
 * authoritative on the server even if the client also blocks.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin("MANAGE_SHOP_CATALOG");
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
    const uploaded = await uploadProductImage(file);
    return NextResponse.json(uploaded);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 400 },
    );
  }
}
