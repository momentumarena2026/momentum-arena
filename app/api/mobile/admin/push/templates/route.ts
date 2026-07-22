import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  listPushTemplates,
  updatePushTemplate,
} from "@/actions/admin-push";

/**
 * Mobile admin — automated push template configuration.
 *
 * GET  → { templates: PushTemplateView[] } (registry merged with overrides)
 * POST { key, enabled?, title?, body? } → { templates } refreshed, or
 *      400 { error } (unknown key / bad placeholder / too long).
 *
 * Permission: MANAGE_PUSH, mirroring the web /admin/push dashboard.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PUSH");
  if ("error" in gate) return gate.error;
  const templates = await listPushTemplates();
  return NextResponse.json({ templates });
}

export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_PUSH");
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => null)) as {
    key?: string;
    enabled?: boolean;
    title?: string;
    body?: string;
  } | null;
  if (!body?.key) {
    return NextResponse.json({ error: "Missing template key" }, { status: 400 });
  }

  const result = await updatePushTemplate(
    body.key,
    { enabled: body.enabled, title: body.title, body: body.body },
  );
  if (!result.success) {
    return NextResponse.json({ error: result.error ?? "Failed" }, { status: 400 });
  }

  const templates = await listPushTemplates();
  return NextResponse.json({ templates });
}
