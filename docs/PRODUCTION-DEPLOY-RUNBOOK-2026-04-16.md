# Production Deploy Runbook — SlotHold Refactor + UI Fixes

**Target release:** merge `development` → `main` (11 commits ahead)
**Prepared:** 2026-04-16
**Estimated window:** 5–10 min (migration is ~seconds; padding is for verification)

---

## 0. Why this release is sensitive

This release includes a **schema-breaking Prisma migration**
(`20260416120000_slothold_refactor`) that:

1. Removes `LOCKED` from the `BookingStatus` enum (swap via
   `BookingStatus_new`).
2. **Drops** columns `Booking.lockedAt` and `Booking.lockExpiresAt`
   (data is permanently lost).
3. Drops index `Booking_lockExpiresAt_idx`.
4. Creates a new `SlotHold` table with FKs to `User` and `CourtConfig`.

Because the new application code **requires** `SlotHold` to exist *and*
the old application code **requires** `lockedAt`/`lockExpiresAt`/`LOCKED`,
**the migration and the code deploy are tightly coupled** — a brief
downtime is necessary.

Everything else in this release (today's commit `13146f3`) is UI/string
only and carries no DB risk:

- GST invoice pricing fix (was dividing by 100)
- Invoice slot time format (`4:00 PM` → `4pm - 5pm`)
- Admin bookings filter label overlap
- `formatHour` → compact range propagation across ~20 files

---

## 1. Pre-flight checks (do not skip)

### 1a. Snapshot the production database

Take a Neon branch/snapshot **right before the migration** so you can
restore if anything goes wrong. Dropped columns are not recoverable
otherwise.

### 1b. Confirm env vars are set on Vercel (prod project)

Minimum required, else runtime will crash or payments will silently
no-op (same warnings appeared during local `next build`):

- `DATABASE_URL` (pooler)
- `DIRECT_DATABASE_URL` (direct — used for migrations)
- `AUTH_SECRET`
- `NEXTAUTH_URL`
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- `PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY`, plus `PHONEPE_SALT_INDEX` if used
- `MSG91_AUTH_KEY` (SMS reminders)
- Any Google / WhatsApp / analytics keys already in prod (should be unchanged)

### 1c. Inspect stale data on prod DB

Run these read-only queries against prod via Neon SQL editor (or psql
with `DIRECT_DATABASE_URL`):

```sql
-- Any LOCKED bookings still sitting in the table?
SELECT id, "userId", "createdAt", "lockExpiresAt"
FROM "Booking"
WHERE status = 'LOCKED';

-- Any LOCKED rows from the last hour (i.e. actively being created)?
SELECT COUNT(*) FROM "Booking"
WHERE status = 'LOCKED' AND "createdAt" > NOW() - INTERVAL '1 hour';
```

- If the count from the second query is **> 0**: users are actively
  creating LOCKED rows. You must put up a maintenance banner / pause
  new-booking flow before proceeding, or those in-flight checkouts will
  fail.
- If count is **0**: you are safe to proceed right away. The migration's
  built-in `UPDATE ... SET status = 'CANCELLED' WHERE status = 'LOCKED'`
  will tidy any strays atomically inside the migration's transaction.

---

## 2. Deploy sequence

### 2a. Merge to `main` (triggers Vercel prod deploy)

**⚠ IMPORTANT — do NOT push main yet.** First run the migration in a
separate terminal. Vercel will queue the deploy the moment `main` is
pushed. We want the migration to land before (or as close as possible
to) the new pod start.

```bash
# From /Users/nakulvarshney/Workspace/momentum-arena
git fetch origin
git checkout main
git pull --ff-only origin main
git merge --no-ff origin/development -m "release: SlotHold refactor + UI fixes (2026-04-16)"
# do NOT push yet
```

### 2b. Apply the migration to prod DB

Use the **direct** (non-pooler) connection string — `migrate deploy`
needs a direct session, not PgBouncer. If your `.env.production` sets
`DIRECT_DATABASE_URL`, use that explicitly:

```bash
# From repo root. Replace <PROD_DIRECT_URL> or source it from a safe
# place — don't check it into shell history.
DATABASE_URL="<PROD_DIRECT_URL>" npx prisma migrate deploy
```

Expected output:

```
1 migration found in prisma/migrations
Applying migration `20260416120000_slothold_refactor`
The following migration(s) have been applied:
migrations/
  └─ 20260416120000_slothold_refactor/
     └─ migration.sql
```

If it fails with an enum error, it means a LOCKED row slipped in after
step 1c — re-run the LOCKED cleanup query and retry the migration.

### 2c. Push `main` to trigger Vercel deploy

```bash
git push origin main
```

Vercel will build and roll out the new pods. Old pods stay alive until
the new ones are healthy, so there is effectively zero-downtime from
users' perspective **as long as step 2b completed first**. If 2b hasn't
happened yet when 2c starts, new pods will crash at boot because
`SlotHold` is missing and the old pods will crash because `LOCKED` /
`lockedAt` are gone.

### 2d. Watch the Vercel deploy logs

- Open the Vercel dashboard → this release.
- Watch for build success and the first successful server-response.
- If build fails, rollback is just "Promote previous deploy" in Vercel;
  the DB migration does not need rolling back.

---

## 3. Post-deploy smoke tests

Do these in order. Stop and rollback if any fails.

1. **Homepage loads** on prod URL.
2. **Login** (phone OTP or Google) — verify no 500s.
3. **Book a slot** end-to-end with Razorpay test → booking appears in
   "My Bookings" as CONFIRMED within ~5 seconds.
4. **Book a slot with UPI QR** (if enabled on prod) → goes to
   WhatsApp-share screen (not auto-redirect), status lands in
   "Awaiting confirmation".
5. **Admin** `/admin/bookings` — the Status filter label ("STATUS")
   and the "All" pill have breathing space, no overlap on desktop
   nor on a mobile-width viewport.
6. **Admin** `/admin/bookings/unconfirmed` — sees the pending booking
   from step 4.
7. **Download invoice** from a CONFIRMED booking — GST invoice shows
   `Rs. 1,600.00` (not `Rs. 16.00`) and time reads `4pm - 5pm`.
8. **Time displays across the app** — check a few: dashboard, slot
   grid, confirmation page, admin calendar, edit slot modal. Should
   show `5pm - 6pm` style (not `5:00 PM`).

---

## 4. Rollback plan

### Scenario A: Code deploy fails after successful migration

Use Vercel "Promote previous deploy" to roll code back. **Do not roll
back the migration** — the old code won't work against the new schema
(it expects `lockedAt`/`lockExpiresAt`/`LOCKED`). You'll need to either:

- Re-deploy forward once the fix is ready, or
- Restore the DB from the snapshot taken in step 1a **and** promote the
  previous code deploy. This loses any bookings created since the
  snapshot.

### Scenario B: Migration fails (enum cast error)

The migration is one transaction — on failure, nothing is committed.
Re-run the LOCKED cleanup query and retry.

### Scenario C: Everything applied, but a subtle bug appears

Create a hotfix on a new branch off `main`, PR → `main`, Vercel will
deploy. The schema is already forward-compatible.

---

## 5. Cleanup (day after)

- Monitor Vercel logs for any `SlotHold`-related crashes.
- Remove the Neon snapshot taken in step 1a after ~48h of healthy
  operation.
- Remove any temporary maintenance banner.
- Verify the `cleanup-locks` cron is either removed from
  `vercel.json` / env or confirm it is now a no-op (the new code
  cleans up expired `SlotHold` rows instead).

---

## 6. What's in this release (for the changelog)

- `13146f3` fix(invoice,ui): correct GST pricing and propagate 5pm-6pm range format
- `da33612` feat(slots): show slot time as range (e.g. 5pm - 6pm)
- `8d2ddf8` fix(bookings): clarify pending status + show booked-on timestamp
- `10fcba8` feat(bookings): redesign My Bookings page + UPI QR flow fixes
- `e988bbd` chore(db): add Prisma migration for SlotHold refactor
- `6bb70b8` refactor: split transient slot reservations from committed bookings
- `13e0409` Free slot lock when user leaves checkout without paying
- `7a9a89a` feat: default to confirmed bookings sorted by booked time, auto-cancel abandoned locks
- `ea47c9c` fix: use correct MSG91 template variable names (name, url)
- `ea2cdbc` fix: use VAR1/VAR2 for MSG91 Flow template variables
- `3e45b03` feat: add MSG91 template IDs for booking confirmation and unconfirmed booking SMS
