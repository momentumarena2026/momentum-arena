import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

interface BulkEntry {
  id: number;
  time: string; // "2026-04-05 10:32:21"
  status: "ON" | "OFF";
}

export async function POST(req: NextRequest) {
  try {
    // ── Auth via x-api-key ──────────────────────────────────
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing x-api-key header" },
        { status: 401 }
      );
    }

    let config = await db.generatorConfig.findFirst();
    if (!config) {
      config = await db.generatorConfig.create({ data: {} });
    }

    if (apiKey !== config.hardwareApiKey) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 403 }
      );
    }

    // ── Parse body ──────────────────────────────────────────
    const body = await req.json();
    const { data, generator_id } = body as {
      data: BulkEntry[];
      generator_id: string;
    };

    if (!generator_id || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json(
        { error: "Invalid payload: requires generator_id and data array" },
        { status: 400 }
      );
    }

    // Verify generator exists
    const generator = await db.generator.findUnique({
      where: { id: generator_id },
    });
    if (!generator || !generator.isActive) {
      return NextResponse.json(
        { error: `Generator '${generator_id}' not found` },
        { status: 404 }
      );
    }

    // ── Sort entries by time, then process sequentially ─────
    const sorted = [...data].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
    );

    let processed = 0;

    for (const entry of sorted) {
      const entryTime = new Date(entry.time);
      if (isNaN(entryTime.getTime())) continue;

      if (entry.status === "ON") {
        // Start a new run log (only if no active run already)
        const activeRun = await db.generatorRunLog.findFirst({
          where: { generatorId: generator_id, endTime: null },
          orderBy: { startTime: "desc" },
        });

        if (!activeRun) {
          await db.generatorRunLog.create({
            data: {
              generatorId: generator_id,
              startTime: entryTime,
              notes: `Hardware device (entry #${entry.id})`,
            },
          });
          processed++;
        }
      } else if (entry.status === "OFF") {
        // Stop the active run log
        const activeRun = await db.generatorRunLog.findFirst({
          where: { generatorId: generator_id, endTime: null },
          orderBy: { startTime: "desc" },
        });

        if (activeRun) {
          const durationMs =
            entryTime.getTime() - activeRun.startTime.getTime();
          const durationHours = Math.max(0, durationMs / (1000 * 60 * 60));

          await db.generatorRunLog.update({
            where: { id: activeRun.id },
            data: {
              endTime: entryTime,
              durationHours: Math.round(durationHours * 100) / 100,
            },
          });
          processed++;
        }
      }
    }

    return NextResponse.json({ status: "ok", processed });
  } catch (e) {
    console.error("bulk-log error:", e);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
