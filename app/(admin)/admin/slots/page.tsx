import { db } from "@/lib/db";
import { SPORT_INFO, formatHour, getAllSlotHours } from "@/lib/court-config";
import { SlotBlockManager } from "./slot-block-manager";

export default async function AdminSlotsPage() {
  const configs = await db.courtConfig.findMany({
    orderBy: [{ sport: "asc" }, { size: "asc" }],
  });

  const today = new Date().toISOString().split("T")[0];

  const blocks = await db.slotBlock.findMany({
    where: {
      date: { gte: new Date(today) },
    },
    include: { courtConfig: true },
    orderBy: [{ date: "asc" }, { startHour: "asc" }],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Slot Blocks</h1>
        <p className="mt-1 text-zinc-400">
          Block slots for maintenance, private events, or unavailability
        </p>
      </div>

      <SlotBlockManager
        configs={configs.map((c) => ({
          id: c.id,
          sport: c.sport,
          label: c.label,
          size: c.size,
        }))}
        existingBlocks={blocks.map((b) => ({
          id: b.id,
          date: b.date.toISOString().split("T")[0],
          startHour: b.startHour,
          reason: b.reason,
          sport: b.sport,
          configLabel: b.courtConfig?.label || (b.sport ? `All ${b.sport}` : "All Courts"),
        }))}
      />
    </div>
  );
}
