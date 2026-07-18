import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const cfg = await db.paymentGatewayConfig.findMany();
  console.log("=== PaymentGatewayConfig ===");
  console.log(JSON.stringify(cfg, null, 2));

  console.log("\n=== SlotHold: DQR txn + paymentInitiatedAt, recent 25 ===");
  const holds = await db.slotHold.findMany({
    where: { phonePeMerchantTxnId: { startsWith: "DQR" } },
    select: {
      id: true,
      userId: true,
      phonePeMerchantTxnId: true,
      paymentInitiatedAt: true,
      paymentMethod: true,
      paymentAmount: true,
      totalAmount: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  const txns = holds.map((h) => h.phonePeMerchantTxnId!).filter(Boolean);
  const pays = await db.payment.findMany({
    where: { phonePeMerchantTxnId: { in: txns } },
    select: { phonePeMerchantTxnId: true, bookingId: true, status: true, amount: true },
  });
  const paid = new Set(pays.map((p) => p.phonePeMerchantTxnId));
  for (const h of holds) {
    console.log(
      `${h.phonePeMerchantTxnId} initiated=${h.paymentInitiatedAt?.toISOString() ?? "-"} amt=${h.paymentAmount} method=${h.paymentMethod} booking=${paid.has(h.phonePeMerchantTxnId) ? "YES" : "NO"}`,
    );
  }

  console.log("\n=== Payment rows method=UPI_QR / confirmedBy PHONEPE_DQR (recent 20) ===");
  const p2 = await db.payment.findMany({
    where: { OR: [{ method: "UPI_QR" }, { confirmedBy: "PHONEPE_DQR" }] },
    select: {
      id: true, method: true, confirmedBy: true, status: true, amount: true,
      phonePeMerchantTxnId: true, phonePeTransactionId: true, bookingId: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  console.log(JSON.stringify(p2, null, 2));

  console.log("\n=== ServerActionLog: payment.orphan / dqr actions (recent 30) ===");
  try {
    const logs = await (db as any).serverActionLog.findMany({
      where: { action: { contains: "orphan" } },
      orderBy: { occurredAt: "desc" },
      take: 30,
    });
    console.log(JSON.stringify(logs, null, 2));
    const dqrLogs = await (db as any).serverActionLog.findMany({
      where: { action: { startsWith: "payment.dqr" } },
      orderBy: { occurredAt: "desc" },
      take: 30,
      select: { action: true, outcome: true, occurredAt: true, metadata: true, error: true },
    });
    console.log("\n--- payment.dqr.* ---");
    console.log(JSON.stringify(dqrLogs, null, 2));
  } catch (e) {
    console.log("serverActionLog query failed:", (e as Error).message);
  }

  console.log("\n=== PassPurchaseIntent (recent 20) ===");
  try {
    const pi = await (db as any).passPurchaseIntent.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, planId: true, userId: true, phonePeMerchantTxnId: true, consumedUserPassId: true, createdAt: true },
    });
    console.log(JSON.stringify(pi, null, 2));
  } catch (e) {
    console.log("passPurchaseIntent query failed:", (e as Error).message);
  }
}

main()
  .catch((e) => console.error("PROBE ERROR", e))
  .finally(() => db.$disconnect());
