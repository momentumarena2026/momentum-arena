"use client";

import { useActionState } from "react";
import { adminLogin, type AdminLoginState } from "@/actions/admin-auth";
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

export function GodmodeLoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, formAction, isPending] = useActionState<
    AdminLoginState,
    FormData
  >(adminLogin, {});

  return (
    <Card className="w-full max-w-sm bg-zinc-950 border-zinc-800">
      <CardHeader className="text-center">
        <CardTitle className="text-xl text-white">Admin Access</CardTitle>
        <CardDescription className="text-zinc-500 text-xs">
          Authorized personnel only
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          {state.error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
              {state.error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="username" className="text-zinc-300">
              Username
            </Label>
            <Input
              id="username"
              name="username"
              type="text"
              placeholder="Enter username"
              required
              autoFocus
              autoComplete="username"
              className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-zinc-300">
              Password
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="Enter password"
              required
              autoComplete="current-password"
              className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
            />
          </div>
          <Button
            type="submit"
            disabled={isPending}
            className="w-full bg-red-600 hover:bg-red-700 text-white"
          >
            {isPending ? "Authenticating..." : "Enter"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
