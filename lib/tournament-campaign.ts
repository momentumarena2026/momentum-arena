import { db } from "@/lib/db";
import { sendToTokens } from "@/lib/push";

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

/**
 * The registration drive's rotating copy.
 *
 * Drafted as RECURRING campaign items, which means they live on the
 * same admin Campaign tab as every other message and can be rewritten,
 * switched off or added to without a deploy — the same bargain the
 * daily-push line library strikes. They are not milestones: nothing
 * fires them, the cron walks them least-recently-used.
 *
 * `{spotsLeft}` / `{daysLeft}` / `{prizePool}` / `{entryFee}` /
 * `{name}` are substituted at send time by renderDriveCopy. Lines that
 * use `{daysLeft}` only make sense when the tournament has a close
 * date; on an open-ended one it renders empty, so none of the defaults
 * below leans on it alone for grammar.
 *
 * Eight lines, which at the drive's default one-a-day cadence is longer
 * than most registration windows — the rotation should run out of
 * window before it runs out of things to say.
 */
export const REG_DRIVE_LINES: MilestoneDef[] = [
  {
    milestone: "REG_DRIVE",
    kind: "PUSH",
    title: (t) => `${t.name} — {spotsLeft} spots left`,
    body: (t) => `Get your squad in.${prize(t)} Registration is open now.`,
  },
  {
    milestone: "REG_DRIVE",
    kind: "PUSH",
    title: () => `Team ready? {spotsLeft} places open`,
    body: (t) => `${t.name} needs teams. Entry ${t.entryFee > 0 ? `₹${t.entryFee.toLocaleString("en-IN")}` : "free"} — register in the app.`,
  },
  {
    milestone: "REG_DRIVE",
    kind: "PUSH",
    title: (t) => `Still time for ${t.name}`,
    body: () => `{spotsLeft} spots are unclaimed. Grab one before the draw is made.`,
  },
  {
    milestone: "REG_DRIVE",
    kind: "PUSH",
    title: () => `Your WhatsApp group has 11 players`,
    body: (t) => `${t.name} has {spotsLeft} spots. You can see where this is going.`,
  },
  {
    milestone: "REG_DRIVE",
    kind: "PUSH",
    title: (t) => `${t.name} — draw not full yet`,
    body: () => `{spotsLeft} teams short. Enter yours and we'll sort the fixtures.`,
  },
  {
    milestone: "REG_DRIVE",
    kind: "PUSH",
    title: () => `Captain, assemble`,
    body: (t) => `${t.name}, {spotsLeft} spots open.${prize(t)} Register your team today.`,
  },
  {
    milestone: "REG_DRIVE",
    kind: "PUSH",
    title: () => `{spotsLeft} spots. One of them yours?`,
    body: (t) => `${t.name} is taking entries now — it closes when the draw fills.`,
  },
  {
    milestone: "REG_DRIVE",
    kind: "PUSH",
    title: (t) => `Play ${t.name}, not FIFA`,
    body: () => `{spotsLeft} places left in the draw. Get the team signed up.`,
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
    data: [
      ...CAMPAIGN_MILESTONES.map((m) => ({ def: m, recurring: false })),
      ...REG_DRIVE_LINES.map((m) => ({ def: m, recurring: true })),
    ].map(({ def, recurring }) => ({
      tournamentId: t.id,
      milestone: def.milestone,
      kind: def.kind,
      title: def.title(t),
      body: def.body(t),
      enabled: true,
      status: "DRAFT",
      recurring,
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
    // `recurring: false` is load-bearing. A recurring drive line sits at
    // status DRAFT for its whole life, so without this filter any
    // milestone fire — or an admin's "Send now" — would scoop up the
    // drive's copy, send it once and mark it SENT, silently removing it
    // from the rotation.
    where: { tournamentId, milestone, recurring: false, status: { in: ["DRAFT", "SCHEDULED"] } },
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
        // Direct FCM broadcast (lib-level, no admin session) — milestones can
        // fire from SCHEDULED auto-transitions triggered by public page loads,
        // where the admin-gated sendBroadcast action would throw.
        const devices = await db.pushDevice.findMany({ select: { token: true } });
        const res = await sendToTokens(
          devices.map((d) => d.token),
          { title: item.title, body: item.body || "", data: { kind: "broadcast" } }
        );
        if (res.attempted > 0 && res.succeeded === 0) throw new Error("push send failed");
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

/**
 * Hide every promo banner this tournament put on the site.
 *
 * `fireMilestone` publishes a PromoBanner per BANNER milestone (using the
 * tournament's hero image) and records the id on the campaign item. Nothing
 * ever took them down: a cancelled tournament kept advertising itself on the
 * home screen and in the app, linking to a page that no longer sells
 * anything.
 *
 * Deactivated rather than deleted, for the same reason the cancel itself is
 * reversible — `showTournamentBanners` puts them back if the cancel was a
 * mis-click. Deleting would also lose the campaign item's `bannerId` link.
 */
export async function hideTournamentBanners(
  tournamentId: string,
): Promise<{ hidden: number }> {
  const items = await db.tournamentCampaignItem.findMany({
    where: { tournamentId, bannerId: { not: null } },
    select: { bannerId: true },
  });
  const ids = items.map((i) => i.bannerId as string);
  if (ids.length === 0) return { hidden: 0 };
  const res = await db.promoBanner.updateMany({
    where: { id: { in: ids }, isActive: true },
    data: { isActive: false },
  });
  return { hidden: res.count };
}

/**
 * Re-show the banners hidden by a cancel, when the tournament is restored.
 *
 * Scoped to campaign items that are still `enabled` and were actually SENT,
 * so an item an admin switched off, or one that never fired, doesn't get a
 * banner resurrected behind it. A banner whose own start/end window has since
 * passed simply won't render — that scheduling is honoured downstream, so it
 * doesn't need re-checking here.
 */
export async function showTournamentBanners(
  tournamentId: string,
): Promise<{ shown: number }> {
  const items = await db.tournamentCampaignItem.findMany({
    where: {
      tournamentId,
      bannerId: { not: null },
      enabled: true,
      status: "SENT",
    },
    select: { bannerId: true },
  });
  const ids = items.map((i) => i.bannerId as string);
  if (ids.length === 0) return { shown: 0 };
  const res = await db.promoBanner.updateMany({
    where: { id: { in: ids }, isActive: false },
    data: { isActive: true },
  });
  return { shown: res.count };
}
