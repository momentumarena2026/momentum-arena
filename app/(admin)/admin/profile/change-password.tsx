"use client";

import { useActionState } from "react";
import { changeSuperadminPassword } from "@/actions/admin-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Reuse changeSuperadminPassword for superadmin, and a generic version for regular admins
// For now both use the same action — regular admins just won't trigger the email notification
// since requireSuperadmin() will block them. We'll add a separate action for regular admins if needed.

export function AdminChangePassword({
  isSuperadmin,
}: {
  isSuperadmin: boolean;
}) {
  const [state, formAction, isPending] = useActionState<
    { error?: string; success?: boolean },
    FormData
  >(changeSuperadminPassword, {});

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="rounded-md bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-400">
          Password changed successfully!
          {isSuperadmin && " Recovery emails have been notified."}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="currentPassword" className="text-zinc-300">
          Current Password
        </Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          className="bg-zinc-900 border-zinc-700 text-white max-w-sm"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="newPassword" className="text-zinc-300">
          New Password
        </Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          placeholder="Min 8 characters"
          required
          className="bg-zinc-900 border-zinc-700 text-white max-w-sm"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword" className="text-zinc-300">
          Confirm New Password
        </Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          className="bg-zinc-900 border-zinc-700 text-white max-w-sm"
        />
      </div>
      <Button
        type="submit"
        disabled={isPending}
        className="bg-red-600 hover:bg-red-700 text-white"
      >
        {isPending ? "Changing..." : "Change Password"}
      </Button>
    </form>
  );
}
