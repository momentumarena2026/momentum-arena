import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signMobileToken, mobileUserResponse } from "@/lib/mobile-auth";

export async function POST(request: Request) {
  try {
    const { idToken } = await request.json();

    if (!idToken) {
      return NextResponse.json(
        { error: "Google ID token is required" },
        { status: 400 }
      );
    }

    // Verify Google ID token
    const googleRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
    );

    if (!googleRes.ok) {
      return NextResponse.json(
        { error: "Invalid Google token" },
        { status: 401 }
      );
    }

    const googleUser = await googleRes.json();
    const { email, name, picture, sub: googleId } = googleUser;

    if (!email) {
      return NextResponse.json(
        { error: "Email not provided by Google" },
        { status: 400 }
      );
    }

    // Find or create user
    let user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      // Create new user
      user = await db.user.create({
        data: {
          email: email.toLowerCase(),
          name: name || null,
          image: picture || null,
          emailVerified: new Date(),
        },
      });
    } else {
      // Update email verification if not already verified
      if (!user.emailVerified) {
        await db.user.update({
          where: { id: user.id },
          data: {
            emailVerified: new Date(),
            image: user.image || picture || null,
            name: user.name || name || null,
          },
        });
        user = await db.user.findUnique({ where: { id: user.id } });
      }
    }

    if (!user) {
      return NextResponse.json(
        { error: "Failed to create user" },
        { status: 500 }
      );
    }

    // Ensure Google account is linked
    const existingAccount = await db.account.findFirst({
      where: {
        userId: user.id,
        provider: "google",
      },
    });

    if (!existingAccount) {
      await db.account.create({
        data: {
          userId: user.id,
          type: "oauth",
          provider: "google",
          providerAccountId: googleId,
        },
      });
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
      { error: "Google login failed" },
      { status: 500 }
    );
  }
}
