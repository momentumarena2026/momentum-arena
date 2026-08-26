import type { TournamentWizardInput } from "@/lib/tournament-wizard-schema";

/**
 * The fields a duplicate copies. Also the exact `select` the action runs, so
 * the query and the mapper cannot drift apart — and so `scorerCode` is not
 * merely dropped later but never leaves the database, which matters because
 * this payload is serialised into the browser.
 */
export const DUPLICABLE_FIELDS = {
  name: true, sport: true, format: true,
  description: true, rules: true, bannerImageUrl: true,
  totalTeams: true, poolCount: true, teamsPerPool: true,
  advancePerPool: true, thirdPlaceMatch: true, bracketSeeding: true,
  membersPerTeamMin: true, membersPerTeamMax: true,
  maxOversPerBowler: true, oversPerInnings: true, wicketsPerInnings: true,
  host: true, organizerName: true, organizerPhone: true,
  organizerEmail: true, quotedAmount: true, organizerNote: true,
  entryFee: true, feeMode: true, advancePct: true,
  allowCoupons: true, allowRewardPoints: true, waitlistEnabled: true,
  pointsWin: true, pointsDraw: true, pointsLoss: true, tiebreakers: true,
  statFields: true, prizePool: true, prizes: true,
  liveScoringEnabled: true, liveScreenPlatform: true,
} as const;

/** The shape `DUPLICABLE_FIELDS` selects. */
export type DuplicableTournament = {
  name: string;
  sport: string;
  format: string;
  description: string | null;
  rules: string | null;
  bannerImageUrl: string | null;
  totalTeams: number;
  poolCount: number;
  teamsPerPool: number;
  advancePerPool: number;
  thirdPlaceMatch: boolean;
  bracketSeeding: string;
  membersPerTeamMin: number;
  membersPerTeamMax: number;
  maxOversPerBowler: number;
  oversPerInnings: number;
  wicketsPerInnings: number;
  host: string;
  organizerName: string | null;
  organizerPhone: string | null;
  organizerEmail: string | null;
  quotedAmount: number;
  organizerNote: string | null;
  entryFee: number;
  feeMode: string;
  advancePct: number;
  allowCoupons: boolean;
  allowRewardPoints: boolean;
  waitlistEnabled: boolean;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  tiebreakers: string[];
  statFields: unknown;
  prizePool: number | null;
  prizes: unknown;
  liveScoringEnabled: boolean;
  liveScreenPlatform: string;
};

/** Wizard date fields, all cleared on a duplicate. See the note below. */
const DATE_FIELDS = ["regOpenAt", "regCloseAt", "revealAt", "startDate", "endDate"] as const;

/** Schema ceiling for `name`; a suffixed long name must not blow past it. */
const NAME_MAX = 80;

export const COPY_SUFFIX = " (Copy)";

/**
 * Turn an existing tournament into a prefilled *create* payload.
 *
 * Pure and side-effect free: it builds the same object the wizard would have
 * produced had an admin typed every field, so the duplicate goes through
 * createTournament's existing validation, slug-uniqueness loop and campaign
 * drafting rather than a parallel copy path that could drift from them.
 *
 * **The five dates are cleared, deliberately.** Carrying them over is the one
 * genuinely dangerous default: a duplicate of last season would arrive with
 * registration already closed and a start date in the past, and the status
 * flow would publish it without complaint. Blank forces the admin to say when
 * this edition runs — which is the main thing that changes between editions.
 *
 * Not represented here at all, because they are not wizard fields: slug,
 * status, archivedAt, createdBy and scorerCode (all owned by
 * createTournament), and every child row — teams, pools, fixtures, slots,
 * player stats, organiser payments. A duplicate is a template, not a fork of
 * a running event.
 */
export function duplicateWizardInput(t: DuplicableTournament): TournamentWizardInput {
  const dates = Object.fromEntries(DATE_FIELDS.map((k) => [k, ""]));

  return {
    ...t,
    // Makes the new draft obviously distinct in a list that may now hold
    // several editions of the same cup. Truncated to the schema ceiling so a
    // long name cannot fail validation on a field the admin never touched.
    name: `${t.name}${COPY_SUFFIX}`.slice(0, NAME_MAX),
    // The wizard's text inputs are controlled and cannot take null.
    description: t.description || "",
    rules: t.rules || "",
    bannerImageUrl: t.bannerImageUrl || "",
    organizerName: t.organizerName || "",
    organizerPhone: t.organizerPhone || "",
    organizerEmail: t.organizerEmail || "",
    organizerNote: t.organizerNote || "",
    ...dates,
    statFields: (t.statFields ?? []) as TournamentWizardInput["statFields"],
    prizes: (t.prizes ?? []) as TournamentWizardInput["prizes"],
  } as TournamentWizardInput;
}
