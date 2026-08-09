import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  transitionTournament,
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
  generateFixtures,
  scheduleMatch,
  unscheduleMatch,
} from "@/actions/admin-tournament-fixtures";
import { enterMatchResult } from "@/actions/admin-tournament-scores";
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
  else return NextResponse.json({ error: "Unknown op" }, { status: 400 });

  if (result && result.success === false) {
    return NextResponse.json({ error: result.error || "Failed" }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
