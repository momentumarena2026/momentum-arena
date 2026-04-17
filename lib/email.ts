const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_EMAIL_API = "https://control.msg91.com/api/v5/email/send";

const isDev = process.env.NODE_ENV === "development";

// Base URL for links embedded in emails. Matches the convention used in
// lib/notifications.ts so links always resolve to the production host when
// NEXT_PUBLIC_APP_URL is unset (AUTH_URL / NEXTAUTH_URL are honored as a
// fallback for local dev overrides).
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.AUTH_URL ||
  process.env.NEXTAUTH_URL ||
  "https://momentumarena.com";

// Superadmin recovery email addresses — loaded from env var
export const SUPERADMIN_RECOVERY_EMAILS = (
  process.env.SUPERADMIN_RECOVERY_EMAILS ||
  "y12.nakul@gmail.com,tangrianand@gmail.com,saxenautkarsh193@gmail.com"
).split(",").map((e) => e.trim()).filter(Boolean);

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
      signal: AbortSignal.timeout(5000),
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
  const setupUrl = `${APP_URL}/godmode/setup-password?token=${inviteToken}`;

  if (isDev && !MSG91_AUTH_KEY) {
    console.log(`\n📧 [DEV] Admin invite email to ${email}:`);
    console.log(`   Username: ${username}`);
    console.log(`   Setup URL: ${setupUrl}\n`);
    return true;
  }

  if (!MSG91_AUTH_KEY) {
    console.error("MSG91_AUTH_KEY not set, cannot send admin invite email");
    return false;
  }

  try {
    const response = await fetch(MSG91_EMAIL_API, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json",
        authkey: MSG91_AUTH_KEY,
      },
      body: JSON.stringify({
        recipients: [
          {
            to: [{ email, name: username }],
            variables: {
              USERNAME: username,
              EMAIL: email,
              ROLE: "Admin",
              SET_PASSWORD_LINK: setupUrl,
            },
          },
        ],
        from: { email: "noreply@momentumarena.com", name: "Momentum Arena" },
        domain: "momentumarena.com",
        template_id: "admin_password_3",
      }),
    });

    const data = await response.json();
    return response.ok || data.status === "success";
  } catch (error) {
    console.error("Admin invite email send error:", error);
    return false;
  }
}

export async function sendSuperadminPasswordNotification(
  _newPassword?: string
): Promise<boolean> {
  void _newPassword; // Password is NOT included in email for security
  const results = await Promise.allSettled(
    SUPERADMIN_RECOVERY_EMAILS.map((email) =>
      sendEmail({
        to: [{ email }],
        subject: "Momentum Arena - Superadmin Password Changed",
        body: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ef4444;">⚠️ Superadmin Password Changed</h2>
            <p>The superadmin (<strong>gamelord</strong>) password was changed at <strong>${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</strong>.</p>
            <p>If you did not make this change, please contact the admin team immediately and reset the password via the admin dashboard.</p>
            <p style="color: #666; font-size: 14px;">This is an automated security notification sent to all recovery addresses.</p>
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
  const resetUrl = `${APP_URL}/godmode/setup-password?token=${resetToken}`;

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
