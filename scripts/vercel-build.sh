#!/usr/bin/env bash
# Vercel build — schema-atomic deploys.
#
# Runs the pre-db-push cleanup + `prisma db push` BEFORE `next build`, so a
# deployment can never go live against a database that's missing its columns
# (the P2022 class of crash from 2026-07-02, when the push-triggered seed
# workflow was accidentally skipped by a "[skip ci]" token in a commit body).
#
# Fail-closed: `set -e` means a failed cleanup/db-push fails the whole build
# and the previous deployment keeps serving with its matching schema.
#
# The DB steps only run on Vercel ($VERCEL is set by the platform):
#  - Preview  (development branch) → DATABASE_URL = staging DB
#  - Production (main branch)      → DATABASE_URL = production DB
# Local `npm run build` skips them, so a local build never touches a DB.
#
# The seed-staging/seed-production workflows still exist (path-filtered to
# prisma/**): they own seeding (prisma/seed.ts) and act as belt-and-suspenders
# for the schema sync. `prisma db push` is idempotent — both running is fine.

set -euo pipefail

if [ -n "${VERCEL:-}" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "✗ vercel-build: DATABASE_URL is not available at build time." >&2
    echo "  Schema sync cannot run — failing the build rather than deploying" >&2
    echo "  code that may not match the database schema." >&2
    exit 1
  fi

  echo "→ vercel-build: pre-db-push cleanup (idempotent)"
  npx prisma db execute \
    --file ./prisma/scripts/pre-db-push-cleanup.sql \
    --schema ./prisma/schema.prisma

  echo "→ vercel-build: prisma db push (schema sync before code goes live)"
  npx prisma db push --accept-data-loss --skip-generate
else
  echo "→ vercel-build: not on Vercel — skipping DB sync (local build)"
fi

echo "→ vercel-build: next build"
npx next build
