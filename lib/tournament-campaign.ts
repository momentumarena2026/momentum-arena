import { db } from "@/lib/db";
import { sendBroadcast } from "@/actions/admin-push";

// Tournament marketing autopilot. Creating a tournament drafts one campaign
// item per milestone below (editable/toggleable from the admin Campaign tab).
// Lifecycle transitions auto-fire their mapped milestone; the rest are
// "Send now" buttons. Firing reuses the existing infra: pushes go through
// sendBroadcast (all devices), banners become PromoBanner rows targeting
// HOME_TOP with a deep link to the tournament page.

type TournamentLite = {
  id: string;
  slug: string;
  name: string;
  sport: string;
  entryFee: number;
  prizePool: number | null;
  bannerImageUrl: string | null;
};

type MilestoneDef = {
  milestone: string;
  kind: "PUSH" | "BANNER";
  title: (t: TournamentLite) => string;
  body: (t: TournamentLite) => string | null;
};

const prize = (t: TournamentLite) =>
  t.prizePool ? ` ₹${t.prizePool.toLocaleString("en-IN")} prize pool!` : "";

export const CAMPAIGN_MILESTONES: MilestoneDef[] = [
  {
    milestone: "REG_OPEN",
    kind: "PUSH",
    title: (t) => `🏆 ${t.name} — registrations OPEN!`,
    body: (t) =>
      `Get your squad together!${prize(t)} Register your team now — spots are limited.`,
  },
  {
    milestone: "REG_OPEN",
    kind: "BANNER",
    title: (t) => `${t.name} — Register now`,
    body: () => null,
  },
  {
    milestone: "REG_CLOSING",
    kind: "PUSH",
    title: (t) => `⏳ Last chance — ${t.name}`,
    body: () => `Registrations are closing soon. Lock your team's spot before it's gone!`,
  },
  {
    milestone: "REVEAL_TONIGHT",
    kind: "PUSH",
    title: (t) => `🎡 Pool reveal incoming — ${t.name}`,
    body: () => `The draw goes live soon. Open the app and watch the pools get revealed LIVE!`,
  },
  {
    milestone: "REVEALED",
    kind: "PUSH",
    title: (t) => `✨ Pools are OUT — ${t.name}`,
    body: () => `The draw is done! See who your team is up against — check the pools now.`,
  },
  {
    milestone: "LIVE",
    kind: "PUSH",
    title: (t) => `🔴 ${t.name} is LIVE!`,
    body: () => `Matches are underway — follow live scores and the points table in the app.`,
  },
  {
    milestone: "CHAMPION",
    kind: "PUSH",
    title: (t) => `👑 We have a champion — ${t.name}`,
    body: () => `What a tournament! Check the final results, awards and leaderboards.`,
  },
];

/** Draft the full campaign for a new tournament (idempotent). */
export async function draftCampaign(tournamentId: string): Promise<void> {
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      slug: true,
      name: true,
      sport: true,
      entryFee: true,
      prizePool: true,
      bannerImageUrl: true,
      campaignItems: { select: { id: true }, take: 1 },
    },
  });
  if (!t || t.campaignItems.length > 0) return;
  await db.tournamentCampaignItem.createMany({
    data: CAMPAIGN_MILESTONES.map((m) => ({
      tournamentId: t.id,
      milestone: m.milestone,
      kind: m.kind,
      title: m.title(t),
      body: m.body(t),
      enabled: true,
      status: "DRAFT",
    })),
  });
}

/** Status transition → milestone that auto-fires. */
export const TRANSITION_MILESTONE: Record<string, string> = {
  REG_OPEN: "REG_OPEN",
  POOLS_REVEALED: "REVEALED",
  LIVE: "LIVE",
  COMPLETED: "CHAMPION",
};

/** Fire every enabled, unsent item of a milestone. Called from admin-gated
 *  paths only (lifecycle transitions + the Campaign tab's Send now). */
export async function fireMilestone(
  tournamentId: string,
  milestone: string
): Promise<{ fired: number; skipped: number }> {
  const t = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, slug: true, name: true, bannerImageUrl: true },
  });
  if (!t) return { fired: 0, skipped: 0 };
  const items = await db.tournamentCampaignItem.findMany({
    where: { tournamentId, milestone, status: { in: ["DRAFT", "SCHEDULED"] } },
  });

  let fired = 0;
  let skipped = 0;
  for (const item of items) {
    if (!item.enabled) {
      skipped++;
      continue;
    }
    try {
      if (item.kind === "PUSH") {
        const res = await sendBroadcast({
          audience: { kind: "all" },
          title: item.title,
          body: item.body || "",
          destination: "home",
        });
        if (!res.ok) throw new Error(("error" in res && res.error) || "send failed");
        await db.tournamentCampaignItem.update({
          where: { id: item.id },
          data: { status: "SENT", sentAt: new Date() },
        });
        fired++;
      } else {
        // BANNER — needs an image; without one we skip (admin can attach a
        // banner image on the tournament and retry from the Campaign tab).
        const imageUrl = item.imageUrl || t.bannerImageUrl;
        if (!imageUrl) {
          await db.tournamentCampaignItem.update({
            where: { id: item.id },
            data: { status: "SKIPPED" },
          });
          skipped++;
          continue;
        }
        const banner = await db.promoBanner.create({
          data: {
            title: item.title,
            imageUrl,
            appImageUrl: imageUrl,
            linkUrl: `/tournaments/${t.slug}`,
            placement: ["HOME_TOP"],
            isActive: true,
            createdBy: "tournament-campaign",
          },
          select: { id: true },
        });
        await db.tournamentCampaignItem.update({
          where: { id: item.id },
          data: { status: "SENT", sentAt: new Date(), bannerId: banner.id },
        });
        fired++;
      }
    } catch (err) {
      console.error("[tournament-campaign] fire failed", item.id, err);
      skipped++;
    }
  }
  return { fired, skipped };
}
