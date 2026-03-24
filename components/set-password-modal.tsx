"use client";

import { useActionState, useState, useEffect, useCallback } from "react";
import { setPassword, type SetPasswordState } from "@/actions/auth";
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

export function SetPasswordModal() {
  const [isOpen, setIsOpen] = useState(true);
  const [state, formAction, isPending] = useActionState<
    SetPasswordState,
    FormData
  >(setPassword, {});

  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setIsOpen(false);
  }, []);

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

  if (!isOpen || state.success) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
      <div className="relative z-10 w-full max-w-md">
        <Card className="w-full bg-zinc-950 border-zinc-800">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl text-white">
              Set Your Password
            </CardTitle>
            <CardDescription className="text-zinc-400">
              Set a password for faster login next time. You can always skip
              this.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="space-y-4">
              {state.error && (
                <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
                  {state.error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="sp-password" className="text-zinc-300">
                  Password
                </Label>
                <Input
                  id="sp-password"
                  name="password"
                  type="password"
                  placeholder="Min 10 chars, letters, numbers & special"
                  required
                  autoFocus
                  className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sp-confirm" className="text-zinc-300">
                  Confirm Password
                </Label>
                <Input
                  id="sp-confirm"
                  name="confirmPassword"
                  type="password"
                  placeholder="Confirm your password"
                  required
                  className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
                />
              </div>
              <Button
                type="submit"
                disabled={isPending}
                className="w-full bg-green-600 hover:bg-green-700 text-white"
              >
                {isPending ? "Setting password..." : "Set Password"}
              </Button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors w-full text-center"
              >
                Skip for now
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
