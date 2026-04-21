"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

// Shared Indian-number phone input.
//
// Renders a fixed "+91" prefix pill next to a digits-only input that
// accepts exactly 10 digits. All input is sanitized on the client —
// non-digits are stripped on every keystroke/paste, and the value is
// capped at 10 characters. The server is still expected to normalize
// via `normalizeIndianPhone` (lib/phone.ts) before storage / SMS, but
// having the UI enforce the shape eliminates the category of "user
// pasted +91 98765..." or "user typed a landline prefix" bugs that
// used to leak into the MSG91 pipeline.
//
// Controlled: the parent owns the string state (the 10 raw digits, no
// country code). The parent decides when to prepend "91" for DB /
// server-action calls — we recommend calling `normalizeIndianPhone`
// there for consistency.

interface PhoneInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "onChange" | "value" | "type" | "maxLength" | "pattern" | "inputMode"
  > {
  value: string;
  onChange: (digits: string) => void;
  // For forms that rely on native FormData, set a name and the 10-digit
  // raw value will be submitted. Server-side, pass through
  // normalizeIndianPhone before saving.
  name?: string;
  // Optional visual variant. Defaults to "dark" to match the rest of
  // the app's zinc-800/700 surface styling; pass "bare" to only get
  // layout (no border/bg) and style yourself via `className`.
  variant?: "dark" | "bare";
  // className is applied to the <input>; wrapperClassName to the flex row.
  wrapperClassName?: string;
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput(
    {
      value,
      onChange,
      variant = "dark",
      className,
      wrapperClassName,
      placeholder = "Enter 10-digit number",
      autoComplete = "tel",
      ...rest
    },
    ref
  ) {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const sanitized = e.target.value.replace(/\D/g, "").slice(0, 10);
      onChange(sanitized);
    };

    const inputDarkClass =
      "flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 tracking-wide";
    const prefixDarkClass =
      "flex items-center justify-center rounded-lg bg-zinc-900 border border-zinc-700 px-3 text-sm text-zinc-400 font-medium";

    return (
      <div className={cn("flex gap-2", wrapperClassName)}>
        <div
          className={variant === "dark" ? prefixDarkClass : "flex items-center"}
          aria-hidden
        >
          +91
        </div>
        <input
          ref={ref}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]{10}"
          maxLength={10}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={cn(variant === "dark" && inputDarkClass, className)}
          {...rest}
        />
      </div>
    );
  }
);
