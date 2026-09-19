import { db } from "@/lib/db";
(async () => {
  const r = await db.challengePayment.findMany({ take: 5 });
  console.log("findMany ok", r.length, JSON.stringify(r[0] ?? null));
  if (r[0]) {
    try {
      const u = await db.challengePayment.update({ where: { id: r[0].id }, data: { razorpayOrderId: r[0].razorpayOrderId ?? "order_dbg" } });
      console.log("update ok", u.id);
    } catch (e: any) { console.log("update FAILED", e.code, e.message.slice(0, 400)); }
  }
  process.exit(0);
})();
