---
name: feedback-no-manual-ota-dispatch
description: "Never dispatch ota-publish.yml by hand — the push trigger handles it, ~30 min late"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
  modified: 2026-08-07T07:58:23.209Z
---

Do NOT run `gh workflow run ota-publish.yml` after promoting to main. The
push trigger fires on its own for both `development` and `main`; runs are
just created roughly **30 minutes** after the push.

**Why:** measured 2026-08-07 — `89cbb82` (development) pushed 19:42 UTC →
run #290 at 20:12; `6481e36` (main) pushed 20:05 → run #292 at 20:35. A
manual dispatch only adds a duplicate DRAFT at `/admin/ota` for the user to
choose between. Rollout is deliberately manual — the workflow publishes a
draft, an admin releases it.

**How to apply:** promote, then stop. If asked whether OTA fired, wait 45
minutes and look the run up by commit SHA — never conclude "CI didn't fire"
from a check made seconds after a push. That mistake produced three wrong
theories in one session (path filters, lost webhooks, main-vs-development)
before timestamps settled it; the GitHub PushEvent API had already shown
every push was delivered.

Related: [[deployment_runbook]], [[feedback_no_auto_main]]
