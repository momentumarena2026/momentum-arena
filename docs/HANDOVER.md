# Handover — inheriting this project

You are picking up a codebase that has been worked on across many sessions
by an assistant whose conversation history you do not have. This file plus
the two it points at are the replacement for that history. Read all three
before touching anything.

1. **`docs/PROJECT-CONTEXT.md`** — the maintained picture: what the product
   is, how it deploys, the rules, and the traps that cost real debugging
   time. `CLAUDE.md` already tells you to read it every session.
2. **`docs/DEPLOYMENT.md`** — push-is-deploy mechanics, promotion, OTA,
   store builds.
3. **`docs/history/`** — archived working notes from earlier sessions.
   Point-in-time, often overtaken; read for *reasoning*, not for status.

## What you cannot recover, and what to do instead

The literal prompts and replies are not in this repository. They live in a
machine-local transcript store (`~/.claude/projects/<encoded-path>/`),
which is tied to the computer and OS user — **not** to a Claude account.
Switching accounts on the same machine keeps them; moving to a different
machine does not, unless that directory is copied across.

Everything that *mattered* from those conversations has been written down
here deliberately, because a decision only survives if its reasoning does.
If something looks arbitrary, check `docs/history/` before "fixing" it —
several of the odder-looking choices are load-bearing.

## The rules that are not negotiable

These have each been broken once and cost something.

- **Only `main` and `development` may be pushed to `origin`.** A pre-push
  hook enforces it. Do not bypass with `--no-verify`; the guard exists to
  survive context loss.
- **Never promote to `main` unless the user asks in that turn.** "We'll
  promote later" is not authorisation. Default target is `development`.
- **Never dispatch the mobile OTA by hand.** The push trigger fires on its
  own. (Overridden only when the user explicitly asks in that turn.)
- **Never write a `[skip ci]`-class token anywhere in a commit message**,
  not even in prose describing one — GitHub matches it anywhere in the
  message and silently skips workflows.
- **Never put a database connection string in a committed file.** The
  production database is reachable *only* from GitHub Actions via
  `secrets.PRODUCTION_DB_URL`. Local `.env` points at staging.
- **Never enter credentials, passwords or OTPs.** This blocks visual
  verification of every admin-authenticated screen; say so plainly rather
  than claiming a screen was checked.

## How work gets done here

Production data changes go through a `workflow_dispatch` job that **dry
runs by default** and prints what it would change, and only writes when
the user has seen that output and said go. `scripts/backfill-*.ts` and
`scripts/reconcile-*.ts` are the worked examples — copy their shape.

Money is the recurring theme, and the recurring bug class is *the same
quantity derived two different ways in two different places*. When you add
a figure, find every surface that already reports something like it and
either reuse the shared helper or explain on screen why they differ. See
`standingsGroups`, `batterRunsOf` / `bowlerRunsOf`, and the sports-earnings
gotcha in PROJECT-CONTEXT §4 for the three times this has bitten.

## Verification, honestly

Typecheck baselines: **web 0 errors, mobile 15** (pre-existing). Anything
above 15 on mobile is yours.

The admin surfaces need a login you cannot perform, so a great deal of
admin UI in this repo has been shipped typechecked-but-never-seen. That is
a real limitation and it should be stated to the user each time, not
papered over. Where a screen *can* be reached without credentials — the
public site, the scorer console via its code, the customer app — drive it
and prove the change.

## Open threads at the time of writing

Owed by the user, not by you:

- Set **Overs/Innings = 10** and **Wickets/Innings = 8** on the Momentum
  Cricket Cup. The net-run-rate correction is inert without the overs.
- Set the **Final's home side** to the pool winner via the Fixtures tab's
  "Set team…" control, so its scoring can start.
- Walk the app's twelve admin tournament tabs once an OTA lands — built,
  never seen rendering.
- `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` so the
  iOS simulator can be driven; only Android is currently reachable.
- Delete orphaned **Neon** branches, and check whether Neon's own GitHub
  integration is creating them (the Vercel side is now blocked in
  `vercel.json`).

Known-unfinished in code:

- **Free hit** after a no-ball, and **a wicket off a wide**, are not
  scoreable. Both need new state; deliberately deferred mid-tournament.
- **Profit uses each cafe item's *current* cost price.** `CafeOrderItem`
  snapshots the sale price but not the cost, so re-pricing an item moves
  historical profit. Snapshotting cost on the order line is the fix.
- **575 bookings still read platform "web"** and cannot be recovered —
  read them as *unknown*, not as web. Any platform split before
  2026-08-06 is unreliable.
