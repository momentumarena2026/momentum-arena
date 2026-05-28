# Momentum Arena — Claude session rules

These are repo-wide policies. They override default Claude Code behaviour.
Re-read this file at the start of every session.

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
