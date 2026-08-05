"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Globe, EyeOff } from "lucide-react";
import { setCampsEnabled } from "@/actions/admin-camps";

/** Master switch: shows/hides the whole customer-facing camps module
 *  (web /camps + the app's entry). Admin management keeps working while
 *  OFF so a camp can be staged before it goes on sale. */
export function CampsModuleToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      await setCampsEnabled(!enabled);
      setEnabled(!enabled);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium disabled:opacity-50 ${
        enabled
          ? "border-emerald-500/30 bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600/20"
          : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
      }`}
      title="Controls the public /camps pages and the app's camps entry. Admin screens stay available either way."
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : enabled ? (
        <Globe className="h-4 w-4" />
      ) : (
        <EyeOff className="h-4 w-4" />
      )}
      {enabled ? "Module LIVE for customers" : "Module hidden from customers"}
    </button>
  );
}
