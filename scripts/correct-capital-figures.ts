/**
 * Replace the rounded capital figures with what the expense record says.
 *
 * The opening rows were written from round numbers — ₹8,50,000 and
 * ₹5,50,000 — while Expense.doneBy, which is the actual record of who paid
 * for the build-out, says ₹8,49,540 and ₹5,57,135. Nakul's loan was
 * likewise derived as "capex minus a flat ₹21L", which quietly absorbed
 * everyone's odd amounts and credited him with ₹37,960 he never lent — and
 * charged the business 12% a year on it.
 *
 * Decided by the owner on 2026-09-16:
 *   · Nakul's loan is what he actually paid beyond his equity
 *   · Sportive Ventures' own ₹31,285 of capex is shown as company funds,
 *     not as anyone's contribution
 *   · Anand's remaining ₹49,540 stays in; he may draw it later
 *   · Utkarsh transferred his exact shortfall, not a round ₹1.5L
 *
 *   npx tsx scripts/correct-capital-figures.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** From Expense.doneBy, module=GENERAL. These are the source of truth. */
const PAID_CAPEX = {
  Nakul: 3_568_372,
  Anand: 849_540,
  Utkarsh: 557_135,
  "Sportive Ventures": 31_285,
} as const;
const COMMITMENT = 700_000;
const UTKARSH_TOPUP = COMMITMENT - PAID_CAPEX.Utkarsh; // 1,42,865
const NAKUL_LOAN = PAID_CAPEX.Nakul - COMMITMENT; // 28,68,372

async function main() {
  console.log(APPLY ? "APPLYING" : "DRY RUN — pass --apply to write");
  console.log("");

  const rows = await db.capitalContribution.findMany({ orderBy: { name: "asc" } });
  console.log("Before:");
  for (const r of rows) {
    console.log(
      `   ${r.name.padEnd(18)} ${r.kind.padEnd(7)} ₹${r.amount.toLocaleString("en-IN").padStart(12)}  ${r.startDate.toISOString().slice(0, 10)}`,
    );
  }
  console.log("");

  const opening = (name: string) =>
    rows.find(
      (r) => r.name === name && r.kind === "EQUITY" && r.amount > 0 && r.startDate < new Date("2026-08-01"),
    );
  const todays = (name: string) =>
    rows.find(
      (r) => r.name === name && r.kind === "EQUITY" && r.startDate >= new Date("2026-08-01"),
    );

  const plan: string[] = [];
  const anandOpen = opening("Anand");
  const utkOpen = opening("Utkarsh");
  const utkTop = todays("Utkarsh");
  const loan = rows.find((r) => r.kind === "LOAN");
  const company = rows.find((r) => r.kind === "COMPANY");

  if (anandOpen && anandOpen.amount !== PAID_CAPEX.Anand)
    plan.push(`Anand opening   ₹${anandOpen.amount.toLocaleString("en-IN")} → ₹${PAID_CAPEX.Anand.toLocaleString("en-IN")}`);
  if (utkOpen && utkOpen.amount !== PAID_CAPEX.Utkarsh)
    plan.push(`Utkarsh opening ₹${utkOpen.amount.toLocaleString("en-IN")} → ₹${PAID_CAPEX.Utkarsh.toLocaleString("en-IN")}`);
  if (utkTop && utkTop.amount !== UTKARSH_TOPUP)
    plan.push(`Utkarsh top-up  ₹${utkTop.amount.toLocaleString("en-IN")} → ₹${UTKARSH_TOPUP.toLocaleString("en-IN")}`);
  if (loan && loan.amount !== NAKUL_LOAN)
    plan.push(`Nakul loan      ₹${loan.amount.toLocaleString("en-IN")} → ₹${NAKUL_LOAN.toLocaleString("en-IN")}`);
  if (!company)
    plan.push(`Sportive Ventures company funds → ₹${PAID_CAPEX["Sportive Ventures"].toLocaleString("en-IN")} (new row)`);

  if (plan.length === 0) {
    console.log("Already correct — nothing to do.");
    return;
  }
  console.log("Planned:");
  for (const p of plan) console.log(`   ${p}`);
  console.log("");

  if (!APPLY) {
    console.log("DRY RUN — nothing written.");
    return;
  }

  await db.$transaction(async (tx) => {
    if (anandOpen)
      await tx.capitalContribution.update({
        where: { id: anandOpen.id },
        data: {
          amount: PAID_CAPEX.Anand,
          note: "Founder equity, including ₹1,49,540 fronted on Utkarsh's behalf",
        },
      });
    if (utkOpen)
      await tx.capitalContribution.update({
        where: { id: utkOpen.id },
        data: {
          amount: PAID_CAPEX.Utkarsh,
          note: "Founder equity contribution to the build-out (part paid)",
        },
      });
    if (utkTop)
      await tx.capitalContribution.update({
        where: { id: utkTop.id },
        data: {
          amount: UTKARSH_TOPUP,
          note: "Repaid the balance fronted by Anand — equity now complete at ₹7,00,000",
        },
      });
    if (loan)
      await tx.capitalContribution.update({
        where: { id: loan.id },
        data: {
          amount: NAKUL_LOAN,
          note: "Build-out funded beyond his equity, as a founder loan",
        },
      });
    if (!company)
      await tx.capitalContribution.create({
        data: {
          name: "Sportive Ventures",
          kind: "COMPANY",
          amount: PAID_CAPEX["Sportive Ventures"],
          startDate: new Date(Date.UTC(2026, 6, 1)),
          note: "Build-out paid from the business account — not founder capital",
        },
      });
  });

  const after = await db.capitalContribution.findMany({ orderBy: { name: "asc" } });
  const eq = after.filter((r) => r.kind === "EQUITY").reduce((a, r) => a + r.amount, 0);
  const ln = after.filter((r) => r.kind === "LOAN").reduce((a, r) => a + r.amount, 0);
  const co = after.filter((r) => r.kind === "COMPANY").reduce((a, r) => a + r.amount, 0);
  console.log("After:");
  for (const r of after) {
    console.log(
      `   ${r.name.padEnd(18)} ${r.kind.padEnd(7)} ₹${r.amount.toLocaleString("en-IN").padStart(12)}  ${r.startDate.toISOString().slice(0, 10)}`,
    );
  }
  console.log("");
  console.log(`   equity ₹${eq.toLocaleString("en-IN")}  loan ₹${ln.toLocaleString("en-IN")}  company ₹${co.toLocaleString("en-IN")}`);
  console.log(`   funding ₹${(eq + ln + co).toLocaleString("en-IN")}  vs capex ₹50,06,332`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
