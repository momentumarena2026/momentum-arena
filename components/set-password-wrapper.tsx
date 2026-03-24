"use client";

import { useSession } from "next-auth/react";
import { SetPasswordModal } from "@/components/set-password-modal";

export function SetPasswordWrapper() {
  const { data: session } = useSession();

  if (!session?.user?.needsPasswordSetup) return null;

  return <SetPasswordModal />;
}
