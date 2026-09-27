import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDailyPushAdminView } from "@/actions/admin-daily-push";
import { DailyPushClient } from "./daily-client";

export const dynamic = "force-dynamic";

export default async function DailyPushPage() {
  const view = await getDailyPushAdminView();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/admin/push"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Push Notifications
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-white tracking-tight">Daily push</h1>
        <p className="mt-1 text-sm text-zinc-500">
          The one message the arena sends that nobody asked for. Every other push
          happens because something happened to that customer; this one goes out
          because it is evening and there is something worth saying. Each person
          gets the first rule below that is true for them — and nothing at all if
          none of them is.
        </p>
      </div>

      <DailyPushClient view={JSON.parse(JSON.stringify(view))} />
    </div>
  );
}
