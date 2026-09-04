import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const rows = await db.bookingBotLog.findMany({
  orderBy: { createdAt: "desc" }, take: 3,
  select: { text: true, route: true, rejected: true, latencyMs: true, llmResult: true, finalResult: true },
});
for (const r of rows) {
  console.log("—", JSON.stringify(r.text));
  console.log("   route:", JSON.stringify(r.route), "| rejected:", r.rejected, "| ms:", r.latencyMs);
  const l = typeof r.llmResult === "string" ? r.llmResult : JSON.stringify(r.llmResult);
  console.log("   llm:", l ? l.slice(0,320) : "null");
  const f = r.finalResult;
  if (f) console.log("   final:", JSON.stringify({sport:f.sport,date:f.date,s:f.startHour,e:f.endHour}));
}
await db.$disconnect();
