import { notFound } from "next/navigation";

/**
 * Rewards is temporarily disabled while it's being redesigned.
 *
 * The backend (RewardPointsBalance, transactions, /admin/rewards
 * surface) is left intact — only customer-facing entry points are
 * shut off:
 *   - this page returns 404 (was a tier explainer + balance view)
 *   - mobile chat-engine "rewards" intent removed
 *   - /rewards stripped from sitemap.ts and added to robots.ts
 *     disallow so retired URLs stop ranking
 *   - bottom-nav `match` predicate no longer references /rewards
 *
 * When the redesign lands, swap notFound() back out for the new
 * customer surface — schema doesn't need to change.
 */
export default function RewardsDisabledPage(): never {
  notFound();
}
