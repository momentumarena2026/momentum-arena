import { db } from "@/lib/db";
import {
  sendToAdmins,
  sendToUser,
  type PushKind,
  type SendResult,
} from "@/lib/push";

/**
 * Push template registry — the single source of truth for every AUTOMATED
 * push notification in the product.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────
 * Any new automated trigger MUST be added to PUSH_TEMPLATES and sent via
 * sendTemplatedToUser / sendTemplatedToAdmins. Never call the raw
 * sendToUser/sendToAdmins from lib/push.ts for an automated event — those
 * are reserved for the manual broadcast + test tools on /admin/push.
 * Registering here is what makes the message editable, toggleable and
 * documented on the admin dashboards (web /admin/push, app Push screen).
 * ──────────────────────────────────────────────────────────────────────
 *
 * Each entry carries the DEFAULT copy + the variables the call site
 * provides. Admins override title/body/enabled per template via the
 * PushTemplate DB row (absent row = defaults, enabled). Placeholders use
 * {varName} and are substituted verbatim; unknown placeholders are left
 * in place so a typo is visible rather than silently swallowed.
 *
 * Template keys are a separate namespace from `data.kind` (the mobile
 * shell's tap-routing discriminator): one kind may map to several
 * templates (e.g. rewards_earned covers seven earn types).
 */

export type PushTemplateAudience = "customer" | "admin";

export interface PushTemplateVariable {
  name: string;
  description: string;
  example: string;
}

export interface PushTemplateDef {
  key: string;
  audience: PushTemplateAudience;
  label: string;
  /** Plain-English "when does this fire" shown on the dashboard. */
  trigger: string;
  defaultTitle: string;
  defaultBody: string;
  variables: PushTemplateVariable[];
}

export const PUSH_TEMPLATES = [
  // ── Customer: bookings ────────────────────────────────────────────
  {
    key: "booking_confirmed",
    audience: "customer",
    label: "Booking confirmed",
    trigger:
      "When a booking is confirmed — online payment success, UPI auto-confirm, or admin verification.",
    defaultTitle: "Booking confirmed",
    defaultBody: "Your slot on {when} is locked in.",
    variables: [
      { name: "when", description: "Booking date and time", example: "5 Jul 7–8 AM" },
    ],
  },
  {
    key: "booking_cancelled",
    audience: "customer",
    label: "Booking cancelled",
    trigger: "When an admin cancels a booking without a refund.",
    defaultTitle: "Booking cancelled",
    defaultBody: "Your slot on {when} was cancelled. {reason}",
    variables: [
      { name: "when", description: "Booking date and time", example: "5 Jul 7–8 AM" },
      { name: "reason", description: "Cancellation reason (may be empty)", example: "Reason: rain" },
    ],
  },
  {
    key: "booking_refunded",
    audience: "customer",
    label: "Booking refunded",
    trigger: "When an admin cancels a booking with a refund.",
    defaultTitle: "Booking refunded",
    defaultBody: "Your slot on {when} was refunded. {reason}",
    variables: [
      { name: "when", description: "Booking date and time", example: "5 Jul 7–8 AM" },
      { name: "reason", description: "Refund reason (may be empty)", example: "Reason: rain" },
    ],
  },
  {
    key: "booking_reminder_24h",
    audience: "customer",
    label: "Reminder — 1 day before",
    trigger: "Hourly cron; sent the day before the booking (once, alongside the SMS).",
    defaultTitle: "{sport} tomorrow at {time}",
    defaultBody: "See you at Momentum Arena.",
    variables: [
      { name: "sport", description: "Sport name", example: "Cricket" },
      { name: "time", description: "Start time", example: "7 AM" },
    ],
  },
  {
    key: "booking_reminder_2h",
    audience: "customer",
    label: "Reminder — 2 hours before",
    trigger: "Hourly cron; sent when the booking starts in ~2 hours (alongside the SMS).",
    defaultTitle: "{sport} in 2 hours",
    defaultBody: "Tap to view your booking. {time}.",
    variables: [
      { name: "sport", description: "Sport name", example: "Cricket" },
      { name: "time", description: "Start time", example: "7 AM" },
    ],
  },
  {
    key: "booking_reminder_1h",
    audience: "customer",
    label: "Reminder — 1 hour before",
    trigger: "Hourly cron; sent when the booking starts next hour (push only, no SMS).",
    defaultTitle: "{sport} in 1 hour",
    defaultBody: "Heading to Momentum Arena? {time}. Tap for booking details.",
    variables: [
      { name: "sport", description: "Sport name", example: "Cricket" },
      { name: "time", description: "Start time", example: "7 AM" },
    ],
  },
  {
    key: "waitlist_slot_available",
    audience: "customer",
    label: "Waitlist — slot opened up",
    trigger:
      "When a cancellation frees a slot the customer is waitlisted for (signed-in users).",
    defaultTitle: "A slot just opened up",
    defaultBody: "{slot} just opened up. Book now before someone else grabs it.",
    variables: [
      { name: "slot", description: "Sport, date and time of the freed slot", example: "Cricket · 5 Jul · 7–8 AM" },
    ],
  },
  // ── Customer: cafe ────────────────────────────────────────────────
  {
    key: "cafe_order_preparing",
    audience: "customer",
    label: "Cafe order — being prepared",
    trigger: "When an admin moves a cafe order to PREPARING.",
    defaultTitle: "Your cafe order is being prepared",
    defaultBody: "Order #{orderNumber} is in the kitchen. We'll ping you when it's ready.",
    variables: [
      { name: "orderNumber", description: "Cafe order number", example: "142" },
    ],
  },
  {
    key: "cafe_order_ready",
    audience: "customer",
    label: "Cafe order — ready for pickup",
    trigger: "When an admin moves a cafe order to READY.",
    defaultTitle: "Your cafe order is ready",
    defaultBody: "Order #{orderNumber} — head to the cafe counter for pickup.",
    variables: [
      { name: "orderNumber", description: "Cafe order number", example: "142" },
    ],
  },
  // ── Customer: rewards ─────────────────────────────────────────────
  {
    key: "rewards_earned_booking",
    audience: "customer",
    label: "Rewards — booking points",
    trigger: "When points are credited for a confirmed booking.",
    defaultTitle: "Points for your booking",
    defaultBody: "+{points} pts added — tap to view",
    variables: [{ name: "points", description: "Points credited", example: "150" }],
  },
  {
    key: "rewards_earned_booking_remainder",
    audience: "customer",
    label: "Rewards — venue-payment bonus",
    trigger: "When the remaining venue payment clears and bonus points are credited.",
    defaultTitle: "Bonus points — venue payment cleared",
    defaultBody: "+{points} pts added — tap to view",
    variables: [{ name: "points", description: "Points credited", example: "75" }],
  },
  {
    key: "rewards_earned_cafe",
    audience: "customer",
    label: "Rewards — cafe points",
    trigger: "When points are credited for a completed cafe order.",
    defaultTitle: "Points for your cafe order",
    defaultBody: "+{points} pts added — tap to view",
    variables: [{ name: "points", description: "Points credited", example: "20" }],
  },
  {
    key: "rewards_earned_signup",
    audience: "customer",
    label: "Rewards — welcome bonus",
    trigger: "When the signup bonus is credited to a new account.",
    defaultTitle: "Welcome bonus",
    defaultBody: "+{points} pts added — tap to view",
    variables: [{ name: "points", description: "Points credited", example: "100" }],
  },
  {
    key: "rewards_earned_referral",
    audience: "customer",
    label: "Rewards — referral bonus",
    trigger: "When a referral completes and the bonus is credited.",
    defaultTitle: "Referral bonus",
    defaultBody: "+{points} pts added — tap to view",
    variables: [{ name: "points", description: "Points credited", example: "200" }],
  },
  {
    key: "rewards_earned_birthday",
    audience: "customer",
    label: "Rewards — birthday bonus",
    trigger: "When the birthday bonus is credited.",
    defaultTitle: "🎂 Happy birthday!",
    defaultBody: "+{points} pts added — tap to view",
    variables: [{ name: "points", description: "Points credited", example: "100" }],
  },
  {
    key: "rewards_earned_adjustment",
    audience: "customer",
    label: "Rewards — manual adjustment",
    trigger: "When an admin manually credits bonus points.",
    defaultTitle: "Bonus points added",
    defaultBody: "+{points} pts added — tap to view",
    variables: [{ name: "points", description: "Points credited", example: "50" }],
  },
  // ── Admin alerts ──────────────────────────────────────────────────
  {
    key: "admin_pending_booking",
    audience: "admin",
    label: "Admin — booking awaiting verification",
    trigger:
      "When a trust-based booking (static QR / cash) is created and needs verification.",
    defaultTitle: "New booking awaiting verification",
    defaultBody: "{customerName} just booked — verify the screenshot or collect cash to confirm.",
    variables: [
      { name: "customerName", description: "Customer's name", example: "Rahul" },
    ],
  },
  {
    key: "admin_booking_confirmed",
    audience: "admin",
    label: "Admin — booking confirmed",
    trigger: "When any booking is confirmed.",
    defaultTitle: "Booking confirmed",
    defaultBody: "{customerName} · {date} · {amount}",
    variables: [
      { name: "customerName", description: "Customer's name", example: "Rahul" },
      { name: "date", description: "Booking date", example: "5 Jul" },
      { name: "amount", description: "Booking amount", example: "Rs.1,000" },
    ],
  },
  {
    key: "admin_booking_cancelled",
    audience: "admin",
    label: "Admin — booking cancelled",
    trigger: "When a booking is cancelled without a refund.",
    defaultTitle: "Booking cancelled",
    defaultBody: "{customerName} cancelled{reason}",
    variables: [
      { name: "customerName", description: "Customer's name", example: "Rahul" },
      { name: "reason", description: "Reason, prefixed with — (may be empty)", example: " — rain" },
    ],
  },
  {
    key: "admin_booking_refunded",
    audience: "admin",
    label: "Admin — booking refunded",
    trigger: "When a booking is cancelled with a refund.",
    defaultTitle: "Booking refunded",
    defaultBody: "{customerName} · refund processed{reason}",
    variables: [
      { name: "customerName", description: "Customer's name", example: "Rahul" },
      { name: "reason", description: "Reason, prefixed with — (may be empty)", example: " — rain" },
    ],
  },
] as const satisfies readonly PushTemplateDef[];

export type PushTemplateKey = (typeof PUSH_TEMPLATES)[number]["key"];

export function getTemplateDef(key: PushTemplateKey): PushTemplateDef {
  const def = PUSH_TEMPLATES.find((t) => t.key === key);
  if (!def) throw new Error(`Unknown push template: ${key}`);
  return def;
}

/** Substitute {var} placeholders, then tidy whitespace artifacts left by
 *  empty variables (double spaces, dangling separators before EOL). */
function substitute(text: string, vars: Record<string, string>): string {
  const out = text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
    name in vars ? vars[name] : match,
  );
  return out.replace(/[ \t]{2,}/g, " ").replace(/\s+([.،])$/g, "$1").trim();
}

export interface RenderedTemplate {
  title: string;
  body: string;
}

/**
 * Resolve a template: registry defaults merged with the admin's DB
 * override, placeholders substituted. Returns null when the template is
 * disabled — callers must then SKIP the send entirely.
 */
export async function renderPushTemplate(
  key: PushTemplateKey,
  vars: Record<string, string>,
): Promise<RenderedTemplate | null> {
  const def = getTemplateDef(key);
  let override: { enabled: boolean; title: string | null; body: string | null } | null =
    null;
  try {
    override = await db.pushTemplate.findUnique({
      where: { key },
      select: { enabled: true, title: true, body: true },
    });
  } catch (err) {
    // Missing table (pre-migration deploy window) → fall back to defaults
    // rather than dropping the notification.
    console.warn(
      "[push-templates] override lookup failed, using defaults:",
      err instanceof Error ? err.message : err,
    );
  }
  if (override && !override.enabled) return null;

  return {
    title: substitute(override?.title?.trim() || def.defaultTitle, vars),
    body: substitute(override?.body?.trim() || def.defaultBody, vars),
  };
}

/**
 * Templated customer push. The ONLY sanctioned way to send an automated
 * push to a customer (see THE RULE above). `data` is passed through
 * verbatim — keep using the existing `kind` values, the mobile shell's
 * tap-routing depends on them.
 */
export async function sendTemplatedToUser(
  userId: string,
  key: PushTemplateKey,
  vars: Record<string, string>,
  data: { kind: PushKind } & Record<string, string>,
): Promise<SendResult & { skipped?: boolean }> {
  const rendered = await renderPushTemplate(key, vars);
  if (!rendered) {
    return { attempted: 0, succeeded: 0, failed: 0, cleanedUp: 0, skipped: true };
  }
  return sendToUser(userId, { ...rendered, data });
}

/** Templated admin fan-out. Same contract as sendTemplatedToUser. */
export async function sendTemplatedToAdmins(
  key: PushTemplateKey,
  vars: Record<string, string>,
  data: { kind: PushKind } & Record<string, string>,
): Promise<SendResult & { skipped?: boolean }> {
  const rendered = await renderPushTemplate(key, vars);
  if (!rendered) {
    return { attempted: 0, succeeded: 0, failed: 0, cleanedUp: 0, skipped: true };
  }
  return sendToAdmins({ ...rendered, data });
}
