import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { getMobileUser } from "@/lib/mobile-auth";

export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { password, currentPassword } = await request.json();

    if (!password || password.length < 10) {
      return NextResponse.json(
        { error: "Password must be at least 10 characters" },
        { status: 400 }
      );
    }

    // If the account already has a password, require + verify the current one
    // (mirrors /change-password). Without this, an authenticated session could
    // silently overwrite an existing password without proving knowledge of it.
    const fullUser = await db.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (fullUser?.passwordHash) {
      if (
        !currentPassword ||
        !(await bcrypt.compare(currentPassword, fullUser.passwordHash))
      ) {
        return NextResponse.json(
          { error: "Current password is incorrect" },
          { status: 400 }
        );
      }
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashedPassword },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to set password" },
      { status: 500 }
    );
  }
}
