---
name: feedback-no-auto-main
description: "Do NOT promote to main unless the user explicitly asks — ship to development only by default"
metadata:
  type: feedback
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
---

**Do not ship/promote anything to `main` unless the user explicitly asks** (2026-07-02: "please do not ship anything to main").

**Why:** `main` = production (Vercel auto-deploys it; seed-production runs on push). Earlier the user had said "push it to main and also seed it, you do all it by yourself" for a specific change, and I generalized that into auto-promoting every change dev→main for the rest of the session. That approval was per-change, not standing. Production deploys are the user's call.

**How to apply:** default pipeline = commit → push to `development` (staging) → stop. Report what's on development and ask/wait for an explicit "promote/ship to main" before running the dev→main promotion. When they do ask, the usual gate-checked promotion procedure applies (see [[deployment-runbook]]). If something urgent seems to warrant prod, recommend it — don't do it.
