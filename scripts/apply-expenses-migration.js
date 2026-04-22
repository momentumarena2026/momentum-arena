// One-off: apply prisma/migrations/20260422000000_add_expenses/migration.sql
// directly to the live DB and record it in _prisma_migrations. The baseline
// migration is marked as failed in this project and the team has been
// shipping schema changes via raw SQL + a manual _prisma_migrations insert.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const MIGRATION_NAME = "20260422000000_add_expenses";
const SQL_PATH = path.join(
  __dirname,
  "..",
  "prisma",
  "migrations",
  MIGRATION_NAME,
  "migration.sql"
);

function stripLeadingComments(stmt) {
  // Remove leading "-- ..." comment lines so the remaining body is a real SQL
  // statement the driver can execute.
  return stmt
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
}

async function main() {
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  const p = new PrismaClient();

  // Split on ";" at end of line. Each chunk may still contain leading "--"
  // comments which we strip before executing.
  const rawChunks = sql.split(/;\s*\n/);
  const statements = rawChunks
    .map(stripLeadingComments)
    .filter((s) => s.length > 0);

  // Allow re-running: if we recorded a bad row previously, clear it so we can
  // record a clean one. Will no-op on a fresh run.
  await p.$executeRawUnsafe(
    `DELETE FROM _prisma_migrations WHERE migration_name = $1 AND applied_steps_count = 0`,
    MIGRATION_NAME
  );

  // Idempotency: bail if already fully applied.
  const existing = await p.$queryRawUnsafe(
    `SELECT applied_steps_count FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL`,
    MIGRATION_NAME
  );
  if (existing.length > 0) {
    console.log(
      `[skip] ${MIGRATION_NAME} already applied (${existing[0].applied_steps_count} steps)`
    );
    await p.$disconnect();
    return;
  }

  console.log(
    `[apply] executing ${MIGRATION_NAME} (${statements.length} statements)`
  );

  let applied = 0;
  for (const stmt of statements) {
    try {
      await p.$executeRawUnsafe(stmt);
      applied++;
    } catch (err) {
      // Swallow "already exists" so partial re-runs are tolerated.
      if (err.code === "P2010" && /already exists/i.test(err.message || "")) {
        console.log(`[exists] skipping: ${stmt.slice(0, 60)}…`);
        applied++;
        continue;
      }
      if (
        err.meta &&
        typeof err.meta.message === "string" &&
        /already exists/i.test(err.meta.message)
      ) {
        console.log(`[exists] skipping: ${stmt.slice(0, 60)}…`);
        applied++;
        continue;
      }
      throw err;
    }
  }

  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  const logs = `Applied manually via scripts/apply-expenses-migration.js on ${new Date().toISOString()}`;

  await p.$executeRawUnsafe(
    `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, started_at, applied_steps_count)
     VALUES ($1, $2, NOW(), $3, $4, NOW(), $5)`,
    crypto.randomUUID(),
    checksum,
    MIGRATION_NAME,
    logs,
    applied
  );

  console.log(`[done] applied ${applied} statements and recorded migration`);
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
