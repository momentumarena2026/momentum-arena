import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDailyPushLibrary } from "@/actions/admin-daily-push";
import { LinesClient } from "./lines-client";

export const dynamic = "force-dynamic";

export default async function DailyPushLinesPage() {
  const view = await getDailyPushLibrary();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 pb-24 sm:px-6">
      <div>
        <Link
          href="/admin/push/daily"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Daily push
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">The line library</h1>
        <p className="mt-1 text-sm text-zinc-500">
          What the daily push says to everyone no personal rule matched. One line
          a day, least recently used first, so the whole library goes out before
          anything repeats.
        </p>
      </div>

      <LinesClient view={JSON.parse(JSON.stringify(view))} />
    </div>
  );
}
