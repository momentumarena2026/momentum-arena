import { RecoveryClient } from "./recovery-client";

export const dynamic = "force-dynamic";

/**
 * /admin/bookings/recovery — admin tool for reconstructing a Booking
 * when the customer's payment captured but our DB has no Booking row
 * (typical cause: customer's client-side /api/razorpay/verify call
 * dropped after Razorpay redirected back). Paste the Razorpay
 * `pay_…` ID, we fetch it from Razorpay, locate the matching
 * SlotHold by `razorpayOrderId`, and create the Booking via the
 * same `createBookingFromHold` path the verify route + webhook use.
 *
 * The new `/api/razorpay/webhook` endpoint covers future payments
 * server-to-server, so this tool's primary use is reconciling
 * historical orphans + emergencies.
 */
export default function RecoveryPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Razorpay payment recovery
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Reconstruct a booking when the customer&apos;s payment captured but no
          Booking row exists in the DB.
        </p>
      </div>

      <RecoveryClient />

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-400 space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          When to use this
        </h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Customer paid via Razorpay (modal closed, ₹ debited from their
            account) but the slot still shows &quot;Booked · Notify me&quot;
            on the customer side and no Booking exists in /admin/bookings.
          </li>
          <li>
            Their client-side verify call likely dropped — the new webhook
            endpoint at <code className="text-emerald-400">/api/razorpay/webhook</code>{" "}
            covers future payments server-to-server, but you can still
            recover any historical orphans here.
          </li>
          <li>
            Grab the <code className="text-emerald-400">pay_…</code> id from
            the Razorpay dashboard&apos;s Payments tab — the column labelled
            &quot;Payment ID&quot;.
          </li>
        </ul>
      </div>
    </div>
  );
}
