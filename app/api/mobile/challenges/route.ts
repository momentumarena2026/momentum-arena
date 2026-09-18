import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMobileUser } from "@/lib/mobile-auth";
import {
  listOpenChallenges,
  listMyChallenges,
  getChallenge,
  postChallenge,
  acceptChallengeWindow,
  counterChallenge,
  withdrawChallenge,
  challengeSettings,
  expireStaleChallenges,
  logChallengeEvent,
  challengeLimits,
} from "@/lib/challenges";
import { counterRefusal } from "@/lib/challenge-rules";

/**
 * The challenge board, for the app.
 *
 * App-only by decision — there is no customer web surface — so this is the
 * single door to the feature and every screen goes through it. One route
 * with an `op`, matching the admin routes, because the board is a handful
 * of small actions on one object rather than a REST resource.
 */

const windowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHour: z.number().int().min(0).max(25),
  endHour: z.number().int().min(1).max(25),
  courtConfigId: z.string().nullish(),
});

export async function GET(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Close out anything past its deadline before answering. A challenge
  // that still looks live because a job has not run is one somebody taps
  // and cannot take.
  await expireStaleChallenges().catch(() => 0);

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const one = await getChallenge(id);
    if (!one) return NextResponse.json({ error: "Not found" }, { status: 404 });
    void logChallengeEvent({ type: "DETAIL_VIEWED", userId: user.id, challengeId: id });
    // Answer "can this viewer still counter?" here, with the same rule the
    // write path enforces, so the screen can hide an affordance that would
    // only be refused. Computing it again in the client would be a second
    // copy of the rule, free to drift; letting the screen offer the button
    // and find out on tap walks the user into a dead end.
    const counterBlock = counterRefusal(one, user.id, await challengeLimits(), new Date());
    return NextResponse.json({ challenge: one, viewerId: user.id, counterBlock });
  }

  const settings = await challengeSettings();
  // The Home card reads this endpoint for its copy on every render. Logging
  // that as a board view would make board views a count of Home renders, and
  // the impression-to-open step of the funnel would always read 100%.
  if (url.searchParams.get("for") !== "home") {
    void logChallengeEvent({
      type: "BOARD_VIEWED",
      userId: user.id,
      detail: url.searchParams.get("sport") || "all sports",
    });
  }
  const [board, mine] = await Promise.all([
    listOpenChallenges({ sport: url.searchParams.get("sport") || undefined }),
    listMyChallenges(user.id),
  ]);
  return NextResponse.json({
    enabled: settings.enabled,
    viewerId: user.id,
    board,
    mine,
    limits: {
      sports: settings.sports,
      minPlayers: settings.minPlayers,
      maxPlayers: settings.maxPlayers,
      maxWindows: settings.maxWindows,
      maxCountersPerSide: settings.maxCountersPerSide,
    },
    copy: {
      title: settings.boardTitle,
      subtitle: settings.boardSubtitle,
      empty: settings.emptyText,
    },
    homeCard: {
      enabled: settings.homeCardEnabled,
      title: settings.homeCardTitle,
      subtitle: settings.homeCardSubtitle,
      badge: settings.homeCardBadge,
    },
  });
}

const postSchema = z.object({
  op: z.literal("post"),
  sport: z.string().min(1),
  teamName: z.string().max(60).nullish(),
  playerCount: z.number().int(),
  notes: z.string().max(300).nullish(),
  windows: z.array(windowSchema).min(1).max(6),
});
const acceptSchema = z.object({
  op: z.literal("accept"),
  challengeId: z.string().min(1),
  windowId: z.string().min(1),
});
const counterSchema = z.object({
  op: z.literal("counter"),
  challengeId: z.string().min(1),
  window: windowSchema,
});
/** Taps that change nothing but are worth seeing: the home card, opening
 *  the post form, opening the counter picker. Without these the trail says
 *  who posted and nothing about who looked and walked away. */
const trackSchema = z.object({
  op: z.literal("track"),
  type: z.enum([
    "HOME_CARD_SHOWN",
    "HOME_CARD_TAPPED",
    "POST_OPENED",
    "ACCEPT_TAPPED",
    "COUNTER_OPENED",
  ]),
  challengeId: z.string().nullish(),
  detail: z.string().max(200).nullish(),
});
const withdrawSchema = z.object({
  op: z.literal("withdraw"),
  challengeId: z.string().min(1),
  reason: z.string().max(200).nullish(),
});

export async function POST(request: NextRequest) {
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = z
    .discriminatedUnion("op", [
      postSchema,
      acceptSchema,
      counterSchema,
      withdrawSchema,
      trackSchema,
    ])
    .safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  if (body.op === "track") {
    await logChallengeEvent({
      type: body.type,
      userId: user.id,
      challengeId: body.challengeId ?? null,
      detail: body.detail ?? null,
    });
    return NextResponse.json({ ok: true });
  }

  let result: { ok: boolean; error?: string; id?: string };
  if (body.op === "post") {
    result = await postChallenge({
      userId: user.id,
      sport: body.sport,
      teamName: body.teamName ?? null,
      playerCount: body.playerCount,
      notes: body.notes ?? null,
      windows: body.windows,
    });
  } else if (body.op === "accept") {
    result = await acceptChallengeWindow(body.challengeId, body.windowId, user.id);
  } else if (body.op === "counter") {
    result = await counterChallenge(body.challengeId, user.id, body.window);
  } else {
    result = await withdrawChallenge(body.challengeId, user.id, body.reason ?? undefined);
  }

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
