import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
  const cookieStore = await cookies();

  // Delete the admin session cookie
  cookieStore.delete("admin-session-token");

  return NextResponse.json({ success: true });
}
