"use client";

import { useActionState, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  setupAdminPassword,
  validateInviteToken,
  type AdminSetupState,
} from "@/actions/admin-auth";
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
import Link from "next/link";

export default function SetupPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [username, setUsername] = useState<string | null>(null);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);

  const [state, formAction, isPending] = useActionState<
    AdminSetupState,
    FormData
  >(setupAdminPassword, {});

  useEffect(() => {
    if (token) {
      validateInviteToken(token).then((result) => {
        setTokenValid(result.valid);
        if (result.username) setUsername(result.username);
      });
    } else {
      setTokenValid(false);
    }
  }, [token]);

  if (tokenValid === null) {
    return (
      <Card className="w-full max-w-sm bg-zinc-950 border-zinc-800">
        <CardContent className="p-8 text-center text-zinc-400">
          Validating invite link...
        </CardContent>
      </Card>
    );
  }

  if (!tokenValid) {
    return (
      <Card className="w-full max-w-sm bg-zinc-950 border-zinc-800">
        <CardContent className="p-8 text-center space-y-4">
          <p className="text-red-400">
            This invite link is invalid or has expired.
          </p>
          <Link
            href="/godmode"
            className="text-sm text-zinc-400 hover:text-zinc-300"
          >
            Go to Admin Login
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (state.success) {
    return (
      <Card className="w-full max-w-sm bg-zinc-950 border-zinc-800">
        <CardContent className="p-8 text-center space-y-4">
          <div className="rounded-md bg-green-500/10 border border-green-500/20 p-4 text-sm text-green-400">
            Password set successfully!
          </div>
          <Link href="/godmode">
            <Button className="w-full bg-red-600 hover:bg-red-700 text-white">
              Go to Admin Login
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm bg-zinc-950 border-zinc-800">
      <CardHeader className="text-center">
        <CardTitle className="text-xl text-white">Set Your Password</CardTitle>
        <CardDescription className="text-zinc-400">
          Welcome{username ? `, ${username}` : ""}! Set your admin password to
          get started.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
              {state.error}
            </div>
          )}
          <input type="hidden" name="token" value={token} />
          <div className="space-y-2">
            <Label htmlFor="as-password" className="text-zinc-300">
              Password
            </Label>
            <Input
              id="as-password"
              name="password"
              type="password"
              placeholder="Min 8 characters"
              required
              autoFocus
              className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="as-confirm" className="text-zinc-300">
              Confirm Password
            </Label>
            <Input
              id="as-confirm"
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
            className="w-full bg-red-600 hover:bg-red-700 text-white"
          >
            {isPending ? "Setting password..." : "Set Password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
