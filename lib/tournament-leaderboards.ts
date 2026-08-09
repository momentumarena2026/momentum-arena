import { db } from "@/lib/db";

/**
 * Top scorers per configured stat key.
 *
 * Shared by the public tournament page and the admin Leaders tab so the
 * organiser is looking at exactly what the teams are looking at — a
 * separate admin query would eventually disagree about ties or cut-offs.
 */

export type LeaderRow = {
  memberId: string;
  name: string;
  teamName: string;
  teamColor: string | null;
  value: number;
};

export type Leaderboard = {
  key: string;
  label: string;
  rows: LeaderRow[];
};

export async function getTournamentLeaderboards(
  tournamentId: string,
  statFields: { key: string; label: string }[],
  take = 10,
): Promise<Leaderboard[]> {
  return Promise.all(
    statFields.map(async (sf) => {
      const rows = await db.tournamentPlayerStat.groupBy({
        by: ["memberId"],
        where: { tournamentId, statKey: sf.key },
        _sum: { value: true },
        orderBy: { _sum: { value: "desc" } },
        take,
      });
      const members = await db.tournamentTeamMember.findMany({
        where: { id: { in: rows.map((r) => r.memberId) } },
        select: {
          id: true,
          name: true,
          team: { select: { name: true, color: true } },
        },
      });
      const memberMap = new Map(members.map((m) => [m.id, m]));
      return {
        key: sf.key,
        label: sf.label,
        rows: rows.flatMap((r) => {
          const mem = memberMap.get(r.memberId);
          return mem
            ? [
                {
                  memberId: r.memberId,
                  name: mem.name,
                  teamName: mem.team.name,
                  teamColor: mem.team.color,
                  value: r._sum.value || 0,
                },
              ]
            : [];
        }),
      };
    }),
  );
}
