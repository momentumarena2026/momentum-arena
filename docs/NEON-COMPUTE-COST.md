# Neon compute cost — why the bill doubled, and the rule that keeps it down

October 2026's Neon bill came in at roughly **double** September's (under
$20 → about $40). It was not traffic growth. This is the diagnosis, the
arithmetic, and the one rule that matters.

---

## The rule

> **Neon bills COMPUTE TIME, not queries. An idle compute suspends only
> after ~5 minutes without a query. So any cron that runs more often than
> every 5 minutes pins the database awake 24/7 — whatever it finds.**

A cron that runs every minute and does nothing is not cheap. It is the most
expensive thing in this repo.

---

## What happened

On **20–21 September 2026** two crons moved from GitHub Actions to Vercel
(`a81ff8ec`, `558a9efc`), both on `* * * * *`:

- `/api/cron/challenge-offers`
- `/api/cron/process-reports`

The move was correct on its own terms — GitHub was delivering ~7 runs a day
against a requested 1,440, and the commit messages measured it. What it
could not see was the price.

Both routes query Postgres unconditionally on every invocation (and
`process-reports` issues a **write**, `db.report.updateMany`). At one query
per minute the idle timer never reaches five minutes, so the production
compute stopped suspending entirely.

September caught ~10 days of this. **October was the first full month**,
which is exactly where the bill stepped.

## The evidence

| | Production | Staging (control) |
|---|---|---|
| Idle suspends, 21 Oct – 1 Nov | **zero** | several per day |
| Compute active (1 Nov billing period) | **88%** | 3% |
| Average CU while active | **0.25** — the floor | 0.25 |

Staging is the control group: same project, same settings, no crons pointed
at it. It suspends constantly. Production never did.

"88% uptime at the minimum CU" is the signature of a compute that is awake
and doing nothing.

### What the crons were actually finding

| Cron | Runs/month | Work found in 30 days |
|---|---|---|
| `challenge-offers` | 43,200 | `ChallengeOffer` has had **0 rows, ever** |
| `process-reports` | 43,200 | **2** reports |
| `challenge-money` | 8,640 | 0 challenges created |

About 95,000 invocations a month, against 79 real bookings.

## The fix

**Every cron now fires at `:30`.** One compute wake per hour — 24 a day
instead of ~3,100 — and the daily jobs ride on a wake that already exists
instead of buying their own five-minute window.

Two things made this free rather than a trade:

- **Report latency never depended on the cron.** Both admin routes that
  enqueue a report already drain it inline via
  `after(() => processNextQueuedReport())`. The cron route's own docstring
  called itself "a safety net for stuck-state recovery". The minute schedule
  bought nothing.
- **Challenge offers have never existed.** Zero rows, ever.

Projected: ~88% uptime → ~8%, which is below where September actually sat.

## Things that are easy to get wrong here

**You cannot fix this inside the cron handler.** An early return like "check
whether there's work, then bail" still issues the query that wakes the
compute. Reading a feature flag is itself a query. It has to be the
**schedule**.

**Spreading crons out is not polite, it is paying several times over.** Four
crons on four different minutes buy four five-minute awake windows an hour.
The same four on one minute buy one. `rollup-metrics` carried a comment
saying its `:05` offset existed "to keep it from waking at the same instant
as the other hourly crons" — exactly backwards.

**`:30` UTC is the top of the IST hour.** That is load-bearing for
`daily-push` (an admin picking "19:00" must get 19:00, not 19:30) and it
also fixed `send-reminders`, which at `:00` UTC ran at `:30` IST and so
sent its "2 hour" reminder 1.5 hours out.

**`*/5` is NOT a safe cadence at the default timeout.** A five-minute tick
against a five-minute suspend timeout resets the idle timer right at the
boundary and may never suspend. Gaps must comfortably exceed the timeout.

## When challenges launch

`challenge-offers` genuinely wants a fine tick — offers expire in minutes
and the last-call nudge is the one that converts. Put it back to a
five-minute tick (or finer) **and accept the cost**, which is roughly $20 a
month. The trade is real; it should be made knowingly rather than inherited.

## Optional, not required

`suspend_timeout_seconds` on the production endpoint is `0` (= Neon's 300s
default). Dropping it to `60` in the Neon console would cut each wake's idle
tail from 5 minutes to 1, taking the projection down further. The fix above
does not depend on it.
