import { NextRequest, NextResponse } from "next/server";
import { normalizePhone } from "@/lib/otp";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { phone, name } = await request.json();

    if (!phone || !name) {
      return NextResponse.json({ error: "Phone and name are required" }, { status: 400 });
    }

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      return NextResponse.json({ error: "Name must be at least 2 characters" }, { status: 400 });
    }

    if (trimmedName.length > 50) {
      return NextResponse.json({ error: "Name must be 50 characters or less" }, { status: 400 });
    }

    const normalizedPhone = normalizePhone(phone);
    const user = await db.user.findUnique({ where: { phone: normalizedPhone } });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await db.user.update({
      where: { id: user.id },
      data: { name: trimmedName },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Save name error:", error);
    return NextResponse.json({ error: "Failed to save name" }, { status: 500 });
  }
}
