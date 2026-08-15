import type { AdminTournamentDetail } from "../../../lib/admin-tournaments";

/**
 * The tab strip, defined once.
 *
 * Deliberately mirrors the web manage screen's list — same keys, same
 * order, same conditions — because the two are the same job done on two
 * screen sizes. An organiser who learns the tabs on a laptop should not
 * have to re-learn them at the venue, and a tab that exists on only one
 * surface is a feature someone can't find when it matters.
 *
 * Keep in step with app/(admin)/admin/tournaments/[id]/tournament-manage.tsx.
 */
export type TabKey =
  | "overview"
  | "teams"
  | "pools"
  | "slots"
  | "fixtures"
  | "scores"
  | "table"
  | "bracket"
  | "leaders"
  | "campaign"
  | "organizer"
  | "settings";

export function tabsFor(t: AdminTournamentDetail): { key: TabKey; label: string }[] {
  return [
    { key: "overview", label: "Overview" },
    { key: "teams", label: `Teams (${t.teams.length})` },
    // Pools only exist in a format that has them.
    ...(t.format === "POOLS_KNOCKOUT"
      ? ([{ key: "pools", label: "Pools & Draw" }] as const)
      : []),
    { key: "slots", label: "Slots & Draw" },
    { key: "fixtures", label: `Fixtures (${t.matches.length})` },
    { key: "scores", label: "Scores" },
    // A pure knockout has no points table; a league has no bracket.
    ...(t.format === "KNOCKOUT"
      ? ([] as const)
      : ([{ key: "table", label: "Points Table" }] as const)),
    ...(t.format === "LEAGUE"
      ? ([] as const)
      : ([{ key: "bracket", label: "Bracket" }] as const)),
    { key: "leaders", label: "Leaders" },
    { key: "campaign", label: "Campaign" },
    // Organiser money exists only when someone outside the venue is paying
    // us for the hire; our own events take money from the teams instead.
    ...(t.host === "THIRD_PARTY"
      ? ([{ key: "organizer", label: "Organiser & Payments" }] as const)
      : []),
    { key: "settings", label: "Settings" },
  ] as { key: TabKey; label: string }[];
}

/** Fixture groups, in the order a tournament is played. */
export const FIXTURE_STAGES = [
  "POOL",
  "LEAGUE",
  "R16",
  "QF",
  "SF",
  "THIRD_PLACE",
  "FINAL",
];

export const FIXTURE_STAGE_LABEL: Record<string, string> = {
  POOL: "Pool stage",
  LEAGUE: "League",
  R16: "Round of 16",
  QF: "Quarter finals",
  SF: "Semi finals",
  THIRD_PLACE: "Third place",
  FINAL: "Final",
};

/** Knockout rounds only — what the Bracket tab draws, in playing order. */
export const BRACKET_STAGES = ["R16", "QF", "SF", "THIRD_PLACE", "FINAL"];

/** Lifecycle transitions, mirrored from lib/tournament-config STATUS_FLOW. */
export const FLOW: Record<string, string[]> = {
  DRAFT: ["PUBLISHED", "CANCELLED"],
  PUBLISHED: ["REG_OPEN", "CANCELLED"],
  REG_OPEN: ["REG_CLOSED", "CANCELLED"],
  REG_CLOSED: ["REG_OPEN", "POOLS_REVEALED", "LIVE", "CANCELLED"],
  POOLS_REVEALED: ["LIVE", "CANCELLED"],
  LIVE: ["COMPLETED", "CANCELLED"],
};

export const TRANSITION_LABEL: Record<string, string> = {
  PUBLISHED: "Publish",
  REG_OPEN: "Open Registrations",
  REG_CLOSED: "Close Registrations",
  POOLS_REVEALED: "Reveal Pools",
  LIVE: "Go Live",
  COMPLETED: "Complete",
  CANCELLED: "Cancel",
};
