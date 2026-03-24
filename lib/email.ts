const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_EMAIL_API = "https://control.msg91.com/api/v5/email/send";

const isDev = process.env.NODE_ENV === "development";

// Superadmin recovery email addresses
export const SUPERADMIN_RECOVERY_EMAILS = [
  "y12.nakul@gmail.com",
  "tangrianand@gmail.com",
  "saxenautkarsh193@gmail.com",
];

interface SendEmailOptions {
  to: { email: string; name?: string }[];
  subject: string;
  body: string;
  from?: { email: string; name?: string };
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  if (isDev && !MSG91_AUTH_KEY) {
    console.log(`\n📧 [DEV] Email to ${options.to.map((t) => t.email).join(", ")}:`);
    console.log(`   Subject: ${options.subject}`);
    console.log(`   Body: ${options.body.substring(0, 200)}...\n`);
    return true;
  }

  if (!MSG91_AUTH_KEY) {
    console.error("MSG91_AUTH_KEY not set, cannot send email");
    return false;
  }

  try {
    const response = await fetch(MSG91_EMAIL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: MSG91_AUTH_KEY,
      },
      body: JSON.stringify({
        to: options.to,
        from: options.from || {
          email: "noreply@momentumarena.com",
          name: "Momentum Arena",
        },
        subject: options.subject,
        body: options.body,
      }),
    });

    const data = await response.json();
    return response.ok || data.status === "success";
  } catch (error) {
    console.error("Email send error:", error);
    return false;
  }
}

export async function sendAdminInviteEmail(
  email: string,
  username: string,
  inviteToken: string
): Promise<boolean> {
  const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  const setupUrl = `${baseUrl}/godmode/setup-password?token=${inviteToken}`;

  return sendEmail({
    to: [{ email, name: username }],
    subject: "You've been invited to Momentum Arena Admin",
    body: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #10b981;">Welcome to Momentum Arena Admin</h2>
        <p>Hi ${username},</p>
        <p>You've been invited as an admin. Click the link below to set your password and get started:</p>
        <p style="margin: 24px 0;">
          <a href="${setupUrl}" style="background: #10b981; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
            Set Your Password
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">This link expires in 48 hours.</p>
        <p style="color: #666; font-size: 14px;">If you didn't expect this invitation, please ignore this email.</p>
      </div>
    `,
  });
}

export async function sendSuperadminPasswordNotification(
  newPassword: string
): Promise<boolean> {
  const results = await Promise.allSettled(
    SUPERADMIN_RECOVERY_EMAILS.map((email) =>
      sendEmail({
        to: [{ email }],
        subject: "Momentum Arena - Superadmin Password Changed",
        body: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ef4444;">Superadmin Password Changed</h2>
            <p>The superadmin (gamelord) password has been updated.</p>
            <p><strong>New password:</strong> ${newPassword}</p>
            <p style="color: #666; font-size: 14px;">Keep this secure. This email was sent to all recovery addresses.</p>
          </div>
        `,
      })
    )
  );

  return results.some((r) => r.status === "fulfilled" && r.value);
}

export async function sendAdminPasswordResetEmail(
  email: string,
  username: string,
  resetToken: string
): Promise<boolean> {
  const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  const resetUrl = `${baseUrl}/godmode/setup-password?token=${resetToken}`;

  return sendEmail({
    to: [{ email, name: username }],
    subject: "Momentum Arena Admin - Password Reset",
    body: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f59e0b;">Password Reset Request</h2>
        <p>Hi ${username},</p>
        <p>Click the link below to reset your admin password:</p>
        <p style="margin: 24px 0;">
          <a href="${resetUrl}" style="background: #f59e0b; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
            Reset Password
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you didn't request this, please ignore it.</p>
      </div>
    `,
  });
}
