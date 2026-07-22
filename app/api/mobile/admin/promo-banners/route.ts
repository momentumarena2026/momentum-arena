import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  getPromoBannersAdminData,
  createPromoBanner,
  updatePromoBanner,
  togglePromoBanner,
  deletePromoBanner,
  type PromoBannerInput,
} from "@/actions/admin-promo-banners";

/**
 * Mobile admin — promotion banners (Web & App Config). Mirrors the web
 * manager; requireMobileAdmin here returns proper 401/403 JSON, and the
 * shared actions independently enforce MANAGE_PROMO_BANNERS against this
 * request's Bearer token. Image FILE uploads happen on the web admin (the
 * app has no native picker); the app can still set an image URL directly
 * and edit every other field.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PROMO_BANNERS");
  if ("error" in gate) return gate.error;
  const data = await getPromoBannersAdminData();
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PROMO_BANNERS");
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => null)) as
    | ({ action?: string; id?: string; isActive?: boolean } & {
        banner?: PromoBannerInput;
      })
    | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ ok: false, error: "Missing action" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "create": {
        if (!body.banner) return NextResponse.json({ ok: false, error: "Missing banner" });
        const result = await createPromoBanner(body.banner);
        return NextResponse.json(result);
      }
      case "update": {
        if (!body.id || !body.banner) {
          return NextResponse.json({ ok: false, error: "Missing id/banner" });
        }
        const result = await updatePromoBanner(body.id, body.banner);
        return NextResponse.json(result);
      }
      case "toggle": {
        if (!body.id) return NextResponse.json({ ok: false, error: "Missing id" });
        const result = await togglePromoBanner(body.id, !!body.isActive);
        return NextResponse.json(result);
      }
      case "delete": {
        if (!body.id) return NextResponse.json({ ok: false, error: "Missing id" });
        const result = await deletePromoBanner(body.id);
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json(
          { ok: false, error: `Unknown action: ${body.action}` },
          { status: 400 },
        );
    }
  } catch (error) {
    console.error("[mobile-admin] promo-banners action failed", body.action, error);
    return NextResponse.json(
      { ok: false, error: "Something went wrong. Try again." },
      { status: 500 },
    );
  }
}
