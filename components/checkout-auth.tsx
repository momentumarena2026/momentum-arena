"use client";

import { useState, useEffect, useRef } from "react";
import { signIn } from "next-auth/react";

interface CheckoutAuthProps {
  onAuthenticated: () => void;
}

export function CheckoutAuth({ onAuthenticated }: CheckoutAuthProps) {
  const [step, setStep] = useState<"phone" | "otp" | "name" | "verifying">("phone");
  const [phone, setPhone] = useState("");
  const [normalizedPhone, setNormalizedPhone] = useState("");
  const [userName, setUserName] = useState("");
  const [otpValues, setOtpValues] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Auto-read OTP from SMS (Web OTP API)
  useEffect(() => {
    if (step !== "otp" || !("OTPCredential" in window)) return;

    const ac = new AbortController();

    navigator.credentials
      .get({
        // @ts-expect-error - OTPCredential is not fully typed
        otp: { transport: ["sms"] },
        signal: ac.signal,
      })
      .then((otp: unknown) => {
        const code = (otp as { code?: string })?.code;
        if (code && code.length === 6) {
          setOtpValues(code.split(""));
          // Auto-submit
          setTimeout(() => handleVerifyOtp(code), 300);
        }
      })
      .catch(() => {});

    return () => ac.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length < 10) {
      setError("Please enter a valid 10-digit phone number");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const normalized = cleaned.length === 10 ? "91" + cleaned : cleaned;
      setNormalizedPhone(normalized);

      const res = await fetch("/api/auth/send-phone-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalized }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Failed to send OTP");
        setLoading(false);
        return;
      }

      setStep("otp");
    } catch {
      setError("Failed to send OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(code?: string) {
    const otpCode = code || otpValues.join("");
    if (otpCode.length < 6) return;

    setLoading(true);
    setError("");
    setStep("verifying");

    try {
      // First verify OTP with MSG91
      const verifyRes = await fetch("/api/auth/verify-phone-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone, otp: otpCode }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || verifyData.error) {
        setError(verifyData.error || "Invalid OTP. Please try again.");
        setStep("otp");
        setLoading(false);
        return;
      }

      // Check if user needs to provide name
      if (verifyData.needsName) {
        setStep("name");
        setLoading(false);
        return;
      }

      // Now sign in with NextAuth
      const result = await signIn("otp", {
        phone: normalizedPhone,
        redirect: false,
      });

      if (result?.error) {
        setError("Login failed. Please try again.");
        setStep("otp");
        setLoading(false);
        return;
      }

      onAuthenticated();
    } catch {
      setError("Verification failed. Please try again.");
      setStep("otp");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = userName.trim();
    if (trimmed.length < 2) {
      setError("Please enter your name (at least 2 characters)");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/save-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone, name: trimmed }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Failed to save name");
        setLoading(false);
        return;
      }

      // Now sign in with NextAuth
      const result = await signIn("otp", {
        phone: normalizedPhone,
        redirect: false,
      });

      if (result?.error) {
        setError("Login failed. Please try again.");
        setLoading(false);
        return;
      }

      onAuthenticated();
    } catch {
      setError("Failed to save name. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newValues = [...otpValues];

    // Handle paste
    if (value.length > 1) {
      const digits = value.replace(/\D/g, "").slice(0, 6).split("");
      for (let i = 0; i < 6; i++) {
        newValues[i] = digits[i] || "";
      }
      setOtpValues(newValues);
      if (digits.length === 6) {
        setTimeout(() => handleVerifyOtp(digits.join("")), 300);
      }
      return;
    }

    newValues[index] = value;
    setOtpValues(newValues);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newValues.every((v) => v.length === 1)) {
      setTimeout(() => handleVerifyOtp(newValues.join("")), 300);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otpValues[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <h3 className="text-white font-semibold text-base mb-1">
        Login to continue
      </h3>
      <p className="text-zinc-500 text-sm mb-4">
        Quick login with your phone number to complete the booking.
      </p>

      {error && (
        <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {step === "phone" && (
        <form onSubmit={handleSendOtp} className="space-y-3">
          <div className="flex gap-2">
            <div className="flex items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 px-3 text-sm text-zinc-400 font-medium">
              +91
            </div>
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="Enter 10-digit number"
              required
              maxLength={10}
              autoFocus
              autoComplete="tel"
              className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-600 tracking-wide"
            />
          </div>
          <button
            type="submit"
            disabled={loading || phone.replace(/\D/g, "").length < 10}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
          >
            {loading ? "Sending OTP..." : "Get OTP"}
          </button>
        </form>
      )}

      {step === "otp" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            OTP sent to <span className="text-emerald-400 font-medium">+91 {normalizedPhone.slice(2)}</span>
          </p>
          <div className="flex gap-2 justify-center">
            {otpValues.map((digit, index) => (
              <input
                key={index}
                ref={(el) => { inputRefs.current[index] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={index === 0 ? 6 : 1}
                value={digit}
                onChange={(e) => handleOtpChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                autoFocus={index === 0}
                autoComplete={index === 0 ? "one-time-code" : "off"}
                className="w-10 h-12 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-center text-lg font-mono font-bold
                           focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-colors"
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => handleVerifyOtp()}
            disabled={loading || otpValues.join("").length < 6}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
          >
            {loading ? "Verifying..." : "Verify & Continue"}
          </button>
          <button
            type="button"
            onClick={() => { setStep("phone"); setOtpValues(["", "", "", "", "", ""]); setError(""); }}
            className="w-full text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ← Change number
          </button>
        </div>
      )}

      {step === "name" && (
        <div className="space-y-3">
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-center">
            <p className="text-sm text-emerald-400 font-medium">Phone verified successfully!</p>
          </div>
          <form onSubmit={handleSaveName} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="checkout-name" className="block text-sm font-medium text-zinc-300">
                What should we call you?
              </label>
              <input
                id="checkout-name"
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Enter your name"
                required
                maxLength={50}
                autoFocus
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-600"
              />
            </div>
            <button
              type="submit"
              disabled={loading || userName.trim().length < 2}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
            >
              {loading ? "Saving..." : "Continue"}
            </button>
          </form>
        </div>
      )}

      {step === "verifying" && (
        <div className="text-center py-4">
          <div className="animate-spin h-8 w-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-zinc-400">Verifying your identity...</p>
        </div>
      )}
    </div>
  );
}
