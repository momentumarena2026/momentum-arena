import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { challengeDetailPayload } from "@/lib/challenge-view";
import { PreviewClient } from "./preview-client";

export const dynamic = "force-dynamic";

/**
 * What each person is looking at, right now, for one challenge.
 *
 * Not a mock-up: the page below renders the app's own
 * `ChallengeDetailScreen` against the app's own payload, once per viewer.
 * The venue asked for a preview that cannot fall behind the app, and the
 * only version of that which actually holds is one where there is nothing
 * separate to fall behind — no second component, no second query, no
 * second set of words. Change the screen and this changes; change the
 * payload and this changes.
 *
 * Nothing here writes. `track: false` keeps an admin's look out of the
 * customer's funnel: a venue reading a challenge is not a DETAIL_VIEWED by
 * the captain, and counting it as one corrupts the feed that says whether
 * the board is being used at all.
 */

/** Somebody who is not in this match, for the "what does a stranger see" view. */
const STRANGER = "preview-stranger-not-a-real-user";

export default async function ChallengePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin("MANAGE_BOOKINGS");
  const { id } = await params;

  const c = await db.challenge.findUnique({
    where: { id },
    select: {
      id: true,
      teamName: true,
      sport: true,
      status: true,
      createdByUserId: true,
      acceptedByUserId: true,
      createdBy: { select: { name: true, phone: true } },
      windows: {
        where: { proposedBy: "ACCEPTOR" },
        select: { proposedByUserId: true, status: true, approvedAt: true },
      },
      payments: {
        where: { paidAt: { not: null } },
        select: { userId: true, side: true },
      },
    },
  });
  if (!c) notFound();

  /**
   * Who to render, in the order the venue thinks about them.
   *
   * Everybody who has DONE something gets a viewpoint, not just the two
   * named on the challenge — several people can each suggest a time, and
   * "what is the person who asked about Saturday seeing" is exactly the
   * question this page exists to answer. The stranger is last because it is
   * the hypothetical one.
   */
  const seen = new Set<string>();
  const viewers: { id: string; label: string; note: string }[] = [];

  const add = (userId: string, label: string, note: string) => {
    if (seen.has(userId)) return;
    seen.add(userId);
    viewers.push({ id: userId, label, note });
  };

  add(
    c.createdByUserId,
    c.createdBy?.name || "The poster",
    "Posted this challenge",
  );

  for (const w of c.windows) {
    const answered = w.status !== "OFFERED" || !!w.approvedAt;
    add(
      w.proposedByUserId,
      "Suggested a time",
      answered ? "Their suggestion has been answered" : "Waiting on the poster",
    );
  }

  for (const p of c.payments) {
    add(p.userId, "Paid their half", `Paid as the ${p.side.toLowerCase()}`);
  }
  if (c.acceptedByUserId) {
    add(c.acceptedByUserId, "Took the match", "Recorded as the acceptor");
  }

  add(STRANGER, "A stranger", "Nobody involved — what the board offers anyone");

  // Name the people we only have ids for.
  const people = await db.user.findMany({
    where: { id: { in: viewers.map((v) => v.id) } },
    select: { id: true, name: true, phone: true },
  });
  const byId = new Map(people.map((p) => [p.id, p]));

  const views = [];
  for (const v of viewers) {
    const payload = await challengeDetailPayload(id, v.id, { track: false });
    // A viewer the server refuses is worth SHOWING rather than hiding: it
    // is the answer to "why can't they see it", which is a question the
    // venue will be asked.
    views.push({
      viewerId: v.id,
      label: v.label,
      note: v.note,
      person: byId.get(v.id) ?? null,
      payload: "notFound" in payload ? null : JSON.parse(JSON.stringify(payload)),
    });
  }

  return (
    <PreviewClient
      challengeId={id}
      teamName={c.teamName}
      status={c.status}
      views={views}
    />
  );
}
