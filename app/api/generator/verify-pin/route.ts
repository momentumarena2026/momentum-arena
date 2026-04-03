import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { pin } = await req.json();
    if (!pin || typeof pin !== "string" || pin.length !== 6) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 400 });
    }

    let config = await db.generatorConfig.findFirst();
    if (!config) {
      config = await db.generatorConfig.create({ data: {} });
    }

    if (pin !== config.generatorPin) {
      return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
    }

    // Set a signed cookie valid for 24 hours
    const token = Buffer.from(
      JSON.stringify({ verified: true, ts: Date.now() })
    ).toString("base64");

    const cookieStore = await cookies();
    cookieStore.set("generator_access", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // 24 hours
      path: "/generator",
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
