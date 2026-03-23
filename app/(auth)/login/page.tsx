"use client";

import { useActionState, useState } from "react";
import { sendOtp, verifyOtpAndLogin, resendOtp, type OtpState } from "@/actions/auth";
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

function SendOtpForm() {
  const [state, formAction, isPending] = useActionState<OtpState, FormData>(
    sendOtp,
    { step: "input" }
  );

  // If OTP was sent successfully, show verify form
  if (state.step === "verify" && state.identifier && state.type) {
    return (
      <VerifyOtpForm
        identifier={state.identifier}
        type={state.type}
      />
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
        <Label htmlFor="identifier" className="text-zinc-300">
          Email Address
        </Label>
        <Input
          id="identifier"
          name="identifier"
          type="email"
          placeholder="you@example.com"
          required
          autoFocus
          className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
        />
        <p className="text-xs text-zinc-500">
          Enter your email address to receive a login OTP
        </p>
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
          <Label htmlFor="code" className="text-zinc-300">
            Enter OTP
          </Label>
          <Input
            id="code"
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

export default function LoginPage() {
  return (
    <Card className="w-full max-w-md bg-zinc-950 border-zinc-800">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl text-white">Welcome</CardTitle>
        <CardDescription className="text-zinc-400">
          Sign in to Momentum Arena with OTP
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SendOtpForm />
      </CardContent>
    </Card>
  );
}
