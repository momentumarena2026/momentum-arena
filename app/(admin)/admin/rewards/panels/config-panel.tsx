"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import {
  updateAdminRewardConfig,
  type AdminRewardConfigFull,
  type AdminRewardConfigInput,
} from "@/actions/admin-rewards";

interface Props {
  config: AdminRewardConfigFull;
}

const ALL_SPORTS = ["CRICKET", "FOOTBALL", "PICKLEBALL"] as const;
type Sport = (typeof ALL_SPORTS)[number];

/**
 * Live-edit form for RewardConfig. Submitting hits the server action,
 * invalidates the in-memory config cache, and refreshes the page.
 *
 * The Overview panel already shows a digest of these values, so we
 * keep the form layout dense — a single column of grouped fields.
 */
export function RewardsConfigPanel({ config }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Seeded from the live config row. After a successful save the page
  // refreshes via router.refresh() so a re-render comes back with the
  // latest values without a hard reload.
  const [form, setForm] = useState<AdminRewardConfigInput>({
    enabled: config.enabled,
    cafeEarnEnabled: config.cafeEarnEnabled,
    earnRateBookingBps: config.earnRateBookingBps,
    earnRateCafeBps: config.earnRateCafeBps,
    pointValuePaise: config.pointValuePaise,
    minPointsToRedeem: config.minPointsToRedeem,
    maxRedemptionPctOfBill: config.maxRedemptionPctOfBill,
    maxRedemptionPaisePerTxn: config.maxRedemptionPaisePerTxn,
    pointExpiryMonths: config.pointExpiryMonths,
    earnToRedeemMinHours: config.earnToRedeemMinHours,
    signupBonusPoints: config.signupBonusPoints,
    referralEarnerPoints: config.referralEarnerPoints,
    referralReferredPoints: config.referralReferredPoints,
    birthdayBonusPoints: config.birthdayBonusPoints,
    highVelocityEarnDailyThreshold: config.highVelocityEarnDailyThreshold,
    bulkRedemptionPaiseThreshold: config.bulkRedemptionPaiseThreshold,
    enabledSports: config.enabledSports,
  });

  function update<K extends keyof AdminRewardConfigInput>(
    k: K,
    v: AdminRewardConfigInput[K],
  ) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function toggleSport(s: Sport) {
    const has = form.enabledSports.includes(s);
    update(
      "enabledSports",
      has ? form.enabledSports.filter((x) => x !== s) : [...form.enabledSports, s],
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await updateAdminRewardConfig(form);
        setSavedAt(Date.now());
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Section title="Engine">
        <Toggle
          label="Rewards enabled"
          desc="Kill switch for the whole system"
          value={form.enabled}
          onChange={(v) => update("enabled", v)}
        />
        <Toggle
          label="Cafe earn enabled"
          desc="Toggle cafe-order earn without disabling bookings"
          value={form.cafeEarnEnabled}
          onChange={(v) => update("cafeEarnEnabled", v)}
        />
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Enabled sports
          </label>
          <p className="mt-1 text-xs text-zinc-600">
            Leave empty to earn on every sport.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ALL_SPORTS.map((s) => {
              const active = form.enabledSports.includes(s);
              return (
                <button
                  type="button"
                  key={s}
                  onClick={() => toggleSport(s)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                      : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      <Section title="Earn rates">
        <NumberField
          label="Booking earn (bps)"
          desc="200 bps = 2% of post-discount bill"
          value={form.earnRateBookingBps}
          onChange={(v) => update("earnRateBookingBps", v)}
        />
        <NumberField
          label="Cafe earn (bps)"
          desc="500 bps = 5% of post-discount cafe bill"
          value={form.earnRateCafeBps}
          onChange={(v) => update("earnRateCafeBps", v)}
        />
        <RupeeField
          label="Point value (₹)"
          desc="How many rupees each point is worth. Default ₹1."
          paiseValue={form.pointValuePaise}
          onChangePaise={(v) => update("pointValuePaise", v)}
        />
      </Section>

      <Section title="Redemption guard-rails">
        <NumberField
          label="Min points to redeem"
          value={form.minPointsToRedeem}
          onChange={(v) => update("minPointsToRedeem", v)}
        />
        <NumberField
          label="Max % of bill"
          desc="Cap redemption to N% of any single bill"
          value={form.maxRedemptionPctOfBill}
          onChange={(v) => update("maxRedemptionPctOfBill", v)}
        />
        <RupeeField
          label="Max redemption per txn (₹)"
          desc="Absolute cap on a single redemption. Default ₹500."
          paiseValue={form.maxRedemptionPaisePerTxn}
          onChangePaise={(v) => update("maxRedemptionPaisePerTxn", v)}
        />
        <NumberField
          label="Earn→redeem hold (hours)"
          desc="Anti-abuse window. 24 = points earned today not usable until tomorrow"
          value={form.earnToRedeemMinHours}
          onChange={(v) => update("earnToRedeemMinHours", v)}
        />
        <NumberField
          label="Expiry (months)"
          desc="EARNED rows expire this many months after creation"
          value={form.pointExpiryMonths}
          onChange={(v) => update("pointExpiryMonths", v)}
        />
      </Section>

      <Section title="Auto-bonuses (set 0 to disable)">
        <NumberField
          label="Signup bonus"
          value={form.signupBonusPoints}
          onChange={(v) => update("signupBonusPoints", v)}
        />
        <NumberField
          label="Birthday bonus"
          value={form.birthdayBonusPoints}
          onChange={(v) => update("birthdayBonusPoints", v)}
        />
        <NumberField
          label="Referral — earner"
          value={form.referralEarnerPoints}
          onChange={(v) => update("referralEarnerPoints", v)}
        />
        <NumberField
          label="Referral — referred"
          value={form.referralReferredPoints}
          onChange={(v) => update("referralReferredPoints", v)}
        />
      </Section>

      <Section title="Alert thresholds">
        <NumberField
          label="High-velocity earn (pts/day)"
          desc="Trigger HIGH_VELOCITY_EARN above this"
          value={form.highVelocityEarnDailyThreshold}
          onChange={(v) => update("highVelocityEarnDailyThreshold", v)}
        />
        <RupeeField
          label="Bulk redemption threshold (₹)"
          desc="Trigger BULK_REDEMPTION alert at or above this. Default ₹500."
          paiseValue={form.bulkRedemptionPaiseThreshold}
          onChangePaise={(v) => update("bulkRedemptionPaiseThreshold", v)}
        />
      </Section>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {pending ? "Saving…" : "Save changes"}
        </button>
        {savedAt && !pending && (
          <span className="text-xs text-emerald-400">Saved ✓</span>
        )}
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function NumberField({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-300">{label}</span>
      {desc && <span className="block text-[11px] text-zinc-600">{desc}</span>}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseInt(e.target.value || "0", 10))}
        className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
      />
    </label>
  );
}

/**
 * Decimal-rupee input that internally stores paise. The DB column
 * `pointValuePaise` (and friends) stays Int so existing math doesn't
 * change — the admin just sees and edits values in ₹.
 *
 * A local `draft` state lets the user type partial values like "1."
 * or "" without the field snapping back; we only call onChangePaise
 * when the input parses to a non-negative number. Math.round at the
 * boundary so "1.555" becomes 156 paise rather than 155.5.
 */
function RupeeField({
  label,
  desc,
  paiseValue,
  onChangePaise,
}: {
  label: string;
  desc?: string;
  paiseValue: number;
  onChangePaise: (paise: number) => void;
}) {
  const canonical = Number.isFinite(paiseValue)
    ? formatRupeeDraft(paiseValue / 100)
    : "0";
  const [draft, setDraft] = useState(canonical);

  // Sync when the form resets externally (e.g., a config reload). We
  // compare against the canonical formatted string so user typing
  // doesn't bounce — only changes from outside our control resync.
  useEffect(() => {
    setDraft(canonical);
  }, [canonical]);

  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-300">{label}</span>
      {desc && <span className="block text-[11px] text-zinc-600">{desc}</span>}
      <div className="relative mt-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
          ₹
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            const n = parseFloat(v);
            if (Number.isFinite(n) && n >= 0) {
              onChangePaise(Math.round(n * 100));
            }
          }}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 pl-7 pr-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
        />
      </div>
    </label>
  );
}

function formatRupeeDraft(rupees: number): string {
  // Show at most 2 decimal places, trim trailing zeros so the common
  // "₹1" case doesn't display as "1.00".
  if (!Number.isFinite(rupees)) return "0";
  if (Number.isInteger(rupees)) return String(rupees);
  return rupees.toFixed(2).replace(/\.?0+$/, "");
}

function Toggle({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-emerald-500"
      />
      <div>
        <span className="text-sm font-medium text-zinc-200">{label}</span>
        {desc && <span className="block text-xs text-zinc-500">{desc}</span>}
      </div>
    </label>
  );
}
