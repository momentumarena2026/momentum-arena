import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getGeneratorOilChangeStatus } from "@/actions/generator";
import { sendOilChangeReminder } from "@/lib/generator-notifications";
import { formatPrice } from "@/lib/pricing";

export async function GET(request: Request) {
  // Verify cron secret for security
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const generators = await db.generator.findMany({
    where: { isActive: true },
  });

  const results: Array<{
    generator: string;
    alertSent: boolean;
    hoursRemaining?: number;
  }> = [];

  for (const gen of generators) {
    const status = await getGeneratorOilChangeStatus(gen.id);
    if (!status) continue;

    const { config, totalRunningHours, hoursUntilOilChange, totalOilChanges, nextOilChangeAt, lastOilChange } =
      status;

    // Check if alert should be sent
    if (hoursUntilOilChange <= config.oilChangeAlertHours && hoursUntilOilChange > 0) {
      // Check if we already sent an alert for this oil change number
      // Use a simple heuristic: if the last oil change sequence number matches
      // totalOilChanges, we haven't done the next one yet — check if we already alerted.
      // We track this by checking if an alert was sent recently (within 24 hours)
      // for this generator by looking at run logs with a special note.
      const recentAlert = await db.generatorRunLog.findFirst({
        where: {
          generatorId: gen.id,
          notes: `oil_change_alert_${totalOilChanges + 1}`,
        },
      });

      if (!recentAlert) {
        const estimatedOilCost = formatPrice(config.oilPricePerLitre / 100);
        const lastOilChangeDate = lastOilChange
          ? new Date(lastOilChange.date).toLocaleDateString("en-IN", {
              timeZone: "Asia/Kolkata",
            })
          : "N/A";

        const sent = await sendOilChangeReminder({
          generatorName: gen.name,
          hoursRemaining: hoursUntilOilChange,
          totalHours: totalRunningHours,
          nextChangeAt: nextOilChangeAt,
          lastOilChangeDate,
          oilChangeNumber: totalOilChanges + 1,
          estimatedOilCost,
        });

        if (sent) {
          // Record that we sent an alert so we don't re-send
          await db.generatorRunLog.create({
            data: {
              generatorId: gen.id,
              startTime: new Date(),
              endTime: new Date(),
              durationHours: 0,
              notes: `oil_change_alert_${totalOilChanges + 1}`,
            },
          });
        }

        results.push({
          generator: gen.name,
          alertSent: sent,
          hoursRemaining: hoursUntilOilChange,
        });
      } else {
        results.push({
          generator: gen.name,
          alertSent: false,
          hoursRemaining: hoursUntilOilChange,
        });
      }
    } else {
      results.push({
        generator: gen.name,
        alertSent: false,
        hoursRemaining: hoursUntilOilChange,
      });
    }
  }

  return NextResponse.json({
    checked: generators.length,
    results,
    timestamp: new Date().toISOString(),
  });
}
