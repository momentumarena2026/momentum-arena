import { NextRequest, NextResponse } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-admin-guard";
import {
  transitionTournament,
  setTeamStatus,
  recordTeamPayment,
  adminRegisterTeam,
} from "@/actions/admin-tournaments";
import {
  autoAssignPools,
  generateFixtures,
} from "@/actions/admin-tournament-fixtures";
import { enterMatchResult } from "@/actions/admin-tournament-scores";

/**
 * POST /api/mobile/admin/tournaments/action — one dispatch endpoint for the
 * mobile admin manage screen. Ops mirror the web tabs:
 *   transition {tournamentId, to}
 *   teamStatus {teamId, status}
 *   collect {teamId, amount}
 *   venueRegister {tournamentId, teamName, captainName, captainPhone, members[], collectedAmount, method}
 *   dealPools {tournamentId}
 *   generateFixtures {tournamentId}
 *   enterResult {matchId, result}
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
  else if (op === "dealPools") result = await autoAssignPools(body.tournamentId);
  else if (op === "generateFixtures") result = await generateFixtures(body.tournamentId);
  else if (op === "enterResult") result = await enterMatchResult(body.matchId, body.result);
  else return NextResponse.json({ error: "Unknown op" }, { status: 400 });

  if (result && result.success === false) {
    return NextResponse.json({ error: result.error || "Failed" }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
