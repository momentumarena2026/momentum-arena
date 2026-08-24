---
name: tournament-security-audit-2026-07-28
description: "Tournament audit + remediation (2026-07-28): 12 findings found via 3-agent audit + live exploitation, ALL FIXED on development 2e97d2a; includes the DQR money-leak pattern and the scorer-code rules"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
  modified: 2026-07-28T15:13:41.292Z
---

**Tournament module audited AND fixed, 2026-07-28. All 12 findings closed in `development` 2e97d2a.** Found via 3 parallel read-only audit agents + my own live exploitation on :3100 against the staging DB; fixes re-verified by replaying the proven exploits (all now rejected).

**The load-bearing lessons (apply to any new payment/scoring surface):**
- **DQR pointer rule**: whatever field links a PhonePe txn back to its object (`TournamentTeam.paymentRef`, `SlotHold.phonePeMerchantTxnId`) must NEVER be overwritten without settling the prior txn first — otherwise a late-settling payment is unrecoverable (no object, no orphan). Use `settlePriorTournamentDqrTxn` / `settlePriorDqrTxn` in lib/dqr-inflight.ts: COMPLETED → confirm that one, PENDING → refuse to mint. And the "no object found" branch must file an orphan, never `return {}`.
- **Rate-limiting a POLLED endpoint (learned the hard way, f78b8cf)**: charge the budget ONLY on failure and ONLY after the lookup. My first version counted every request; the scorer console polls every 5s (12/min = the 60/5min cap exactly), so consoles died with 429 after five minutes AND the client showed it as "Invalid scorer code". Also: a venue is one NAT'd IP, so a pre-lookup block lets one person's typo bar the real scorer. `checkRateLimit({peek:true})` + `recordRateLimitHit()` in lib/rate-limit.ts is the pattern.
- **Scorer code rules**: it IS a bearer credential — CSPRNG only (`globalThis.crypto.getRandomValues`, not Math.random), must have a rotate action (rotateScorerCode), rate-limited per IP (lib/rate-limit.ts, shared fixed-window over the RateLimit table), and never reported to GA4 (components/google-analytics.tsx `redactPath` masks /score/[code]).
- **Status ⇒ money**: any status transition that makes a team payable must recompute `dueAmount`. setTeamStatus does this now; `recordTeamPayment` refuses `amount > dueAmount`, so a 0 due is silently uncollectable.
- **undo is LIVE-only**: `undoLastEvent` guards on match.status; `refoldMatch` only replaces TournamentPlayerStat when the event log has player attribution (otherwise it would wipe admin-entered stats).
- **Trust the request, not the body**: platform comes from `resolveRequestPlatform` (bearer header), never a query param or body field — that was defeating both the APP_ONLY live gate and app-only coupons.
- **Pre-reveal**: the fixtures ARE the draw — `/api/tournaments/[slug]/public` now filters out POOL-stage matches until poolsRevealed.

Also fixed: unbounded live event values (clamped, 12 runs/ball max) + memberId validated against match rosters + event.data whitelisted; coupon uses claimed atomically (guarded updateMany, the booking pattern in actions/booking.ts:1391); abandoned PENDING_PAYMENT swept after 30 min (`sweepStalePendingTeams`, refunds points) so captains aren't locked out; capacity race rolled back post-insert; logoUrl restricted via `isTrustedAssetUrl` in lib/blob.ts; REDEEMED_TOURNAMENT added to previewRedemption + admin ledger.

**Verified SAFE, don't re-audit**: Razorpay HMAC on verify + webhook, server-side amount re-derivation, points double-spend/refund idempotency (guarded debit + @@unique), squad/my-team ownership, admin authz double-gating, mass assignment (zod), XSS (React escaping — payloads render as literal text), scorerCode absent from public payloads, campaign broadcast single-winner.

Related: [[tournament-engine-2026-07]], [[tournament-match-centre]], [[payment-orphan-leak-fix]], [[pass-coverage-and-dqr-recovery]]
