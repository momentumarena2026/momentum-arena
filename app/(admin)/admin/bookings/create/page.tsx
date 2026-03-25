import { db } from "@/lib/db";
import { CreateBookingForm } from "@/components/admin/create-booking-form";

export default async function CreateBookingPage() {
  const courtConfigs = await db.courtConfig.findMany({
    where: { isActive: true },
    orderBy: [{ sport: "asc" }, { size: "asc" }],
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Create Booking</h1>
      <p className="text-zinc-400">Book a court on behalf of a customer</p>
      <CreateBookingForm courtConfigs={courtConfigs} />
    </div>
  );
}
