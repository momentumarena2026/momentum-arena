import Link from "next/link";
import { Copy } from "lucide-react";
import { getTournamentForDuplicate } from "@/actions/admin-tournaments";
import { TournamentWizard } from "../tournament-wizard";

/**
 * New tournament — blank, or prefilled from an existing one via `?from=<id>`.
 *
 * Duplication reuses this page rather than adding a parallel create route, so
 * there is exactly one path that builds a tournament. The wizard already
 * branches on `initial.id`: present means edit, absent means create. Passing a
 * prefilled payload with no id therefore lands in createTournament with all
 * its existing validation, slug-uniqueness loop and campaign drafting intact.
 */
export default async function NewTournamentPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const from = (await searchParams).from;
  // A bad or stale id falls through to a blank wizard with a note rather than
  // erroring — the admin still gets to create something, which is what they
  // came here to do.
  const initial = from ? await getTournamentForDuplicate(from) : null;
  const duplicating = Boolean(initial);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">
          {duplicating ? "Duplicate Tournament" : "New Tournament"}
        </h1>
        {duplicating ? (
          <p className="mt-1 text-zinc-400">
            Every setting has been copied across. The dates are intentionally
            blank — fill them in for this edition. Nothing is created until you
            submit, and the original is untouched.
          </p>
        ) : (
          <p className="mt-1 text-zinc-400">
            Everything is editable later from the tournament&apos;s Settings tab.
          </p>
        )}
      </div>

      {duplicating && (
        <div className="flex items-start gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 text-sm">
          <Copy className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          <div className="text-zinc-300">
            <p className="font-medium text-sky-300">Copied as a new draft</p>
            <p className="mt-1 text-zinc-400">
              Teams, fixtures, pools, match slots and scores are{" "}
              <span className="text-zinc-300">not</span> carried over, and a new
              scorer code is issued if live scoring is on. Set the dates, adjust
              the entry fee and prizes, then create.
            </p>
          </div>
        </div>
      )}

      {from && !initial && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">
          That tournament could not be found, so this is a blank form.{" "}
          <Link href="/admin/tournaments" className="underline">
            Back to tournaments
          </Link>
        </div>
      )}

      <TournamentWizard initial={initial ?? undefined} />
    </div>
  );
}
