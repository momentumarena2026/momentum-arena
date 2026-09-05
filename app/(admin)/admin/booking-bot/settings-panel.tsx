"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power, Sparkles, FlaskConical } from "lucide-react";
import {
  updateQuickBookSettings,
  type QuickBookSettingsRow,
} from "@/actions/admin-booking-bot";

/**
 * The switches, at the top of the page, because during an incident this
 * is the only part of the screen that matters.
 *
 * Quick book is the one feature whose behaviour depends on something
 * outside this codebase: a provider can retire a model, a prompt can
 * regress, an outage can slow every reply. Turning it off has to be
 * faster than a store release or an OTA, and it returns customers to the
 * ordinary slot picker, which is untouched and always works.
 */
export function SettingsPanel({ initial }: { initial: QuickBookSettingsRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optimistic, because a toggle that waits for a round trip before it
  // moves feels broken and gets clicked twice.
  const [value, setValue] = useState(initial);

  function set(patch: Partial<QuickBookSettingsRow>) {
    const next = { ...value, ...patch };
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await updateQuickBookSettings(patch);
      if (!res.ok) {
        setValue(value);
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section
      className={`rounded-lg border p-4 ${
        value.enabled ? "border-zinc-800 bg-zinc-900/40" : "border-red-500/40 bg-red-500/5"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Power size={16} className={value.enabled ? "text-emerald-400" : "text-red-400"} />
            Quick book is {value.enabled ? "on" : "off"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            {value.enabled
              ? "Customers can open Quick book from the home screen and type a booking in their own words."
              : "The home-screen entry is hidden and the API refuses, so an app that still has the button cached cannot use it either. Booking through Book a Court is unaffected."}
          </p>
        </div>
        <Toggle
          checked={value.enabled}
          disabled={pending}
          onChange={(v) => set({ enabled: v })}
          label={value.enabled ? "Turn off" : "Turn on"}
        />
      </div>

      <div className="mt-4 grid gap-3 border-t border-zinc-800 pt-4 sm:grid-cols-2">
        <BadgeRow
          icon={<Sparkles size={14} className="text-emerald-400" />}
          title="NEW badge"
          // These retire on different days, which is why they are two
          // switches and not one.
          hint="Invites a tap. Turn it off once the feature stops being new — a NEW badge that never goes away stops meaning anything."
          checked={value.newBadge}
          disabled={pending || !value.enabled}
          onChange={(v) => set({ newBadge: v })}
        />
        <BadgeRow
          icon={<FlaskConical size={14} className="text-yellow-400" />}
          title="BETA badge"
          hint="Warns that a reply is a reading of a sentence and should be checked before paying. Keep it on while that is still true."
          checked={value.betaBadge}
          disabled={pending || !value.enabled}
          onChange={(v) => set({ betaBadge: v })}
        />
      </div>

      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
    </section>
  );
}

function BadgeRow({
  icon,
  title,
  hint,
  checked,
  disabled,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded border border-zinc-800 bg-zinc-950/40 p-3">
      <div>
        <p className="flex items-center gap-2 text-sm font-medium text-white">
          {icon}
          {title}
        </p>
        <p className="mt-1 text-xs text-zinc-500">{hint}</p>
      </div>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} label={title} />
    </div>
  );
}

/**
 * A switch whose geometry is written in inline styles, not utility
 * classes.
 *
 * The first version positioned the knob with an arbitrary Tailwind
 * translate and the knob rendered half outside its track — an arbitrary
 * value that does not survive to the stylesheet fails silently and
 * leaves a control that looks broken on a page whose entire job is to
 * be trusted during an incident. Track and knob sizes are stated here so
 * the travel distance is arithmetic rather than a guess.
 *
 * The state is also written out in words. On an admin screen "is this
 * on?" must be readable, not inferred from which side a dot is on.
 */
function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  const TRACK_W = 48;
  const TRACK_H = 28;
  const KNOB = 20;
  const PAD = 4;

  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <span
        className={`w-7 text-right text-xs font-semibold uppercase tracking-wide ${
          checked ? "text-emerald-400" : "text-zinc-500"
        }`}
      >
        {checked ? "On" : "Off"}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{ width: TRACK_W, height: TRACK_H }}
        className={`relative shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          checked
            ? "border-emerald-400 bg-emerald-500"
            : "border-zinc-600 bg-zinc-700"
        }`}
      >
        <span
          style={{
            width: KNOB,
            height: KNOB,
            top: (TRACK_H - KNOB) / 2 - 1,
            left: PAD - 1,
            transform: `translateX(${checked ? TRACK_W - KNOB - PAD * 2 : 0}px)`,
          }}
          className="absolute rounded-full bg-white shadow transition-transform duration-150"
        />
      </button>
    </div>
  );
}
