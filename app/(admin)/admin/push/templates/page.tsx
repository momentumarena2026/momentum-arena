import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listPushTemplates } from "@/actions/admin-push";
import { TemplatesClient } from "./templates-client";

export default async function AutomatedPushTemplatesPage() {
  const templates = await listPushTemplates();

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <Link
          href="/admin/push"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Push Notifications
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-white tracking-tight">
          Automated Push Messages
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every automated push the product sends. Edit the copy, toggle any
          message off, and use the variables listed per message — they&apos;re
          filled in at send time.
        </p>
      </div>

      <TemplatesClient templates={templates} />
    </div>
  );
}
