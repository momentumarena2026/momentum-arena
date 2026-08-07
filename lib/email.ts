import { SITE_URL } from "./site";
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_EMAIL_API = "https://control.msg91.com/api/v5/email/send";

// MSG91 verified SENDING domain. Deliberately a subdomain, NOT the apex:
// the org mailboxes live on momentumarena.com (MX -> secureserver.net), and
// MSG91 refuses to verify a sending domain without pointing its MX records at
// mailer91 — which on the apex would hijack all inbound org mail. The
// subdomain has no mailboxes, so MSG91's MX can live there safely. DMARC uses
// relaxed alignment, so DKIM d=mail.momentumarena.com still aligns.
export const EMAIL_DOMAIN =
  process.env.MSG91_EMAIL_DOMAIN || "mail.momentumarena.com";
export const EMAIL_FROM = {
  email: `noreply@${EMAIL_DOMAIN}`,
  name: "Momentum Arena",
};

const isDev = process.env.NODE_ENV === "development";

// Base URL for links embedded in emails. Matches the convention used in
// lib/notifications.ts so links always resolve to the production host when
// NEXT_PUBLIC_APP_URL is unset (AUTH_URL / NEXTAUTH_URL are honored as a
// fallback for local dev overrides).
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.AUTH_URL ||
  process.env.NEXTAUTH_URL ||
  SITE_URL;

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

/**
 * ⚠️ Raw-body send — currently UNUSABLE on this MSG91 account: every send
 * without a template_id is rejected with 422 "The template id field is
 * required" (verified live 2026-07-02). All senders use MSG91 templates
 * instead (recipients + variables + template_id). Kept only in case the
 * account is later upgraded to allow raw-body sends.
 */
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
        from: options.from || EMAIL_FROM,
        domain: EMAIL_DOMAIN,
        subject: options.subject,
        // MSG91 v5 requires body as {type,data} when no template_id is used —
        // a plain string is rejected with 422 "body.data field is required".
        body: { type: "text/html", data: options.body },
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
        from: EMAIL_FROM,
        domain: EMAIL_DOMAIN,
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
  const changedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
  });

  if (isDev && !MSG91_AUTH_KEY) {
    console.log(
      `\n📧 [DEV] Superadmin password-changed alert to ${SUPERADMIN_RECOVERY_EMAILS.join(", ")} (changed at ${changedAt})\n`
    );
    return true;
  }

  if (!MSG91_AUTH_KEY) {
    console.error("MSG91_AUTH_KEY not set, cannot send superadmin alert");
    return false;
  }

  // Template send — this MSG91 account rejects raw-body emails (422
  // "template id field is required"), so the alert uses the
  // superadmin_password_alert template with a CHANGED_AT variable.
  try {
    const response = await fetch(MSG91_EMAIL_API, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json",
        authkey: MSG91_AUTH_KEY,
      },
      body: JSON.stringify({
        recipients: SUPERADMIN_RECOVERY_EMAILS.map((email) => ({
          to: [{ email }],
          variables: { CHANGED_AT: changedAt },
        })),
        from: EMAIL_FROM,
        domain: EMAIL_DOMAIN,
        template_id: "superadmin_password_alert",
      }),
    });

    const data = await response.json();
    return response.ok || data.status === "success";
  } catch (error) {
    console.error("Superadmin alert email send error:", error);
    return false;
  }
}

export async function sendAdminPasswordResetEmail(
  email: string,
  username: string,
  resetToken: string
): Promise<boolean> {
  const resetUrl = `${APP_URL}/godmode/setup-password?token=${resetToken}`;

  if (isDev && !MSG91_AUTH_KEY) {
    console.log(`\n📧 [DEV] Admin password-reset email to ${email}:`);
    console.log(`   Reset URL: ${resetUrl}\n`);
    return true;
  }

  if (!MSG91_AUTH_KEY) {
    console.error("MSG91_AUTH_KEY not set, cannot send password reset email");
    return false;
  }

  // Template send — this MSG91 account rejects raw-body emails (422
  // "template id field is required"), so the reset mail uses the
  // admin_password_reset template with USERNAME + RESET_LINK variables.
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
              RESET_LINK: resetUrl,
            },
          },
        ],
        from: EMAIL_FROM,
        domain: EMAIL_DOMAIN,
        // MSG91 auto-suffixed the slug on creation ("admin_password_reset"
        // was sluged to _5) — this must match the account's template list.
        template_id: "admin_password_reset_5",
      }),
    });

    const data = await response.json();
    return response.ok || data.status === "success";
  } catch (error) {
    console.error("Admin password reset email send error:", error);
    return false;
  }
}
