#!/usr/bin/env bash
# Vercel ignoreCommand — wired up via vercel.json.
#
# Two-stage gate:
#   1. Branch allowlist. Only `main` (production) and `development`
#      (preview) ever produce a Vercel deploy. Every other branch —
#      claude/* feature branches, mobile-only side branches,
#      experimental forks — is skipped at the top so Vercel doesn't
#      burn build minutes on previews nobody asked for.
#   2. Path filter. On the allowlisted branches, we still skip the
#      Next.js web build when the diff lives entirely under
#      apps/mobile/ (the React Native workspace). Anything outside
#      apps/mobile/ — server actions, API routes, web pages, prisma
#      schema, vercel.json itself — triggers a normal build.
#
# Vercel semantics:
#   exit 0  → ignore (skip) the build
#   exit 1  → proceed with the build
#
# We diff against VERCEL_GIT_PREVIOUS_SHA (the SHA of the previous
# successful production build) when Vercel provides it; otherwise fall
# back to the immediate parent commit. If git itself errors out (e.g.
# shallow clone missing the parent), we play it safe and let the build
# run.

set -u

# Stage 1: branch allowlist. VERCEL_GIT_COMMIT_REF is the branch being
# deployed (set by Vercel for git-driven builds). Empty / unset means
# we're outside Vercel's deploy environment — fall through to the diff
# check rather than refusing every local invocation.
BRANCH="${VERCEL_GIT_COMMIT_REF:-}"
case "$BRANCH" in
  main|development|"")
    # Allowed (or local invocation). Continue to the path filter.
    ;;
  *)
    echo "↪ Branch '$BRANCH' is not on the deploy allowlist (main, development) — skipping build."
    exit 0
    ;;
esac

PREV="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"

# `:(exclude)apps/mobile/` is git's pathspec for "everything except this
# path". `--quiet` returns:
#   0 → no diff outside apps/mobile/  (skip)
#   1 → diff outside apps/mobile/     (build)
#   * → unexpected (treat as build for safety)
#
# We can't infer git's exit code from `if git diff…; then` because bash
# resets $? to the if-statement's own exit code (always 0) once the
# block ends, so we capture the code via the `|| status=$?` idiom.
status=0
git diff --quiet "$PREV" HEAD -- ':(exclude)apps/mobile/' || status=$?

case "$status" in
  0)
    echo "↪ Only apps/mobile/ changed since $PREV — skipping web deploy."
    exit 0
    ;;
  1)
    echo "↪ Web-relevant changes detected since $PREV — proceeding with deploy."
    exit 1
    ;;
  *)
    echo "⚠ git diff failed (exit $status) — running build to be safe."
    exit 1
    ;;
esac
