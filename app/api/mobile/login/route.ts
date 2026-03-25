import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { signMobileToken, mobileUserResponse } from "@/lib/mobile-auth";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return NextResponse.json(
        { error: "No account found with this email" },
        { status: 404 }
      );
    }

    if (!user.passwordHash) {
      return NextResponse.json(
        {
          error:
            "No password set for this account. Please login with OTP and set a password.",
        },
        { status: 400 }
      );
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid password" },
        { status: 401 }
      );
    }

    const token = signMobileToken(user.id, user.email!);

    return NextResponse.json({
      user: mobileUserResponse({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        emailVerified: !!user.emailVerified,
        hasPassword: !!user.passwordHash,
        image: user.image,
      }),
      tokens: { accessToken: token },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Login failed" },
      { status: 500 }
    );
  }
}
