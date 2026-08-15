import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  transitionTournament,
  updateTournament,
  setTeamStatus,
  recordTeamPayment,
  adminRegisterTeam,
  adminEditTeam,
  rotateScorerCode,
  archiveTournamentTeam,
  deleteTournamentTeam,
  setTournamentArchived,
} from "@/actions/admin-tournaments";
import {
  autoAssignPools,
  createEmptyPools,
  clearPools,
  moveTeamToPool,
  generateFixtures,
  scheduleMatch,
  unscheduleMatch,
} from "@/actions/admin-tournament-fixtures";
import { enterMatchResult, reopenMatch } from "@/actions/admin-tournament-scores";
import {
  addTournamentSlot,
  deleteTournamentSlot,
  setMatchDuration,
  generateScheduleCandidates,
  approveSchedule,
} from "@/actions/admin-tournament-slots";
import {
  listCampaignItems,
  updateCampaignItem,
  sendCampaignItemNow,
} from "@/actions/admin-tournament-campaign";
import {
  createManualMatch,
  deleteManualMatch,
  reorderStageFixtures,
} from "@/actions/admin-tournament-manual-fixtures";
import {
  getOrganizerLedger,
  recordOrganizerPayment,
  deleteOrganizerPayment,
} from "@/actions/admin-tournament-organizer";

/**
 * POST /api/mobile/admin/tournaments/action — one dispatch endpoint for the
 * mobile admin manage screen. Ops mirror the web tabs:
 *   transition {tournamentId, to}
 *   teamStatus {teamId, status}
 *   collect {teamId, amount}
 *   venueRegister {tournamentId, teamName, captainName, captainPhone, members[], collectedAmount, method}
 *   editSquad {teamId, members[]} — stat-safe roster reconcile
 *   dealPools {tournamentId}
 *   generateFixtures {tournamentId}
 *   enterResult {matchId, result}
 *   rotateScorer {tournamentId}
 *   archiveTeam {teamId, archived}
 *   deleteTeam {teamId}
 * Every underlying server action re-gates on MANAGE_TOURNAMENTS itself.
 */
export async function POST(request: NextRequest) {
  const gate = await requireMobileAdmin(request, "MANAGE_TOURNAMENTS");
  if ("error" in gate) return gate.error;

  const body = await request.json().catch(() => ({}));
  const { op } = body || {};
  let result: { success?: boolean; ok?: boolean; error?: string } | undefined;

  if (op === "transition") result = await transitionTournament(body.tournamentId, body.to);
  else if (op === "teamStatus") result = await setTeamStatus(body.teamId, body.status);
  else if (op === "collect") result = await recordTeamPayment(body.teamId, Number(body.amount), body.method || "CASH");
  else if (op === "venueRegister") result = await adminRegisterTeam(body);
  else if (op === "editSquad")
    result = await adminEditTeam(String(body.teamId || ""), {
      members: Array.isArray(body.members) ? body.members.map((m: unknown) => String(m)) : [],
    });
  else if (op === "dealPools") result = await autoAssignPools(body.tournamentId);
  else if (op === "generateFixtures") result = await generateFixtures(body.tournamentId);
  else if (op === "enterResult") result = await enterMatchResult(body.matchId, body.result);
  // Web-only until now, which meant a scorer code could only be rotated
  // from a laptop — the one moment you most want a phone.
  else if (op === "rotateScorer") result = await rotateScorerCode(String(body.tournamentId || ""));
  else if (op === "archiveTeam")
    result = await archiveTournamentTeam(String(body.teamId || ""), body.archived !== false);
  else if (op === "deleteTeam") result = await deleteTournamentTeam(String(body.teamId || ""));
  // Third-party organiser billing. organizerLedger is a READ that returns
  // data rather than {success}, so it answers before the shared
  // success-shape handling below — that path always replies {success:true}
  // and would throw the ledger away.
  else if (op === "organizerLedger") {
    const ledger = await getOrganizerLedger(String(body.tournamentId || ""));
    if (!ledger) {
      return NextResponse.json({ error: "Not a third-party tournament" }, { status: 400 });
    }
    return NextResponse.json({ success: true, ledger });
  } else if (op === "organizerPay")
    result = await recordOrganizerPayment({
      tournamentId: String(body.tournamentId || ""),
      amount: Number(body.amount) || 0,
      method: body.method || "CASH",
      reference: body.reference || undefined,
      receivedAt: String(body.receivedAt || ""),
      note: body.note || undefined,
    });
  // Hand-entered fixtures — for schedules generateFixtures cannot derive
  // (a second leg, an odd number of semi-finals). Same action the web
  // admin uses, so the guards live in one place.
  else if (op === "addMatch")
    result = await createManualMatch({
      tournamentId: String(body.tournamentId || ""),
      stage: body.stage,
      roundLabel: String(body.roundLabel || ""),
      homeTeamId: body.homeTeamId || undefined,
      awayTeamId: body.awayTeamId || undefined,
      homeSourceLabel: body.homeSourceLabel || undefined,
      awaySourceLabel: body.awaySourceLabel || undefined,
    });
  // Date + court for a fixture. Was web-only, which meant the app could
  // create a match it could not then place on the calendar.
  else if (op === "scheduleMatch")
    result = await scheduleMatch(String(body.matchId || ""), {
      courtConfigId: String(body.courtConfigId || ""),
      date: String(body.date || ""),
      startHour: Number(body.startHour) || 0,
      hours: Number(body.hours) || 1,
    });
  else if (op === "unscheduleMatch")
    result = await unscheduleMatch(String(body.matchId || ""));
  else if (op === "deleteMatch")
    result = await deleteManualMatch(String(body.matchId || ""));
  else if (op === "archiveTournament")
    result = await setTournamentArchived(
      String(body.tournamentId || ""),
      body.archived !== false,
    );
  else if (op === "reorderFixtures")
    result = await reorderStageFixtures(
      String(body.tournamentId || ""),
      String(body.stage || ""),
      Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : [],
    );
  else if (op === "organizerPayDelete")
    result = await deleteOrganizerPayment(String(body.paymentId || ""));
  // ── Pools & Draw ──
  else if (op === "createEmptyPools") result = await createEmptyPools(String(body.tournamentId || ""));
  else if (op === "clearPools") result = await clearPools(String(body.tournamentId || ""));
  else if (op === "moveTeamToPool")
    result = await moveTeamToPool(
      String(body.teamId || ""),
      // null is meaningful — it unassigns the team — so an absent poolId
      // must not be coerced into the empty-string "no such pool".
      body.poolId == null ? null : String(body.poolId),
    );
  // ── Slots & Draw ──
  else if (op === "addSlot")
    result = await addTournamentSlot({
      tournamentId: String(body.tournamentId || ""),
      date: String(body.date || ""),
      startHour: Number(body.startHour) || 0,
      endHour: Number(body.endHour) || 0,
      courtConfigId: body.courtConfigId || undefined,
      label: body.label || undefined,
    });
  else if (op === "deleteSlot") result = await deleteTournamentSlot(String(body.slotId || ""));
  else if (op === "setMatchDuration")
    result = await setMatchDuration(String(body.tournamentId || ""), Number(body.minutes) || 0);
  // Both of these are READS that return plans, not a {success} shape, so
  // they answer here rather than fall through to the shared handling that
  // replies {success:true} and throws the payload away.
  else if (op === "scheduleCandidates") {
    const res = await generateScheduleCandidates(String(body.tournamentId || ""));
    if (!res.success) return NextResponse.json({ error: res.error || "Failed" }, { status: 400 });
    return NextResponse.json({ success: true, plans: res.plans });
  } else if (op === "approveSchedule")
    result = await approveSchedule(
      String(body.tournamentId || ""),
      Number(body.planIndex) || 0,
    );
  // ── Campaign ──
  else if (op === "campaignList") {
    const items = await listCampaignItems(String(body.tournamentId || ""));
    return NextResponse.json({ success: true, items });
  } else if (op === "campaignUpdate")
    result = await updateCampaignItem(String(body.itemId || ""), body.patch ?? {});
  else if (op === "campaignSend") result = await sendCampaignItemNow(String(body.itemId || ""));
  // ── Scores ──
  else if (op === "reopenMatch") result = await reopenMatch(String(body.matchId || ""));
  // ── Settings ── the same wizard payload the web Settings tab submits, so
  // validation lives in one place and the two can't diverge.
  else if (op === "updateTournament")
    result = await updateTournament(String(body.tournamentId || ""), body.input ?? {});
  else return NextResponse.json({ error: "Unknown op" }, { status: 400 });

  if (result && result.success === false) {
    return NextResponse.json({ error: result.error || "Failed" }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
