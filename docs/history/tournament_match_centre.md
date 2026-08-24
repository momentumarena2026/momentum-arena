---
name: tournament-match-centre
description: "ESPNcricinfo-style match centre (dev 2e97d2a): scorecard/commentary derived from the event log, pinned live card, scorer player tagging — how it fits together"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ab2a2c4-5e6a-4f62-9239-19e35bd79d9b
  modified: 2026-07-29T07:25:44.881Z
---

**ESPN-style match centre, built 2026-07-28 on `development` 2e97d2a (web + app).**

**Key design choice: everything is DERIVED, no new tables.** `lib/tournament-scorecard.ts` folds the SAME append-only `TournamentMatchEvent` log a second time into what a cricket follower expects — batting card (R/B/4s/6s/SR, dismissal), bowling card (O/R/W/Econ), fall of wickets, ball-by-ball commentary in ESPN's "Bowler to Batter, FOUR" voice, plus a computed `resultText`. Football/pickleball get the timeline as their card. One public route: `GET /api/tournaments/match/[matchId]` (`getMatchCentre`), shared by web and app.

**The attribution chain that makes it work:** the scorer console (`app/score/[code]/scorer-console.tsx`) now has striker / non-striker / bowler selects with automatic strike rotation on odd runs, so each BALL event carries `batterId` + `bowlerId` in `data`. Without tagging, scoring still works — innings totals and commentary appear, batting/bowling rows stay empty, and the UI falls back to the admin-entered `TournamentPlayerStat` table. Football has an optional goal-scorer select.

**Surfaces:** web `/tournaments/[slug]/match/[matchId]` (match-centre.tsx: header + Scorecard/Commentary/Info tabs, polls 5s while LIVE); app `TournamentMatch` route → `MatchCentreScreen.tsx` (same three tabs, `refetchInterval` only while LIVE). A pinned LIVE card sits above everything on both the web tournament centre and the app detail screen showing "30/1 (2.0 ov)" + target — it needs `liveState` on each match, which was added to the public route's select. Every decided match card now opens its centre; the matches list groups **Live now → upcoming by day → Results**. The old `/live/[matchId]` big-screen/TV view is kept as a secondary "Open the big-screen view" link.

**Native app scorer console (af4682d)**: `ScorerEntryScreen` (code input, validates by booting; last 5 codes remembered in MMKV via `lib/scorer-codes.ts`) + `ScorerConsoleScreen` (match picker → per-sport pad, player *chips* not pickers for one-handed tapping between balls). Both registered on the **ROOT stack**, deliberately NOT under AccountStack/AdminShell — the scorer code is the credential so a volunteer needs no account, same rule as web. Entry: Account tile "Score a match" + "Open scorer" button beside the code on the app admin tournament screen. Reuses the same public scorer routes, so all the security hardening applies unchanged. NOT yet run in a simulator — layouts unverified visually.

**Who's at the crease (ef9d311)** — the key architectural rule: **the fold owns who's out there, not the scorer's local state.** `foldCricket` produces a `current` block (strikerId/nonStrikerId/bowlerId + live figures, `thisOver` strip, partnership, `needsBatter`/`needsBowler`); football gets lastGoal+scorers; pickleball gets `servingTeamId`+gameNumber. Consoles read server-first (`liveCur?.strikerId || pickStriker`) so a reload or a second scorer never loses the crease; the local pick only fills a gap the server left open, and the pad still nominates the new striker after odd runs (the server only sees who *faced*). Audience surfaces render the same via `liveNow` on the match-centre API (names resolved server-side). Bug found in live testing and fixed: the over-end strike swap moved the striker into an empty non-striker slot, listing one player at both ends — guard is `if (cur.nonStrikerId)` before swapping plus a final `nonStrikerId === strikerId → null`.

**Scorer console layout (82068ec)** — the shape both web and app follow: **pinned scoreboard** (batting side + big score/overs + target + crease rows + over strip) that never scrolls, **run pad directly beneath** (whole console fits a 375pt screen), and **player selection in a sheet that opens itself** when the fold reports `needsBatter`/`needsBowler` ("Wicket — who's in?" / "Over complete — next bowler"); tapping a crease name opens it too. The previous version had 3 permanent chip lists (12 chips) between score and pad = ~2.5 screens of scrolling. RN gotcha: large numbers need an explicit `lineHeight` or the digits clip.

**Gotcha (cost 3 attempts, 71057cd): React Navigation v7 `navigate()` does NOT reliably bubble from a deeply nested navigator, and fails as a SILENT dead tap** — no error, no warning. `AdminTournamentsScreen` is 3 deep (More stack → admin tabs → AdminShell fullScreenModal); the scorer console was only on the root stack, so "Open scorer" did nothing. A `navigationRef`+`navigateRoot` helper did NOT fix it (papers over the hop). **The fix that works: register the destination in the caller's own stack** — `AdminScorerConsole` in AdminNavigator's MoreStack, same component. Rule of thumb: never hop navigators; register locally, or use an explicit `getParent()` from a known depth (what AccountScreen does for the root-level ScorerEntry).

Gotcha: mobile theme has no `colors.zinc100/zinc200` (use `colors.foreground` / `zinc300`). React Navigation `navigate()` bubbles to parent navigators, so no getParent() walk is needed to reach root routes from inside the admin shell (and a conditional `useNavigation()` would break the rules of hooks).

Related: [[tournament-engine-2026-07]], [[tournament-security-audit-2026-07-28]]
