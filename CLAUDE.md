# Momentum Arena — Claude session rules

These are repo-wide policies. They override default Claude Code behaviour.
Re-read this file at the start of every session.

---

## START HERE — project context

**Read `docs/PROJECT-CONTEXT.md` at the start of every session, before planning or
editing.** It is the living orientation document: what the product is, the deployment
model, the environment facts, the traps that are expensive to rediscover, and the
reasoning behind recent architectural decisions. It exists so a session on any machine
or account can pick this codebase up cold.

**Keep it current as part of the work, not afterwards.** A stale context doc is worse
than none, because it gets trusted. When you finish a piece of substantive work, update
it in the same commit if you changed any of:

- a rule, branch policy, deployment step, or environment fact
- a newly-discovered trap worth never rediscovering again
- a module added, or an architectural decision whose *reasoning* won't survive in the diff
- what is shipped vs. still pending
- a file path in its map, or a new pair of files that must stay in sync

Record **why**, not just what — the diff already records what. Prune what has become
false. Do not let it become a changelog. Refresh its "Last substantive update" line and
`main` SHA when you touch it.

Routine work needs no entry: a bug fix that reveals nothing general, a copy tweak, a
dependency bump. Ask "would the next session waste time without this?" — if no, leave it.

---

## Git push policy (installed 2026-05-28)

**Only `main` and `development` may be pushed to `origin`. No exceptions.**

- Do **not** push feature/topic/`claude/*` branches.
- Do **not** bypass the guard with `git push --no-verify`. The whole
  point of the guard is to survive context loss — if you bypass it
  you've defeated it.
- If a workflow seems to require pushing a topic branch (e.g. opening
  a PR via `gh pr create`), **stop and ask the user** how to proceed.
  Do not improvise around the rule.

Technical enforcement: a `pre-push` hook lives at
`.git/hooks/pre-push` (shared across all worktrees via
`core.hooksPath`). It rejects any push whose remote ref is not
`refs/heads/main` or `refs/heads/development`. Branch deletions and
tag pushes are allowed.

If you ever need to inspect or modify the guard, the hook source is at:

    .git/hooks/pre-push

---

## Branch discipline (2026-07)

- **Default destination is `development`.** Promote to `main` only when the
  user explicitly asks ("push to main" / "promote"). Never assume.
- Promotion = merge `origin/development` into `main` with an **empty
  gate-check** (`git diff --stat origin/development HEAD` must print nothing).
  Full procedure: `docs/DEPLOYMENT.md` §4.

## Commit-message tokens (2026-07-02 incident)

Never write `[skip ci]`-class tokens anywhere in a commit message — not even
in prose describing them (GitHub matches the token *anywhere* in the message
and silently skips workflows). The pipeline is path-filtered; tokens are
unnecessary. The one legitimate use is machine-generated fingerprint-baseline
commits created by CI itself.

## Module docs

- `docs/PROJECT-CONTEXT.md` — **start here**; whole-codebase orientation (see top of file).
- `docs/PASSES.md` — Monthly Passes: schema, pricing bands, court groups,
  purchase/redemption/sharing flows, cash-basis money story, admin ops.
- `docs/TRUSTED-DEVICES.md` — the 5-tap hidden admin entry allowlist
  (device IDs, trust check, registration paths).
- `docs/phonepe-dqr-onboarding.md` — PhonePe Dynamic QR merchant setup.

## Deployment model (read before shipping)

Push = deploy. Vercel builds are schema-atomic (`prisma db push` runs inside
the build); seed workflows are path-filtered to `prisma/**`; mobile OTA
publishes automatically on `apps/mobile/**` changes; native store builds are
auto-dispatched on `development` when the native fingerprint changes and are
**manual-only** for production tracks. Details: `docs/DEPLOYMENT.md`.

---
