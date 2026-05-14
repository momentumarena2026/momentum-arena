import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password";
import { ALL_PERMISSIONS } from "../lib/permissions";

const prisma = new PrismaClient();

/**
 * Production seed — runs on every push to `main` via the seed-production
 * workflow, and on every push to `development` via seed-staging.
 *
 * The only thing this script does is upsert the "gamelord" superadmin so
 * there's always a login that can reach /admin. The update branch refreshes
 * `permissions` to the current `ALL_PERMISSIONS` export, so newly-added
 * permission constants are auto-granted to the superadmin without a manual
 * intervention each release.
 *
 * Everything else (court configs, time classifications, pricing rules,
 * coupons, FAQs, court-deactivations, NEWUSER state) used to live here as
 * `upsert(..., update: { … })` blocks. The update branches silently
 * clobbered admin edits on every deploy — most visibly, bowling-machine
 * pricing kept resetting from ₹250 back to the hardcoded SHARED defaults
 * (₹400/₹600) until we pulled those blocks out. All of that data is now
 * admin-managed via the /admin/* surfaces and bootstrapped manually on a
 * fresh DB (or restored from a snapshot).
 */
async function main() {
  const superadminPassword = await hashPassword("burninhell@26");
  await prisma.adminUser.upsert({
    where: { username: "gamelord" },
    update: {
      permissions: [...ALL_PERMISSIONS],
    },
    create: {
      username: "gamelord",
      email: "y12.nakul@gmail.com",
      passwordHash: superadminPassword,
      role: "SUPERADMIN",
      permissions: [...ALL_PERMISSIONS],
      isDeletable: false,
    },
  });
  console.log("Seeded superadmin user: gamelord");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
