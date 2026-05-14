import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getBowlingMachineSettings } from "@/actions/admin-bowling-machine";
import { BowlingMachineEditor } from "./bowling-machine-editor";

/**
 * /admin/sports/bowling-machine — single page that owns the
 * settings unique to the bowling-machine practice flow:
 *
 *   - which physical half (LEFT vs RIGHT) the machine blocks
 *   - one or more open-hours windows per WEEKDAY / WEEKEND
 *
 * Pricing is intentionally NOT here — it lives on the existing
 * /admin/pricing grid (one row per CourtConfig) alongside the
 * cricket/football/pickleball pricing, so admins keep a single
 * place to edit ₹ per slot.
 */
export default async function AdminBowlingMachinePage() {
  const settings = await getBowlingMachineSettings();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/sports"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Sports
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-white">
          Bowling Machine practice
        </h1>
        <p className="mt-1 text-zinc-400">
          Configure the physical side the machine occupies and the
          open-hours windows when customers can book {`it.`}
          Pricing is in <Link href="/admin/pricing" className="text-emerald-400 hover:text-emerald-300">/admin/pricing</Link>.
        </p>
      </div>

      {settings ? (
        <BowlingMachineEditor settings={settings} />
      ) : (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-200">
          The bowling-machine court config row is missing from the
          database. Re-run the Phase 1 migration or contact engineering.
        </div>
      )}
    </div>
  );
}
