/**
 * What is actually going on with one challenge — read-only.
 *
 * Written because the admin board shows a STATUS and a status is a summary:
 * "agreed" is true and also says nothing about whether anyone has paid,
 * whether a court is held, or when it dies. Those are the three questions
 * anybody asks next, and answering them meant three separate queries by
 * hand against production.
 *
 * TEAM: any part of the team name, or a challenge id.
 */
import { db } from "../lib/db";

function ist(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d.getTime() + 5.5 * 3600_000).toISOString().replace("T", " ").slice(0, 16) + " IST";
}

async function main() {
  const q = (process.env.TEAM ?? "").trim();
  if (!q) throw new Error("Pass TEAM=<name fragment or challenge id>");
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "unknown";
  console.log(`database host: ${host}`);

  const rows = await db.challenge.findMany({
    where: { OR: [{ id: q }, { teamName: { contains: q, mode: "insensitive" } }] },
    select: {
      id: true, teamName: true, sport: true, status: true, playerCount: true,
      createdAt: true, expiresAt: true, announcedAt: true, bookingId: true,
      agreedWindowId: true,
      createdBy: { select: { name: true, phone: true } },
      acceptedBy: { select: { name: true, phone: true } },
      windows: {
        select: { id: true, date: true, startHour: true, endHour: true, status: true, proposedBy: true },
        orderBy: [{ date: "asc" }, { startHour: "asc" }],
      },
      payments: {
        select: {
          side: true, amount: true, createdAt: true, paidAt: true, placedAt: true,
          refundOwedAt: true, refundedAt: true,
          razorpayOrderId: true, phonePeMerchantTxnId: true,
          user: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  if (rows.length === 0) { console.log("no challenge matches that"); await db.$disconnect(); return; }

  const win = (await db.challengeSettings.findFirst({ select: { paymentWindowMins: true } }))?.paymentWindowMins ?? 120;

  for (const c of rows) {
    console.log("");
    console.log("─".repeat(70));
    console.log(`${c.teamName ?? "(no team name)"}  [${c.status}]  ${c.sport} · ${c.playerCount} players`);
    console.log(`  id            ${c.id}`);
    console.log(`  poster        ${c.createdBy?.name ?? "?"} ${c.createdBy?.phone ?? ""}`);
    console.log(`  taker         ${c.acceptedBy ? `${c.acceptedBy.name} ${c.acceptedBy.phone}` : "nobody"}`);
    console.log(`  posted        ${ist(c.createdAt)}`);
    console.log(`  expires       ${ist(c.expiresAt)}${c.expiresAt < new Date() ? "   <-- PAST" : ""}`);
    console.log(`  booking       ${c.bookingId ?? "none — NO COURT IS HELD"}`);

    console.log(`  times:`);
    for (const w of c.windows) {
      const agreed = w.id === c.agreedWindowId ? "  <-- the agreed time" : "";
      console.log(`     ${w.date.toISOString().slice(0,10)} ${w.startHour}:00-${w.endHour}:00  ${w.status.padEnd(10)} by ${w.proposedBy}${agreed}`);
    }

    console.log(`  money:`);
    if (c.payments.length === 0) {
      console.log(`     nothing. No slot opened, no money started, nothing owed.`);
    }
    for (const p of c.payments) {
      const holdEnds = new Date(p.createdAt.getTime() + win * 60000);
      const live = !p.paidAt && holdEnds > new Date();
      console.log(
        `     ${p.side.padEnd(10)} ₹${String(p.amount).padEnd(5)} ${p.user?.name ?? "?"}\n` +
        `        opened  ${ist(p.createdAt)}   ${live ? `HOLDS THE SLOT until ${ist(holdEnds)}` : "hold lapsed"}\n` +
        `        paid    ${p.paidAt ? ist(p.paidAt) : "NOT PAID"}\n` +
        `        placed  ${p.placedAt ? ist(p.placedAt) : "—"}\n` +
        `        refund  ${p.refundOwedAt ? `OWED since ${ist(p.refundOwedAt)}${p.refundedAt ? ` · refunded ${ist(p.refundedAt)}` : " · NOT YET RETURNED"}` : "—"}\n` +
        `        via     ${p.phonePeMerchantTxnId ? `UPI ${p.phonePeMerchantTxnId}` : p.razorpayOrderId ? `card ${p.razorpayOrderId}` : "no instrument yet"}`,
      );
    }

    // The sentence somebody actually wants.
    const paid = c.payments.filter((p) => p.paidAt && !p.refundOwedAt);
    // THE STORY, oldest first. The status says where a challenge is; only
    // the event log says how it got there — and "how did this reach AGREED
    // with no money in it" is a question that has now been asked twice,
    // each time answerable only by reading source instead of records.
    const events = await db.challengeEvent.findMany({
      where: { challengeId: c.id },
      select: { type: true, detail: true, createdAt: true, user: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    console.log(`  history (${events.length} events):`);
    for (const e of events) {
      // The telemetry types are noise in a diagnosis; the ones that MOVED
      // something are the answer.
      const noisy = ["HOME_CARD_SHOWN", "HOME_CARD_TAPPED", "BOARD_VIEWED", "DETAIL_VIEWED", "POST_OPENED", "COUNTER_OPENED"];
      if (noisy.includes(e.type)) continue;
      console.log(
        `     ${ist(e.createdAt)}  ${e.type.padEnd(17)} ${(e.user?.name ?? "—").padEnd(18)} ${e.detail ?? ""}`,
      );
    }

    console.log(`  READING:`);
    if (c.status === "AGREED") {
      console.log(`     A time is settled and ${paid.length === 0 ? "NEITHER side has paid" : `${paid.length} side(s) have paid`}.`);
      console.log(`     No court is held and none is blocked — by design. The hour stays`);
      console.log(`     on sale until BOTH halves are in, so a walk-in can still take it.`);
      // The question this line answers has now been asked twice.
      console.log(`     BUT: AGREED also takes it OFF the board, because the board lists`);
      console.log(`     OPEN and COUNTERED only. So nobody can find it to pay for it.`);
      console.log(`     No route to this state survives: the free accept was closed on`);
      console.log(`     2026-09-23 and suggesting a time stopped claiming the acceptor`);
      console.log(`     slot the same day. Check the ACCEPTED/COUNTERED timestamps above`);
      console.log(`     against that date — a row dated after it is a real bug.`);
      if (paid.length === 0) {
        console.log(`     Nothing is owed to anybody. If neither pays by ${ist(c.expiresAt)}`);
        console.log(`     the sweep marks it EXPIRED and it leaves the board.`);
      }
    }
  }
  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await db.$disconnect().catch(() => undefined); process.exit(1); });
