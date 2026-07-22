import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import { getAdminUsers, createUser } from "@/actions/admin-users";
import type { UserRole } from "@prisma/client";

/**
 * GET /api/mobile/admin/users?search=&role=&page=&showDeleted=
 * POST /api/mobile/admin/users
 *
 * Thin wrapper over the web `getAdminUsers` / `createUser` server actions so the
 * RN admin reaches parity with the web /admin/users page: search by
 * name/email/phone, role filter, pagination, show soft-deleted, and create.
 * The actions run their own requireAdmin gate, which reads this request's
 * Bearer token; the requireMobileAdmin gate below stays for defence in depth
 * and for proper 401/403 JSON (the action would throw a 500 instead).
 * `createUser` mirrors the web exactly: it creates a bare User row (no
 * password, no invite email).
 *
 * Permission: MANAGE_USERS (SUPERADMIN bypass) — the same key the web action
 * enforces.
 */
export async function GET(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_USERS");
  if ("error" in gate) return gate.error;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || undefined;
  const role = searchParams.get("role")?.trim() || undefined;
  const showDeleted = searchParams.get("showDeleted") === "1";
  const pageRaw = parseInt(searchParams.get("page") || "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  try {
    const result = await getAdminUsers({
      search,
      role,
      page,
      limit: 20,
      showDeleted,
    });

    return NextResponse.json({
      users: result.users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        bookingCount: u._count.bookings,
        deletedAt: u.deletedAt ? u.deletedAt.toISOString() : null,
        createdAt: u.createdAt.toISOString(),
      })),
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load users" },
      { status: 500 },
    );
  }
}

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().optional(),
  phone: z.string().optional(),
  role: z.enum(["CUSTOMER", "ADMIN"]),
});

export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_USERS");
  if ("error" in gate) return gate.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid data" },
      { status: 400 },
    );
  }

  // createUser re-validates (incl. "email or phone required") and uniqueness,
  // and returns { success, error? } rather than throwing.
  const result = await createUser({
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone,
    role: parsed.data.role as UserRole,
  });

  if (!result.success) {
    return NextResponse.json(
      { error: result.error ?? "Failed to create user" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
