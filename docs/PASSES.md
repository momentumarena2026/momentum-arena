# Monthly Passes

Bulk-hour passes: a customer (or the venue, at the counter) buys N hours on
one court group at a discounted effective hourly rate, then spends those
hours at checkout instead of money. Passes can be scheduled to start on a
future date, scoped to a pricing band, and shared with other registered
customers.

Status: web-complete. Mobile: customer **My Passes** list shipped; full
parity (purchase, detail/members, admin) tracked separately.

---

## 1. Data model (prisma/schema.prisma)

| Model | Purpose |
|---|---|
| `PassPlan` | The **product** on the storefront: court config, `totalMinutes`, `anchorPrice` (per-slot) + `anchorPricePerHour`, `bands` (JSON), `discountPercent`, `baseAmount`, `price`, `validityDays`, `isActive`. |
| `UserPass` | A **sold pass** — full snapshot of the plan at purchase (name, sport, court, minutes, price, validity, `bands`, `anchorPrice`) plus `startsAt`, `expiresAt`, `remainingMinutes`, `status` (`ACTIVE/EXHAUSTED/EXPIRED/CANCELLED`), payment refs (`razorpayOrderId` / `phonePeMerchantTxnId`), and offline-issue audit (`paymentMethod`, `issuedByAdminId`, `offlineRef`). `planId` is **nullable** — admin gift passes have no plan and never appear on the storefront. |
| `PassRedemption` | One row per booking paid (fully or partly) with a pass: `minutes`, `value` (worth at the pass's effective rate — attribution only), `coveredAmount` (list-price rupees settled — drives owed-at-venue math), `restoredAt` (set when a cancellation returns the hours). |
| `PassMember` | A user the owner shares the pass with (`@@unique([userPassId, userId])`, cascade delete). `addedBy` = `"OWNER"` or the admin id. |
| `PassPurchaseIntent` | Money-first holder for **DQR (UPI)** purchases — maps the PhonePe `transactionId` to `planId + userId + startsAt` until capture confirms. |
| `CourtConfig.maxPassMembers` | Per sport/sub-sport shared-member cap (0 = sharing off). The setter writes the whole interchangeable court group. |
| `ArenaSettings.passesEnabled` | Storefront master switch (default OFF). OFF hides `/passes` plans + blocks purchase APIs; already-sold passes keep redeeming. |

Key invariants:

- **Snapshots, not references.** Editing/deleting a plan never changes a
  sold pass. Sold passes honour their `bands`/`anchorPrice` forever.
- **Minutes, not hours.** Balances are stored in minutes so 30-minute
  bowling slots debit with integer math (5h = 300).
- **Money-first.** No `UserPass` exists until the gateway confirms capture
  (Razorpay verify/webhook, or DQR status-poll/S2S callback — all
  idempotent on the payment ref).

## 2. Pricing bands + anchor

A pass binds to **one price tier**. The admin wizard shows the court's
pricing cells (Weekday/Weekend × Peak/Off-peak) as checkboxes; selecting a
cell at ₹X disables every differently-priced cell, and the **anchor is
derived** from the selection (no manual entry). `lib/pass-bands.ts` holds
the pure helpers (`parseBands`, `slotInBands`, `bandsSummary`).

If a sport's price later changes, a plan band whose current price no longer
equals the anchor drops out; a plan with no valid band is hidden from the
storefront and flagged "Pricing changed — not sellable" in admin. Sold
passes are unaffected.

Empty `bands` = legacy/unrestricted (covers all hours) — also used by gift
passes when the admin leaves all cells unchecked.

## 3. Court groups

Cricket's half court is two configs (`MEDIUM · LEFT/RIGHT`) and a booking
lands on whichever half is free, so passes match on the **interchangeable
court group** (`sport + size + category`, `lib/court-config.ts
courtGroupKey/courtGroupLabel`). A half-court pass covers both halves; the
two leather pitches group the same way; Bowling Machine stays its own group.
The admin pickers collapse each group to one option (LEFT is the stored
representative).

## 4. Purchase flows

- **Online — UPI (default when DQR enabled) or Razorpay** via the `/passes`
  storefront sheet, which also carries the **start date** (today…+90d, IST
  midnight; `parseStartDate`). UPI runs through
  `/api/phonepe/dqr/pass-initiate|pass-status` + the shared
  `dqr-callback` (branch order: booking → cafe → pass) using
  `PassPurchaseIntent` + `confirmDqrPass`. Razorpay runs through
  `/api/passes/create-order|verify` with the `payment.captured` webhook as
  backstop (notes carry `type: PASS, planId, userId, startsAt`).
- **At the venue** (`issuePassToUser`, MANAGE_PASSES): walk-in pays Cash /
  static QR / Free; admin records amount collected (defaults to plan price)
  and an optional UTR note.
- **Gift** (`giftCustomPass`): bespoke private pass (no plan, `planId
  null`), free to the recipient with an optional recorded value + occasion
  note.

Validity: `expiresAt = startsAt + validityDays`. A future-start pass shows
as **UPCOMING** and becomes redeemable on its start date.

## 5. Redemption

`lib/passes.getPassOfferForHold(hold)` is the single eligibility gate
(checkout page, `/api/passes/redeem`, `redeem-verify`):

- The booker may be the **owner or a member**.
- Validity is judged against the **booking's play date**:
  `startsAt <= hold.date < expiresAt` (so a pass starting 1 Aug can be used
  today for a 2 Aug slot, and never pays for play after expiry).
- **Slot-level coverage**: each booked slot is classified via
  `getSlotPricesForDate`; the pass covers slots inside its bands. Fully
  covered → booking created at ₹0 (`method: PASS`); partially → Razorpay
  top-up for the remainder (priciest matching slots covered first).
- Passes don't combine with coupons or points — choosing the pass drops
  them from the hold (nothing is consumed).
- `debitPass` decrements atomically and records `value` + `coveredAmount`.
  Cancellation within the window calls `restorePassForBooking` (hours
  return, `restoredAt` stamped); late cancels forfeit.
- Admin **+30-min extends** can be pass-paid (same owner-or-member +
  play-date rules); the extension slot is recorded at ₹0.
- Confirmation messages (SMS/push/in-app + admin notify) fire from both
  redeem paths via `after()`, same as every money path.

## 6. Sharing (members)

- Cap per sport/sub-sport: `CourtConfig.maxPassMembers`, edited from the
  "Pass sharing" card on `/admin/passes` (writes the whole court group).
- Owner adds/removes members by **registered phone** on the pass detail
  page (`/passes/[id]`); admin does the same from the Members modal on the
  sold-passes table. Unregistered numbers get a prefilled **WhatsApp
  invite** to sign up.
- Members can book with the pass (checkout + admin extends) but cannot
  edit the roster. Everyone draws from the same balance.

## 7. Money story (cash basis — user-approved)

Money is recognised **once, when it arrives**:

- Pass purchase → revenue on the purchase date under the pass's sport
  (CA report "Pass Sales" sheet; sports analytics merge pass sales by IST
  purchase day/month, tooltips show "· N passes").
- Pass-paid booking → **₹0** everywhere money is counted (customer list +
  confirmation, admin list + detail, analytics — the earnings SQL subtracts
  `PassRedemption.coveredAmount`). The redemption `value` (effective rate ×
  minutes) is shown as **attribution only** ("worth ₹520") and a "Pass value
  (₹)" column in the CA Bookings sheet, deliberately excluded from
  Paid/Cash/UPI/Online sums.
- "Collect at venue" treats `coveredAmount` as settled, so staff are never
  prompted to charge a pass-paid customer again.

## 8. Admin operations (/admin/passes, permission MANAGE_PASSES)

- **Customer sales** master toggle (storefront on/off).
- **Create/edit plan** wizard: sport → court group → hours → band
  checkboxes (anchor derived) → discount → validity. Editing only affects
  future buyers; delete is blocked once sold (deactivate instead).
- **Issue a pass** (venue sale) and **Gift a custom pass** cards, both with
  find-or-create customer by phone and a start-date field.
- **Pass sharing** member-limit card per court group.
- **Sold passes** table: search, Members modal, Extend validity, Adjust
  balance, Cancel (terminal — no further actions on cancelled passes;
  refunds stay manual per policy).

## 9. Customer surfaces

- `/passes` — storefront: ticket cards with the hours dial, band chip,
  4-step "How it works" (incl. sharing) + grouped T&C.
- `/my-passes` — wallet: Active/Inactive tabs, animated balance clocks,
  tickets link to detail. (Account page links here.)
- `/passes/[id]` — detail: clock, attributes, member roster
  (owner-managed), booking history with restored flags. Owner + members
  only; everyone else 404s.
- Mobile: Account → My Passes (list with static balance rings, same API
  shape via `/api/mobile/passes` + `lib/passes.listUserPasses`).

## 10. Gotchas

- `PassRedemption` rows created before the value/coveredAmount migration
  carry 0s (dev-only data; production started clean).
- `UserPass.courtConfigId` doubles as scalar snapshot and FK — the
  relation exists for member-cap/label lookups only.
- Pass bookings deliberately earn **no reward points** at redemption and
  the offer never shows when a coupon/points are applied (they're dropped
  if the customer picks the pass).
