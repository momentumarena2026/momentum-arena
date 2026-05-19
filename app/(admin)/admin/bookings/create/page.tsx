import { db } from "@/lib/db";
import { CreateBookingForm } from "@/components/admin/create-booking-form";
import { getActiveSportPromo } from "@/actions/sport-promo";

export default async function CreateBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ courtConfigId?: string; date?: string; hour?: string }>;
}) {
  const params = await searchParams;
  const [courtConfigs, pickleballPromo] = await Promise.all([
    db.courtConfig.findMany({
      where: { isActive: true },
      orderBy: [{ sport: "asc" }, { size: "asc" }],
    }),
    // Drives the optional "Apply 25% PICKLEBALL25" checkbox in the
    // form. When admin disables / expires the coupon in
    // /admin/coupons, this returns null on the next request and the
    // checkbox disappears with no extra wiring.
    getActiveSportPromo("PICKLEBALL").catch(() => null),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Create Booking</h1>
      <p className="text-zinc-400">Book a court on behalf of a customer</p>
      <CreateBookingForm
        courtConfigs={courtConfigs}
        prefillCourtConfigId={params.courtConfigId}
        prefillDate={params.date}
        prefillHour={params.hour ? parseInt(params.hour, 10) : undefined}
        pickleballPromo={pickleballPromo}
      />
    </div>
  );
}
