import {
  getBookingBotOverview,
  getQuickBookSettingsForAdmin,
} from "@/actions/admin-booking-bot";
import { BookingBotManager } from "./booking-bot-manager";
import { SettingsPanel } from "./settings-panel";
import { LogsPanel } from "./logs-panel";

/**
 * /admin/booking-bot — the review desk for Quick book's learning loop.
 *
 * Quick book reads a customer's sentence with a rule parser first and
 * falls back to a language model only for what the rules cannot read.
 * Every time the model resolves a word our own vocabulary lacked, that
 * word is written down here for a human to accept or throw away.
 *
 * That review is the whole mechanism by which the venue's dependence on
 * a third-party model shrinks: an approved word belongs to the rules
 * afterwards, resolved with no network call, for free, permanently. It
 * is deliberately a decision somebody makes rather than a threshold
 * something crosses, because an unreviewed vocabulary is just the
 * model's mistakes recorded forever — and a wrong mapping would make the
 * RULE parser confidently wrong, with no model call left to blame.
 */
export default async function AdminBookingBotPage() {
  const [{ terms, stats, disagreements }, settings] = await Promise.all([
    getBookingBotOverview(),
    getQuickBookSettingsForAdmin(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Quick Book — Learned Words</h1>
        <p className="mt-1 max-w-3xl text-zinc-400">
          Quick book reads each message with our own rules first, and only asks
          the language model about what the rules could not understand. Words
          the model works out for us are collected below. Approve one and the
          rules own it from then on — no model call, no cost, permanently.
        </p>
      </div>

      <SettingsPanel initial={settings} />

      <BookingBotManager terms={terms} stats={stats} disagreements={disagreements} />

      <LogsPanel />
    </div>
  );
}
