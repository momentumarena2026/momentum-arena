import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMobileUser, mobileUserResponse } from "@/lib/mobile-auth";

export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(user);
}

// Mobile app uses this to set the user's name after first OTP sign-in
// (new users land with a null name). Keep the allowed fields narrow so we
// don't accidentally let clients rewrite email/phone/auth state.
export async function PATCH(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const patch: { name?: string } = {};
  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (trimmed.length < 2 || trimmed.length > 80) {
      return NextResponse.json(
        { error: "Name must be between 2 and 80 characters" },
        { status: 400 }
      );
    }
    patch.name = trimmed;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No updatable fields" }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: patch,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      emailVerified: true,
      passwordHash: true,
      image: true,
    },
  });

  return NextResponse.json(
    mobileUserResponse({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      emailVerified: !!updated.emailVerified,
      hasPassword: !!updated.passwordHash,
      image: updated.image,
    })
  );
}
