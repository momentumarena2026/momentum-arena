// One-off: apply prisma/migrations/20260609010000_cafe_inventory_report_type/migration.sql
// directly to the live DB and record it in _prisma_migrations.
//
// WHY THIS EXISTS: this project's baseline migration is marked failed,
// so `prisma migrate deploy` isn't run in the build pipeline
// (package.json build = `next build`; postinstall = `prisma generate`
// only). Schema changes are shipped via raw SQL + a manual
// _prisma_migrations insert — see scripts/apply-expenses-migration.js,
// the template for this script.
//
// The cafe-inventory report worked locally but the
// "Cafe inventory & sales (monthly)" report could not be queued on
// prod: prisma generate taught the client the new enum value, so the
// POST passed the in-memory VALID_TYPES check, but db.report.create
// then hit Postgres whose ReportType enum was missing the value and
// threw → the row never got created → "nothing happens" on the UI.
//
// Run against prod:  DATABASE_URL=<prod-url> node scripts/apply-cafe-inventory-report-migration.js
//
// NOTE: `ALTER TYPE ... ADD VALUE` runs in its own autocommit
// statement here (via $executeRawUnsafe), which is required —
// Postgres won't let a freshly-added enum value be used inside the
// same transaction it was added in. Each statement here autocommits,
// so the value is immediately usable by the next connection.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const MIGRATION_NAME = "20260609010000_cafe_inventory_report_type";
const SQL_PATH = path.join(
  __dirname,
  "..",
  "prisma",
  "migrations",
  MIGRATION_NAME,
  "migration.sql",
);

function stripLeadingComments(stmt) {
  return stmt
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
}

async function main() {
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  const p = new PrismaClient();

  const rawChunks = sql.split(/;\s*\n/);
  const statements = rawChunks
    .map(stripLeadingComments)
    .filter((s) => s.length > 0);

  // Clear any half-recorded prior attempt so a re-run records cleanly.
  await p.$executeRawUnsafe(
    `DELETE FROM _prisma_migrations WHERE migration_name = $1 AND applied_steps_count = 0`,
    MIGRATION_NAME,
  );

  // Idempotency: bail if already fully applied.
  const existing = await p.$queryRawUnsafe(
    `SELECT applied_steps_count FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL`,
    MIGRATION_NAME,
  );
  if (existing.length > 0) {
    console.log(
      `[skip] ${MIGRATION_NAME} already applied (${existing[0].applied_steps_count} steps)`,
    );
    await p.$disconnect();
    return;
  }

  console.log(
    `[apply] executing ${MIGRATION_NAME} (${statements.length} statements)`,
  );

  let applied = 0;
  for (const stmt of statements) {
    try {
      await p.$executeRawUnsafe(stmt);
      applied++;
    } catch (err) {
      // The migration uses `ADD VALUE IF NOT EXISTS`, so a re-run is a
      // no-op; also tolerate any "already exists" surfaced as P2010.
      const msg = err?.meta?.message || err?.message || "";
      if (/already exists/i.test(msg)) {
        console.log(`[exists] skipping: ${stmt.slice(0, 60)}…`);
        applied++;
        continue;
      }
      throw err;
    }
  }

  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  const logs = `Applied manually via scripts/apply-cafe-inventory-report-migration.js on ${new Date().toISOString()}`;

  await p.$executeRawUnsafe(
    `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count)
     VALUES ($1, $2, NOW(), $3, $4, NOW(), $5)`,
    crypto.randomUUID(),
    checksum,
    MIGRATION_NAME,
    logs,
    applied,
  );

  console.log(`[done] applied ${applied} statements and recorded migration`);
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
