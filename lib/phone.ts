// Phone number normalization for the MSG91 SMS pipeline.
//
// MSG91 expects the `mobiles` field as digits-only with the country code
// prefix (e.g. "919876543210" for an Indian number). If a bare 10-digit
// Indian number like "9876543210" is sent, MSG91 parses the leading "98"
// as a country code — which, for numbers that happen to start with 94,
// lands on Sri Lanka and gets blocked by DLT filters. This helper
// normalizes whatever variant we have in the DB or an env var into the
// canonical `91xxxxxxxxxx` form.

// Normalizes any Indian phone-number-shaped input to `91<10 digits>`.
// Inputs we handle:
//   "9876543210"        → "919876543210"  (bare 10-digit)
//   "09876543210"       → "919876543210"  (legacy leading zero)
//   "+91 98765-43210"   → "919876543210"  (formatted international)
//   "919876543210"      → "919876543210"  (already normalized)
//   "+919876543210"     → "919876543210"  (plus-prefixed international)
// Non-digits are stripped. A single leading zero is dropped. If the
// result ends up as 10 digits, "91" is prepended. Anything else is
// returned as-is (caller logs or lets MSG91 reject it) — we don't want
// to silently munge a non-Indian number just because it was shaped oddly.
export function normalizeIndianPhone(phone: string): string {
  // Strip anything that isn't a digit: plus signs, spaces, hyphens,
  // parentheses, etc.
  let cleaned = phone.replace(/\D/g, "");

  // Drop a single leading zero (old Indian dial-out format).
  if (cleaned.startsWith("0")) {
    cleaned = cleaned.slice(1);
  }

  // Bare 10-digit Indian number → add the 91 country code.
  if (cleaned.length === 10) {
    cleaned = "91" + cleaned;
  }

  return cleaned;
}
