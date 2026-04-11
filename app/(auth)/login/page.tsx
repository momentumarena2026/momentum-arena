"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import {
  sendOtp,
  verifyOtpAndLogin,
  resendOtp,
  type OtpState,
} from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function PhoneInputForm() {
  const [state, formAction, isPending] = useActionState<OtpState, FormData>(
    sendOtp,
    { step: "input" }
  );

  if (state.step === "verify" && state.phone) {
    return <VerifyOtpForm phone={state.phone} />;
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {state.error}
        </div>
      )}
      <div className="space-y-2">
        <label htmlFor="phone" className="text-sm font-medium text-zinc-300">
          Phone Number
        </label>
        <div className="flex gap-2">
          <div className="flex items-center justify-center rounded-lg bg-zinc-900 border border-zinc-700 px-3 text-sm text-zinc-400 font-medium">
            +91
          </div>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={10}
            placeholder="Enter 10-digit number"
            required
            autoFocus
            autoComplete="tel"
            className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 text-lg tracking-wide"
          />
        </div>
      </div>
      <Button
        type="submit"
        disabled={isPending}
        className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-5"
      >
        {isPending ? "Sending OTP..." : "Get OTP"}
      </Button>
      <p className="text-xs text-zinc-500 text-center">
        We&apos;ll send a 6-digit OTP to verify your number
      </p>
    </form>
  );
}

function VerifyOtpForm({ phone }: { phone: string }) {
  const [state, formAction, isPending] = useActionState<OtpState, FormData>(
    verifyOtpAndLogin,
    { step: "verify", phone }
  );
  const [showResend, setShowResend] = useState(false);
  const [resendTimer, setResendTimer] = useState(30);
  const [resendState, resendAction, isResending] = useActionState<OtpState, FormData>(
    resendOtp,
    { step: "verify", phone }
  );
  const [otpValues, setOtpValues] = useState(["", "", "", "", "", ""]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  // Resend timer countdown
  useEffect(() => {
    if (resendTimer <= 0) {
      setShowResend(true);
      return;
    }
    const interval = setInterval(() => {
      setResendTimer((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [resendTimer]);

  useEffect(() => {
    if (resendState.success) {
      setResendTimer(30);
      setShowResend(false);
    }
  }, [resendState.success]);

  // Auto-read OTP from SMS (Web OTP API)
  useEffect(() => {
    if (!("OTPCredential" in window)) return;

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
          const digits = code.split("");
          setOtpValues(digits);
          setTimeout(() => formRef.current?.requestSubmit(), 300);
        }
      })
      .catch(() => {});

    return () => ac.abort();
  }, []);

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newValues = [...otpValues];

    if (value.length > 1) {
      const digits = value.replace(/\D/g, "").slice(0, 6).split("");
      for (let i = 0; i < 6; i++) {
        newValues[i] = digits[i] || "";
      }
      setOtpValues(newValues);
      const lastIndex = Math.min(digits.length - 1, 5);
      inputRefs.current[lastIndex]?.focus();
      if (digits.length === 6) {
        setTimeout(() => formRef.current?.requestSubmit(), 300);
      }
      return;
    }

    newValues[index] = value;
    setOtpValues(newValues);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newValues.every((v) => v.length === 1)) {
      setTimeout(() => formRef.current?.requestSubmit(), 300);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otpValues[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const displayPhone = phone.startsWith("91") ? phone.slice(2) : phone;

  return (
    <div className="space-y-4">
      {state.error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {state.error}
        </div>
      )}
      {resendState.success && (
        <div className="rounded-md bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-400">
          OTP resent successfully!
        </div>
      )}

      <div className="rounded-md bg-zinc-800/50 border border-zinc-700 p-3">
        <p className="text-sm text-zinc-300">
          OTP sent to{" "}
          <span className="font-medium text-white">+91 {displayPhone}</span>
        </p>
      </div>

      <form ref={formRef} action={formAction} className="space-y-4">
        <input type="hidden" name="phone" value={phone} />
        <input type="hidden" name="code" value={otpValues.join("")} />

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
              className="w-11 h-13 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-center text-xl font-mono font-bold
                         focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/50 transition-colors"
            />
          ))}
        </div>

        <Button
          type="submit"
          disabled={isPending || otpValues.join("").length < 6}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-5"
        >
          {isPending ? "Verifying..." : "Verify & Login"}
        </Button>
      </form>

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-zinc-400 hover:text-zinc-300 transition-colors"
        >
          Change number
        </button>
        {!showResend ? (
          <span className="text-zinc-500">Resend in {resendTimer}s</span>
        ) : (
          <form action={resendAction}>
            <input type="hidden" name="phone" value={phone} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={isResending}
              className="text-green-500 hover:text-green-400 p-0 h-auto"
            >
              {isResending ? "Sending..." : "Resend OTP"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Card className="w-full max-w-md bg-zinc-950 border-zinc-800">
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-2xl text-white">Welcome</CardTitle>
        <CardDescription className="text-zinc-400">
          Sign in to Momentum Arena
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PhoneInputForm />
      </CardContent>
    </Card>
  );
}
