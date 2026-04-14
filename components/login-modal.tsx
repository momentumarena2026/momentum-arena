"use client";

import { useActionState, useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  sendOtp,
  verifyOtpAndLogin,
  resendOtp,
  saveNameAndLogin,
  type OtpState,
} from "@/actions/auth";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// --- Phone Input Form ---

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
      <div className="space-y-3">
        <label htmlFor="modal-phone" className="block text-sm font-medium text-zinc-300">
          Phone Number
        </label>
        <div className="flex gap-2">
          <div className="flex items-center justify-center rounded-lg bg-zinc-900 border border-zinc-700 px-3 text-sm text-zinc-400 font-medium">
            +91
          </div>
          <Input
            id="modal-phone"
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

// --- Name Collection Form (shown after OTP for new users) ---

function NameForm({ phone }: { phone: string }) {
  const [state, formAction, isPending] = useActionState<OtpState, FormData>(
    saveNameAndLogin,
    { step: "name", phone }
  );

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-green-500/10 border border-green-500/20 p-3 text-center">
        <p className="text-sm text-green-400 font-medium">Phone verified successfully!</p>
      </div>

      {state.error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {state.error}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="phone" value={phone} />
        <div className="space-y-3">
          <label htmlFor="modal-name" className="block text-sm font-medium text-zinc-300">
            What should we call you?
          </label>
          <Input
            id="modal-name"
            name="name"
            type="text"
            placeholder="Enter your name"
            required
            autoFocus
            maxLength={50}
            className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 text-lg"
          />
        </div>
        <Button
          type="submit"
          disabled={isPending}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-5"
        >
          {isPending ? "Saving..." : "Continue"}
        </Button>
      </form>
    </div>
  );
}

// --- OTP Verification Form ---

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

  // Reset timer on successful resend
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
          // Auto-submit after filling
          setTimeout(() => {
            formRef.current?.requestSubmit();
          }, 300);
        }
      })
      .catch(() => {
        // User dismissed or not supported — ignore
      });

    return () => ac.abort();
  }, []);

  // Handle individual OTP digit input
  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newValues = [...otpValues];

    // Handle paste of full OTP
    if (value.length > 1) {
      const digits = value.replace(/\D/g, "").slice(0, 6).split("");
      for (let i = 0; i < 6; i++) {
        newValues[i] = digits[i] || "";
      }
      setOtpValues(newValues);
      const lastIndex = Math.min(digits.length - 1, 5);
      inputRefs.current[lastIndex]?.focus();

      // Auto-submit if all 6 digits filled
      if (digits.length === 6) {
        setTimeout(() => formRef.current?.requestSubmit(), 300);
      }
      return;
    }

    newValues[index] = value;
    setOtpValues(newValues);

    // Move focus to next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit if all 6 digits filled
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

  // OTP verified but user needs to enter name
  if (state.step === "name" && state.phone) {
    return <NameForm phone={state.phone} />;
  }

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
          <span className="text-zinc-500">
            Resend in {resendTimer}s
          </span>
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

// --- Main Login Content ---

function LoginContent() {
  return (
    <>
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-2xl text-white">Welcome</CardTitle>
        <CardDescription className="text-zinc-400">
          Sign in to Momentum Arena
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PhoneInputForm />
      </CardContent>
    </>
  );
}

// --- Modal Wrapper ---

export function LoginModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleEsc);
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.width = "100%";
      document.body.style.top = `-${window.scrollY}px`;
    } else {
      const scrollY = document.body.style.top;
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.width = "";
      document.body.style.top = "";
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY || "0") * -1);
      }
    }
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.width = "";
      document.body.style.top = "";
    };
  }, [isOpen, handleEsc]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-md my-auto"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-3 -right-3 z-20 w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700
                     text-zinc-400 hover:text-white hover:bg-zinc-700
                     flex items-center justify-center transition-colors"
        >
          ✕
        </button>
        <Card className="w-full bg-zinc-950 border-zinc-800 max-h-[90vh] overflow-y-auto">
          <LoginContent />
        </Card>
      </div>
    </div>,
    document.body
  );
}

export function LoginButton() {
  const [showLogin, setShowLogin] = useState(false);
  const { data: session, status } = useSession();

  // Show nothing while loading to avoid flash
  if (status === "loading") return null;

  // If logged in, show username linking to appropriate dashboard
  if (session?.user) {
    const isAdmin = (session.user as unknown as Record<string, unknown>).userType === "admin";
    const dashboardUrl = isAdmin ? "/godmode" : "/dashboard";
    return (
      <a
        href={dashboardUrl}
        className="flex items-center gap-2 px-3 py-2 md:px-4 md:py-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800
                   text-white text-xs md:text-sm font-medium
                   transition-all duration-200 max-w-[180px] sm:max-w-none"
      >
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
          {(session.user.name?.charAt(0) || session.user.email?.charAt(0) || "?").toUpperCase()}
        </div>
        <span className="truncate">
          {session.user.name || session.user.email?.split("@")[0] || "Account"}
        </span>
      </a>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowLogin(true)}
        className="px-5 py-2 md:px-6 md:py-2.5 rounded-full bg-green-600 hover:bg-green-700
                   text-white text-xs md:text-sm font-semibold tracking-wide
                   transition-all duration-300 hover:scale-105"
      >
        Login
      </button>
      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
    </>
  );
}
