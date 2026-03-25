"use client";

import { useActionState, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  sendOtp,
  verifyOtpAndLogin,
  resendOtp,
  loginWithPassword,
  forgotPasswordSendOtp,
  forgotPasswordVerifyAndReset,
  type OtpState,
  type PasswordLoginState,
  type ForgotPasswordState,
} from "@/actions/auth";
import { signIn, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// --- OTP Login Form ---

function OtpLoginForm() {
  const [state, formAction, isPending] = useActionState<OtpState, FormData>(
    sendOtp,
    { step: "input" }
  );

  if (state.step === "verify" && state.identifier && state.type) {
    return (
      <VerifyOtpForm identifier={state.identifier} type={state.type} />
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {state.error}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="modal-otp-email" className="text-zinc-300">
          Email Address
        </Label>
        <Input
          id="modal-otp-email"
          name="identifier"
          type="email"
          placeholder="you@example.com"
          required
          autoFocus
          className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
        />
      </div>
      <Button
        type="submit"
        disabled={isPending}
        className="w-full bg-green-600 hover:bg-green-700 text-white"
      >
        {isPending ? "Sending OTP..." : "Send OTP"}
      </Button>
    </form>
  );
}

function VerifyOtpForm({
  identifier,
  type,
}: {
  identifier: string;
  type: "email" | "phone";
}) {
  const [state, formAction, isPending] = useActionState<OtpState, FormData>(
    verifyOtpAndLogin,
    { step: "verify", identifier, type }
  );
  const [showResend, setShowResend] = useState(false);
  const [resendState, resendAction, isResending] = useActionState<
    OtpState,
    FormData
  >(resendOtp, { step: "verify", identifier, type });

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
          We sent a 6-digit code to{" "}
          <span className="font-medium text-white">{identifier}</span>
        </p>
      </div>
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="identifier" value={identifier} />
        <input type="hidden" name="type" value={type} />
        <div className="space-y-2">
          <Label htmlFor="modal-code" className="text-zinc-300">
            Enter OTP
          </Label>
          <Input
            id="modal-code"
            name="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000000"
            required
            autoFocus
            autoComplete="one-time-code"
            className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 text-center text-2xl tracking-[0.5em] font-mono"
          />
        </div>
        <Button
          type="submit"
          disabled={isPending}
          className="w-full bg-green-600 hover:bg-green-700 text-white"
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
          Change email
        </button>
        {!showResend ? (
          <button
            type="button"
            onClick={() => setShowResend(true)}
            className="text-green-500 hover:text-green-400 transition-colors"
          >
            Resend OTP
          </button>
        ) : (
          <form action={resendAction}>
            <input type="hidden" name="identifier" value={identifier} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={isResending}
              className="text-green-500 hover:text-green-400 p-0 h-auto"
            >
              {isResending ? "Sending..." : "Confirm Resend"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

// --- Password Login Form ---

function PasswordLoginForm({
  onForgotPassword,
}: {
  onForgotPassword: () => void;
}) {
  const [state, formAction, isPending] = useActionState<
    PasswordLoginState,
    FormData
  >(loginWithPassword, {});

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <div
          className={`rounded-md p-3 text-sm border ${
            state.errorCode === "PASSWORD_NOT_SET"
              ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"
              : "bg-red-500/10 border-red-500/20 text-red-400"
          }`}
        >
          {state.error}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="modal-pw-email" className="text-zinc-300">
          Email Address
        </Label>
        <Input
          id="modal-pw-email"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
          autoFocus
          className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="modal-pw-password" className="text-zinc-300">
          Password
        </Label>
        <Input
          id="modal-pw-password"
          name="password"
          type="password"
          placeholder="Enter your password"
          required
          className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
        />
      </div>
      <Button
        type="submit"
        disabled={isPending}
        className="w-full bg-green-600 hover:bg-green-700 text-white"
      >
        {isPending ? "Signing in..." : "Sign In"}
      </Button>
      <button
        type="button"
        onClick={onForgotPassword}
        className="text-sm text-green-500 hover:text-green-400 transition-colors w-full text-center"
      >
        Forgot password?
      </button>
    </form>
  );
}

// --- Forgot Password Form ---

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [sendState, sendAction, isSending] = useActionState<
    ForgotPasswordState,
    FormData
  >(forgotPasswordSendOtp, { step: "email" });

  const [resetState, resetAction, isResetting] = useActionState<
    ForgotPasswordState,
    FormData
  >(forgotPasswordVerifyAndReset, {
    step: "reset",
    identifier: sendState.identifier,
  });

  if (resetState.step === "done") {
    return (
      <div className="space-y-4 text-center">
        <div className="rounded-md bg-green-500/10 border border-green-500/20 p-4 text-sm text-green-400">
          Password reset successfully! You can now sign in with your new
          password.
        </div>
        <Button
          onClick={onBack}
          className="w-full bg-green-600 hover:bg-green-700 text-white"
        >
          Back to Login
        </Button>
      </div>
    );
  }

  // Step 2: Enter OTP + new password
  if (sendState.step === "otp" && sendState.identifier) {
    return (
      <form action={resetAction} className="space-y-4">
        {resetState.error && (
          <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {resetState.error}
          </div>
        )}
        <div className="rounded-md bg-zinc-800/50 border border-zinc-700 p-3">
          <p className="text-sm text-zinc-300">
            We sent a code to{" "}
            <span className="font-medium text-white">
              {sendState.identifier}
            </span>
          </p>
        </div>
        <input type="hidden" name="identifier" value={sendState.identifier} />
        <div className="space-y-2">
          <Label htmlFor="fp-code" className="text-zinc-300">
            OTP Code
          </Label>
          <Input
            id="fp-code"
            name="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000000"
            required
            autoFocus
            className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500 text-center text-2xl tracking-[0.5em] font-mono"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fp-password" className="text-zinc-300">
            New Password
          </Label>
          <Input
            id="fp-password"
            name="password"
            type="password"
            placeholder="Min 8 characters"
            required
            className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fp-confirm" className="text-zinc-300">
            Confirm Password
          </Label>
          <Input
            id="fp-confirm"
            name="confirmPassword"
            type="password"
            placeholder="Confirm your password"
            required
            className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
          />
        </div>
        <Button
          type="submit"
          disabled={isResetting}
          className="w-full bg-green-600 hover:bg-green-700 text-white"
        >
          {isResetting ? "Resetting..." : "Reset Password"}
        </Button>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors w-full text-center"
        >
          Back to Login
        </button>
      </form>
    );
  }

  // Step 1: Enter email
  return (
    <form action={sendAction} className="space-y-4">
      {sendState.error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {sendState.error}
        </div>
      )}
      <p className="text-sm text-zinc-400">
        Enter your email address and we&apos;ll send you a code to reset your
        password.
      </p>
      <div className="space-y-2">
        <Label htmlFor="fp-email" className="text-zinc-300">
          Email Address
        </Label>
        <Input
          id="fp-email"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
          autoFocus
          className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
        />
      </div>
      <Button
        type="submit"
        disabled={isSending}
        className="w-full bg-green-600 hover:bg-green-700 text-white"
      >
        {isSending ? "Sending..." : "Send Reset Code"}
      </Button>
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors w-full text-center"
      >
        Back to Login
      </button>
    </form>
  );
}

// --- Main Login Content ---

type LoginTab = "otp" | "password";
type LoginView = "login" | "forgot-password";

function LoginContent() {
  const [tab, setTab] = useState<LoginTab>("otp");
  const [view, setView] = useState<LoginView>("login");

  if (view === "forgot-password") {
    return (
      <>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-white">Reset Password</CardTitle>
          <CardDescription className="text-zinc-400">
            Verify your email to set a new password
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm onBack={() => setView("login")} />
        </CardContent>
      </>
    );
  }

  return (
    <>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl text-white">Welcome</CardTitle>
        <CardDescription className="text-zinc-400">
          Sign in to Momentum Arena
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Google Login */}
        <Button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          className="w-full bg-white hover:bg-gray-100 text-black font-medium"
        >
          <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continue with Google
        </Button>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-800" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-zinc-950 px-2 text-zinc-500">
              or continue with
            </span>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setTab("otp")}
            className={`flex-1 text-sm py-2 rounded-md transition-colors ${
              tab === "otp"
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:text-zinc-300"
            }`}
          >
            Email OTP
          </button>
          <button
            type="button"
            onClick={() => setTab("password")}
            className={`flex-1 text-sm py-2 rounded-md transition-colors ${
              tab === "password"
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:text-zinc-300"
            }`}
          >
            Password
          </button>
        </div>

        {/* Tab content */}
        {tab === "otp" ? (
          <OtpLoginForm />
        ) : (
          <PasswordLoginForm onForgotPassword={() => setView("forgot-password")} />
        )}
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
    }
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
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
    const isAdmin = (session.user as Record<string, unknown>).userType === "admin";
    const dashboardUrl = isAdmin ? "/godmode" : "/dashboard";
    return (
      <a
        href={dashboardUrl}
        className="flex items-center gap-2 px-3 py-2 md:px-5 md:py-2.5 rounded-full bg-green-600 hover:bg-green-700
                   text-white text-xs md:text-sm font-semibold tracking-wide
                   transition-all duration-300 hover:scale-105 max-w-[150px] sm:max-w-none"
      >
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
          {(session.user.name?.charAt(0) || session.user.email?.charAt(0) || "?").toUpperCase()}
        </div>
        <span className="truncate">
          {session.user.name || session.user.email?.split("@")[0]}
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
