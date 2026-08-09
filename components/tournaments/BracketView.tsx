"use client";

import { Trophy } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Knockout bracket — the classic shape, with the connector lines drawn.
 *
 * The layout is recursive rather than column-by-column, and that is the
 * whole trick: a match renders its two feeder matches to its left and
 * centres itself against them, so the elbows line up exactly without
 * measuring anything in JavaScript. A column-based layout has to guess at
 * vertical offsets and drifts the moment a round has an odd shape.
 *
 * The tree is built from homeSourceMatchId / awaySourceMatchId, so it
 * follows however the bracket was actually wired. A match with no source
 * matches is a leaf: that is the first knockout round, whether the teams
 * came from pools, seeding, or were placed by hand.
 */

export type BracketMatch = {
  id: string;
  stage: string;
  sequence: number;
  roundLabel: string | null;
  status: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeSourceMatchId?: string | null;
  awaySourceMatchId?: string | null;
  homeSourceLabel: string | null;
  awaySourceLabel: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homeScoreNote?: string | null;
  awayScoreNote?: string | null;
  winnerTeamId: string | null;
};

export type BracketTeam = {
  id: string;
  name: string;
  color?: string | null;
  logoUrl?: string | null;
};

const KO_STAGES = ["R64", "R32", "R16", "QF", "SF", "FINAL"];

const STAGE_TITLE: Record<string, string> = {
  R64: "Round of 64",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter Finals",
  SF: "Semi Finals",
  FINAL: "Final",
};

type Node = { match: BracketMatch; feeders: Node[] };

/** Depth of the deepest chain, i.e. how many columns to draw. */
function depthOf(n: Node): number {
  return n.feeders.length === 0 ? 1 : 1 + Math.max(...n.feeders.map(depthOf));
}

export function BracketView({
  matches,
  teams,
  renderBadge,
  onMatchClick,
  emptyText = "The bracket appears once knockout fixtures are generated.",
}: {
  matches: BracketMatch[];
  teams: Map<string, BracketTeam>;
  renderBadge?: (team: BracketTeam | null) => ReactNode;
  onMatchClick?: (m: BracketMatch) => void;
  emptyText?: string;
}) {
  const ko = matches.filter((m) => KO_STAGES.includes(m.stage));
  const third = matches.filter((m) => m.stage === "THIRD_PLACE");

  if (ko.length === 0) {
    return (
      <p className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-500">
        {emptyText}
      </p>
    );
  }

  const byId = new Map(ko.map((m) => [m.id, m]));
  // Anything named as another match's source is an inner node; whatever is
  // left unreferenced is a root. Normally that is just the final, but a
  // half-wired bracket can leave several, and drawing them all beats
  // rendering nothing.
  const referenced = new Set<string>();
  for (const m of ko) {
    if (m.homeSourceMatchId) referenced.add(m.homeSourceMatchId);
    if (m.awaySourceMatchId) referenced.add(m.awaySourceMatchId);
  }

  const build = (m: BracketMatch, seen: Set<string>): Node => {
    // seen guards against a cyclic wiring taking the renderer down with it.
    seen.add(m.id);
    const feeders = [m.homeSourceMatchId, m.awaySourceMatchId]
      .map((id) => (id && !seen.has(id) ? byId.get(id) : undefined))
      .filter((x): x is BracketMatch => !!x)
      .map((x) => build(x, seen));
    return { match: m, feeders };
  };

  const roots = ko
    .filter((m) => !referenced.has(m.id))
    .sort(
      (a, b) =>
        KO_STAGES.indexOf(b.stage) - KO_STAGES.indexOf(a.stage) ||
        a.sequence - b.sequence,
    )
    .map((m) => build(m, new Set()));

  const columns = Math.max(...roots.map(depthOf));

  // Column headings. The deepest chain ends at the root's stage, so walking
  // back that many stages from it names each column left to right.
  const rootStage = roots[0]?.match.stage ?? "FINAL";
  const endIdx = KO_STAGES.indexOf(rootStage);
  const headings = KO_STAGES.slice(Math.max(0, endIdx - columns + 1), endIdx + 1);

  const champion =
    roots.length === 1 && roots[0].match.stage === "FINAL"
      ? roots[0].match.winnerTeamId
      : null;

  return (
    <div className="overflow-x-auto pb-4">
      <div className="min-w-max">
        <div className="flex">
          {headings.map((st) => (
            <div
              key={st}
              className="w-[248px] shrink-0 pb-3 text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
            >
              {STAGE_TITLE[st] ?? st}
            </div>
          ))}
          {champion && (
            <div className="w-[248px] shrink-0 pb-3 text-center text-[11px] font-semibold uppercase tracking-wider text-emerald-500">
              Champion
            </div>
          )}
        </div>

        <div className="flex flex-col gap-8">
          {roots.map((root) => (
            <div key={root.match.id} className="flex items-center">
              <BracketNode
                node={root}
                teams={teams}
                renderBadge={renderBadge}
                onMatchClick={onMatchClick}
              />
              {champion && (
                <>
                  <Elbow />
                  <div className="w-[220px] shrink-0">
                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
                      <div className="flex items-center gap-2">
                        {renderBadge?.(teams.get(champion) ?? null)}
                        <span className="truncate text-sm font-bold text-emerald-300">
                          {teams.get(champion)?.name ?? "—"}
                        </span>
                      </div>
                    </div>
                    <Trophy className="mx-auto mt-3 h-9 w-9 text-amber-400" />
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {third.length > 0 && (
          <div className="mt-8">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Third place
            </div>
            <div className="flex gap-4">
              {third.map((m) => (
                <div key={m.id} className="w-[220px]">
                  <MatchBox
                    match={m}
                    teams={teams}
                    renderBadge={renderBadge}
                    onMatchClick={onMatchClick}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Horizontal run of line between a match and the next round. */
function Elbow() {
  return <span className="h-px w-7 shrink-0 bg-zinc-700" />;
}

function BracketNode({
  node,
  teams,
  renderBadge,
  onMatchClick,
}: {
  node: Node;
  teams: Map<string, BracketTeam>;
  renderBadge?: (team: BracketTeam | null) => ReactNode;
  onMatchClick?: (m: BracketMatch) => void;
}) {
  const { match, feeders } = node;

  return (
    <div className="flex items-center">
      {feeders.length > 0 && (
        <div className="flex flex-col">
          {feeders.map((f, i) => (
            <div key={f.match.id} className="relative flex items-center py-2">
              <BracketNode
                node={f}
                teams={teams}
                renderBadge={renderBadge}
                onMatchClick={onMatchClick}
              />
              <Elbow />
              {/* Half of the vertical spine: the upper feeder draws from its
                  own centre downwards, the lower one draws up to its centre.
                  Together they meet at the parent's centre line. A lone
                  feeder draws none, so no stub hangs off into space. */}
              {feeders.length > 1 && (
                <span
                  className={`absolute right-0 w-px bg-zinc-700 ${
                    i === 0 ? "top-1/2 bottom-0" : "top-0 bottom-1/2"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {feeders.length > 0 && <Elbow />}
      <div className="w-[220px] shrink-0">
        <MatchBox
          match={match}
          teams={teams}
          renderBadge={renderBadge}
          onMatchClick={onMatchClick}
        />
      </div>
    </div>
  );
}

function MatchBox({
  match: m,
  teams,
  renderBadge,
  onMatchClick,
}: {
  match: BracketMatch;
  teams: Map<string, BracketTeam>;
  renderBadge?: (team: BracketTeam | null) => ReactNode;
  onMatchClick?: (m: BracketMatch) => void;
}) {
  const live = m.status === "LIVE";
  const sides = [
    {
      id: m.homeTeamId,
      label: m.homeTeamId ? teams.get(m.homeTeamId)?.name : m.homeSourceLabel,
      score: m.homeScore,
      note: m.homeScoreNote,
    },
    {
      id: m.awayTeamId,
      label: m.awayTeamId ? teams.get(m.awayTeamId)?.name : m.awaySourceLabel,
      score: m.awayScore,
      note: m.awayScoreNote,
    },
  ];

  const Wrapper = onMatchClick ? "button" : "div";

  return (
    <Wrapper
      {...(onMatchClick
        ? { onClick: () => onMatchClick(m), type: "button" as const }
        : {})}
      className={`block w-full overflow-hidden rounded-xl border text-left ${
        live ? "border-red-500/50" : "border-zinc-800"
      } bg-zinc-900/70 ${onMatchClick ? "transition-colors hover:border-zinc-600" : ""}`}
    >
      <div className="flex items-center justify-between bg-zinc-900 px-2.5 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
        <span className="truncate">{m.roundLabel || STAGE_TITLE[m.stage] || m.stage}</span>
        {live && <span className="font-semibold text-red-400">● Live</span>}
      </div>
      {sides.map((s, i) => {
        const won = !!m.winnerTeamId && s.id === m.winnerTeamId;
        return (
          <div
            key={i}
            className={`flex items-center gap-2 px-2.5 py-1.5 ${
              i === 0 ? "border-b border-zinc-800/80" : ""
            }`}
          >
            {/* The accent bar is what makes a glanced-at bracket readable:
                green means this side went through. */}
            <span
              className={`h-6 w-1 shrink-0 rounded-sm ${
                won ? "bg-emerald-500" : "bg-zinc-700"
              }`}
            />
            {renderBadge?.(s.id ? (teams.get(s.id) ?? null) : null)}
            <span
              className={`flex-1 truncate text-[13px] ${
                won
                  ? "font-semibold text-emerald-300"
                  : s.id
                    ? "text-zinc-300"
                    : "italic text-zinc-600"
              }`}
            >
              {s.label || "TBD"}
            </span>
            {s.note ? (
              <span className="shrink-0 text-[11px] text-zinc-400">{s.note}</span>
            ) : s.score != null ? (
              <span
                className={`shrink-0 text-[13px] font-bold ${
                  won ? "text-emerald-400" : "text-zinc-400"
                }`}
              >
                {s.score}
              </span>
            ) : null}
          </div>
        );
      })}
    </Wrapper>
  );
}
