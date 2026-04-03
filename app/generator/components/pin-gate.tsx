"use client";

import { useState, useRef } from "react";
import { Fuel, Loader2, Lock } from "lucide-react";

export function PinGate({
  children,
  verified,
}: {
  children: React.ReactNode;
  verified: boolean;
}) {
  const [show, setShow] = useState(!verified);
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  if (!show) return <>{children}</>;

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newDigits = [...digits];
    newDigits[index] = value.slice(-1);
    setDigits(newDigits);
    setError("");

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits are entered
    if (newDigits.every((d) => d !== "")) {
      submitPin(newDigits.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      const newDigits = pasted.split("");
      setDigits(newDigits);
      submitPin(pasted);
    }
  };

  const submitPin = async (pin: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/generator/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        setShow(false);
      } else {
        setError("Incorrect PIN");
        setDigits(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
      }
    } catch {
      setError("Connection error");
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-900 border border-zinc-800">
            <Lock className="h-7 w-7 text-emerald-500" />
          </div>
          <h1 className="text-xl font-bold text-white">Enter Access PIN</h1>
          <p className="mt-1 text-sm text-zinc-500">
            6-digit PIN required to access generator controls
          </p>
        </div>

        <div className="flex justify-center gap-2" onPaste={handlePaste}>
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="tel"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className="h-14 w-11 rounded-lg border border-zinc-700 bg-zinc-900 text-center text-xl font-bold text-white focus:border-emerald-500 focus:outline-none"
              autoFocus={i === 0}
            />
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verifying...
          </div>
        )}

        {error && (
          <p className="text-sm font-medium text-red-400">{error}</p>
        )}

        <div className="flex items-center justify-center gap-2 text-xs text-zinc-600">
          <Fuel className="h-3 w-3" />
          Momentum Arena Generator
        </div>
      </div>
    </div>
  );
}
