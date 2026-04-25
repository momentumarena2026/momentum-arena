#!/usr/bin/env bash
# Vercel ignoreCommand — wired up via vercel.json.
#
# Skips the Next.js web build whenever a deploy's diff lives entirely
# under apps/mobile/ (the React Native workspace). Anything outside
# apps/mobile/ — server actions, API routes, web pages, prisma schema,
# vercel.json itself — triggers a normal build.
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
