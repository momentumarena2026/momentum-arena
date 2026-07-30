import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  CalendarClock,
  ChevronRight,
  Gift,
  Radio,
  RotateCw,
  Trophy,
} from "lucide-react";

// The tournament operator's manual, rendered inside the admin so it is
// always one click away from the screens it describes. Pure static JSX —
// no data fetching — so it can never 500 during a live event.

export const metadata = { title: "Tournaments — How to use" };

/* ── building blocks ────────────────────────────────────────────── */

function Section({
  id,
  no,
  title,
  children,
}: {
  id: string;
  no: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <h2 className="flex items-baseline gap-3 border-b border-zinc-800 pb-2 text-xl font-bold text-white">
        <span className="font-mono text-sm text-emerald-500">{no}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-zinc-300">{children}</p>;
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3 text-sm text-zinc-300">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600/20 text-[11px] font-bold text-emerald-400">
            {i + 1}
          </span>
          <span className="leading-relaxed">{s}</span>
        </li>
      ))}
    </ol>
  );
}

function Note({ tone = "info", children }: { tone?: "info" | "warn" | "danger"; children: React.ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-amber-500/40 bg-amber-600/10 text-amber-200"
      : tone === "danger"
        ? "border-red-500/40 bg-red-600/10 text-red-200"
        : "border-sky-500/40 bg-sky-600/10 text-sky-200";
  return <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${cls}`}>{children}</div>;
}

function FieldTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-zinc-800/60 last:border-0">
              <td className="w-52 shrink-0 bg-zinc-900/60 px-4 py-2.5 align-top font-medium text-zinc-200">{k}</td>
              <td className="px-4 py-2.5 text-zinc-400">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A framed "this is what the screen looks like" mock. */
function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-700 shadow-lg shadow-black/30">
      <div className="flex items-center gap-2 border-b border-zinc-700 bg-zinc-800 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" />
        <span className="text-xs text-zinc-400">{title}</span>
      </div>
      <div className="space-y-3 bg-zinc-950 p-4">{children}</div>
    </div>
  );
}

function MockInput({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium text-zinc-500">{label}</div>
      <div className="truncate rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-white">{value}</div>
      {hint && <div className="mt-1 text-[10px] text-zinc-600">{hint}</div>}
    </div>
  );
}

function Flow({ nodes }: { nodes: { label: string; sub?: string; tone?: string }[] }) {
  return (
    <div className="flex flex-wrap items-stretch gap-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      {nodes.map((n, i) => (
        <div key={i} className="flex items-center">
          <div
            className={`rounded-lg border px-3 py-2 text-center ${
              n.tone === "live"
                ? "border-red-500/40 bg-red-600/10"
                : n.tone === "done"
                  ? "border-emerald-500/40 bg-emerald-600/10"
                  : "border-zinc-700 bg-zinc-900"
            }`}
          >
            <div className="text-xs font-semibold text-white">{n.label}</div>
            {n.sub && <div className="mt-0.5 max-w-[150px] text-[10px] leading-tight text-zinc-500">{n.sub}</div>}
          </div>
          {i < nodes.length - 1 && <ChevronRight className="mx-1 h-4 w-4 shrink-0 text-zinc-600" />}
        </div>
      ))}
    </div>
  );
}

const TOC = [
  ["overview", "What this module does"],
  ["lifecycle", "The lifecycle at a glance"],
  ["prereqs", "Before you start"],
  ["create", "Step 1 · Create the tournament"],
  ["registrations", "Step 2 · Open registrations"],
  ["teams", "Step 3 · Manage teams & payments"],
  ["pools", "Step 4 · Deal pools & reveal"],
  ["fixtures", "Step 5 · Generate fixtures"],
  ["schedule", "Step 6 · Schedule matches (slot blocking)"],
  ["live", "Step 7 · Live scoring"],
  ["scores", "Step 8 · Enter or fix results"],
  ["bracket", "Step 9 · Standings, seeding & bracket"],
  ["complete", "Step 10 · Complete & award prizes"],
  ["campaign", "Marketing autopilot"],
  ["audience", "What customers see"],
  ["rules", "Rules the system enforces"],
  ["faq", "Troubleshooting & FAQ"],
] as const;

export default function TournamentDocsPage() {
  return (
    <div className="mx-auto flex max-w-6xl gap-8">
      {/* ── sticky contents ── */}
      <nav className="sticky top-6 hidden h-fit w-60 shrink-0 space-y-1 lg:block">
        <Link
          href="/admin/tournaments"
          className="mb-3 flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Tournaments
        </Link>
        {TOC.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="block rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-white">
            {label}
          </a>
        ))}
      </nav>

      <div className="min-w-0 flex-1 space-y-12 pb-24">
        <div>
          <div className="flex items-center gap-2 text-emerald-400">
            <BookOpen className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-wider">Operator&apos;s manual</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold text-white">Tournaments — how to use</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Everything from creating a tournament to handing over the trophy, in the order you&apos;ll actually do it.
            Every screen referenced here lives under <span className="text-zinc-200">Admin → Tournaments</span>.
          </p>
        </div>

        {/* 1 ─────────────────────────────────────────────────────── */}
        <Section id="overview" no="01" title="What this module does">
          <P>
            One tournament record drives everything: the public page customers register on (web and app), team and
            payment management, pool draws, fixtures, court blocking, ball-by-ball live scoring, points tables, the
            knockout bracket, leaderboards, marketing pushes and prize handout. You configure it once in the wizard;
            the rest is transitions and taps.
          </P>
          <FieldTable
            rows={[
              ["Formats", "League (one round-robin table) · Knockout (bracket only) · Pools → Knockout (pools feed a bracket)"],
              ["Sports", "Cricket (ball-by-ball), Football (clock + goals + cards), Pickleball (rally points + games)"],
              ["Pool", "A round-robin group. Top N (Advance / Pool) qualify for the knockout."],
              ["Seed", "A qualifier's rank entering the bracket. Seed #1 meets the weakest path."],
              ["Bye / Walkover", "When qualifiers aren't a power of 2, a bracket slot is empty — the team drawn against it advances automatically."],
              ["Scorer code", "A 10-character code that IS the scorer's login. Anyone holding it can score this tournament's matches — nothing else."],
            ]}
          />
        </Section>

        {/* 2 ─────────────────────────────────────────────────────── */}
        <Section id="lifecycle" no="02" title="The lifecycle at a glance">
          <P>
            A tournament moves through fixed statuses. The buttons for each move live at the top of the tournament&apos;s
            manage page, and only legal moves are offered. Automatic side-effects are noted under each stage.
          </P>
          <Flow
            nodes={[
              { label: "DRAFT", sub: "invisible to customers" },
              { label: "PUBLISHED", sub: "public page live, registrations closed" },
              { label: "REG_OPEN", sub: "🚀 push + banner fire" },
              { label: "REG_CLOSED", sub: "deal pools now" },
              { label: "POOLS_REVEALED", sub: "draw ceremony plays · 🔔 push" },
              { label: "LIVE", sub: "scoring on · 🔔 push", tone: "live" },
              { label: "COMPLETED", sub: "👑 champion push · 🎟 prize passes minted", tone: "done" },
            ]}
          />
          <Note>
            League and Knockout formats skip <b>POOLS_REVEALED</b> — they go straight from REG_CLOSED to LIVE.
            <b> CANCELLED</b> is available from every stage before completion. COMPLETED and CANCELLED are final.
          </Note>
        </Section>

        {/* 3 ─────────────────────────────────────────────────────── */}
        <Section id="prereqs" no="03" title="Before you start">
          <Steps
            items={[
              <>Your admin account needs the <b>MANAGE_TOURNAMENTS</b> permission (Settings → Admin Users).</>,
              <>The sport&apos;s courts must exist and be active (Courts &amp; Pricing → Sports) — the schedule form and the prize-pass editor both pick from them.</>,
              <>The module master switch on the Tournaments list page must be ON, or customers see nothing anywhere (web pages, app hub, homepage buttons all hide).</>,
              <>If you&apos;ll take online entry fees, the payment gateway must be configured as for any booking (Razorpay / PhonePe DQR).</>,
            ]}
          />
        </Section>

        {/* 4 ─────────────────────────────────────────────────────── */}
        <Section id="create" no="04" title="Step 1 · Create the tournament">
          <P>
            <b>Tournaments → New Tournament</b> opens the wizard. It saves as a DRAFT you can edit any time; nothing is
            public until you publish. The wizard has seven numbered cards — every field below.
          </P>

          <h3 className="pt-2 font-semibold text-white">1 · Basics</h3>
          <FieldTable
            rows={[
              ["Tournament Name", "Public everywhere. Also generates the page URL (slug)."],
              ["Sport", "Decides the scoring engine, stat fields and which courts are offered. Not changeable after matches exist in practice."],
              ["Hero Banner Image", "Upload — shown on the public page and app cards."],
              ["Description / Rules", "Shown on the public page. Rules accept markdown — put playing conditions here (e.g. “10 overs a side”)."],
            ]}
          />

          <h3 className="pt-2 font-semibold text-white">2 · Format &amp; structure</h3>
          <FieldTable
            rows={[
              ["Total Teams", "Capacity. Registrations beyond it go to the waitlist (if enabled)."],
              ["Pools / Teams per Pool / Advance per Pool", "Pools × teams-per-pool must equal Total Teams. Advance = how many qualify from each pool."],
              ["3rd-place match", "Adds a bronze final between the semi-final losers."],
              ["Min / Max Members per Team", "Max is the squad cap. Min is display-only — captains can register alone and build the squad later."],
              ["Max Overs / Bowler (cricket)", "0 = no limit. The scorer console refuses a bowler at their quota."],
              ["Overs / Innings (cricket)", "0 = unlimited. The innings closes on the last legal ball; the pad locks itself."],
              ["Bracket Seeding (pools format)", "How qualifiers are seeded — see below."],
            ]}
          />

          <Screen title="Wizard · cricket fields with the capacity warning">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MockInput label="Max Members / Team *" value="5" />
              <MockInput label="Max Overs / Bowler" value="2" hint="scorer can't pick past this" />
              <MockInput label="Overs / Innings" value="10" hint="innings closes on last ball" />
              <MockInput label="Bracket Seeding" value="By overall record ▾" />
            </div>
            <div className="rounded-lg border border-amber-500/40 bg-amber-600/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
              ⚠ 5 bowlers × 2 overs is exactly 10 — no slack. Every bowler must bowl their full quota, and since none
              may bowl two overs in a row, one absentee or a mis-ordered rotation strands the last over.
            </div>
          </Screen>

          <Note tone="warn">
            <b>Bracket Seeding</b> matters whenever qualifiers aren&apos;t a power of 2 (e.g. 3 pools × 1 = one bye).
            <b> By pool</b> seeds A1, B1, C1… — Pool A&apos;s winner always takes the bye. <b>By overall record</b> ranks
            the qualifiers against each other (points → tiebreakers → runs scored) once every pool finishes, so the
            best team in the whole event earns the bye. For a 9-team / 3-pool cup, pick <b>By overall record</b>.
          </Note>

          <h3 className="pt-2 font-semibold text-white">3 · Fees &amp; registration</h3>
          <FieldTable
            rows={[
              ["Entry Fee (₹/team)", "What one team pays."],
              ["Fee Mode", "Full online · Advance online (a % now, rest at the venue — tracked as Due) · Free entry."],
              ["Allow coupons / reward points", "Whether checkout offers them. Points redeem against the online payable; unchecking hides AND blocks them."],
              ["Waitlist when full", "Extra registrations queue as WAITLISTED instead of being turned away."],
              ["Timeline dates", "Reg open/close · Pool reveal countdown target · Start / End. All venue wall-clock (IST)."],
            ]}
          />

          <h3 className="pt-2 font-semibold text-white">4 · Points &amp; tiebreakers · 5 · Player stats</h3>
          <FieldTable
            rows={[
              ["Points W/D/L", "Round-robin table points (default 2/1/0)."],
              ["Tiebreaker order", "Applied top-down when teams tie on points: Head-to-head, Score difference, Scores for, Name. Also used to rank qualifiers for overall-record seeding."],
              ["Player stat fields", "The leaderboards (e.g. runs, wickets). Live scoring fills them automatically; manual results can enter them per player."],
            ]}
          />

          <h3 className="pt-2 font-semibold text-white">6 · Prizes — including automatic pass prizes</h3>
          <P>
            Each prize row is a label shown on the public page (&quot;₹5,100 + Trophy&quot;). A row can additionally carry a
            <b> real pass</b> — click <b>Attach a free pass</b> and it will be created on the winning team&apos;s captain
            automatically the moment you complete the tournament.
          </P>
          <Screen title="Wizard · a prize row with a pass attached">
            <div className="flex gap-2">
              <MockInput label="Place" value="Runner-up" />
              <div className="flex-1">
                <MockInput label="Label (public)" value="Trophy + 1 hr free weekday pass (1 week validity)" />
              </div>
            </div>
            <div className="space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
              <div className="text-[11px] font-medium text-emerald-300">
                <Gift className="mr-1 inline h-3 w-3" />
                Free pass — issued automatically to this team&apos;s captain
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MockInput label="Award to" value="2nd place ▾" />
                <MockInput label="Court" value="Full Field ▾" />
                <MockInput label="Hours" value="1" />
                <MockInput label="Valid for (days)" value="7" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {["Weekday · Off-peak ✓", "Weekday · Peak ✓", "Weekend · Off-peak", "Weekend · Peak"].map((b) => (
                  <span
                    key={b}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] ${b.includes("✓") ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-zinc-700 text-zinc-500"}`}
                  >
                    {b}
                  </span>
                ))}
              </div>
              <div className="text-[10px] text-zinc-600">Bands: leave all off = any slot. Ticking only the two Weekday bands = weekday-only pass.</div>
            </div>
          </Screen>
          <FieldTable
            rows={[
              ["Award to", "Which finishing position receives it (1st–4th). The final decides 1st and 2nd; a 3rd-place match decides 3rd; a League uses the table."],
              ["Court / Hours / Valid for", "Exactly what the pass is worth and how long the winner has to use it (validity starts on completion day)."],
              ["Redeemable on", "Pricing-band chips. Restrict to weekday/weekend and peak/off-peak, or leave all off for any slot."],
              ["Pass name", "What it's called in the winner's My Passes. Defaults to “<tournament> — <place> Pass”."],
            ]}
          />

          <h3 className="pt-2 font-semibold text-white">7 · Live scoring</h3>
          <FieldTable
            rows={[
              ["Enable live scoring", "Turns on the ball-by-ball console and mints the scorer code."],
              ["Live screen platform", "Where the audience live screen is watchable: Both, App only (web shows a download-the-app upsell), Web only, or Off."],
            ]}
          />
        </Section>

        {/* 5 ─────────────────────────────────────────────────────── */}
        <Section id="registrations" no="05" title="Step 2 · Open registrations">
          <Steps
            items={[
              <>On the manage page press <b>Publish</b> — the public page goes live at <span className="font-mono text-xs">/tournaments/&lt;slug&gt;</span> and in the app hub, showing “registrations open soon”.</>,
              <>Press <b>Open registrations</b> when ready (the Reg-open date is informational — the button is the switch). The 🚀 campaign push fires if enabled.</>,
              <>Customers register from the public page or the app: team name, colour, captain details — <b>squad members are optional</b>; captains can add them any time later from “Your team”.</>,
              <>They pay per the fee mode — Razorpay card/UPI or PhonePe dynamic QR, minus coupons/points if allowed. Payment-first: a team only becomes CONFIRMED when the money is verified.</>,
              <>When capacity fills, new teams become WAITLISTED (if enabled) — promote them from the Teams tab if a spot opens.</>,
              <>Walk-ins: <b>Teams tab → Register team (venue)</b> takes cash / static-QR / free entries without the customer touching a phone.</>,
            ]}
          />
          <Note>
            A team&apos;s captain should register from their own account — the captain account is where a prize pass lands
            and where “Your team” squad editing lives. Venue-registered teams without a linked customer account can
            still win, but a pass prize will be skipped for them (you&apos;ll see the reason at completion).
          </Note>
        </Section>

        {/* 6 ─────────────────────────────────────────────────────── */}
        <Section id="teams" no="06" title="Step 3 · Manage teams & payments">
          <P>The <b>Teams tab</b> on the manage page is the roster office:</P>
          <FieldTable
            rows={[
              ["Statuses", "PENDING_PAYMENT (started checkout) · CONFIRMED (paid/approved — counts toward capacity) · WAITLISTED · REJECTED/WITHDRAWN."],
              ["Confirm / Reject", "Manual override for edge cases. Promoting to CONFIRMED recomputes any venue-due amount; rejecting refunds redeemed points automatically."],
              ["Collect payment", "Record a venue-side payment against a team's due (cash / static QR with UTR). The due amount tracks down to zero."],
              ["Edit squad", "Add, rename or remove players up to the squad cap. Players who already have recorded stats can't be removed — rename instead."],
              ["Captain badge", "The captain row is sticky — reassign rather than delete."],
            ]}
          />
        </Section>

        {/* 7 ─────────────────────────────────────────────────────── */}
        <Section id="pools" no="07" title="Step 4 · Deal pools & reveal">
          <Steps
            items={[
              <>Press <b>Close registrations</b> once the field is set (pools can only be dealt in REG_OPEN / REG_CLOSED).</>,
              <><b>Pools &amp; Draw tab → Auto-deal</b> shuffles every CONFIRMED team evenly into the pools. Drag any team to another pool to fix rivalries or venue constraints — re-dealing reshuffles everything.</>,
              <>Set a <b>Pool Reveal (countdown)</b> time in the wizard if you want suspense: the public page shows a countdown, and when you press <b>Reveal pools</b> every viewer&apos;s page plays the draw ceremony together. The 🔔 reveal push fires.</>,
            ]}
          />
          <Note tone="warn">Deal pools before generating fixtures — the fixture generator refuses pools with fewer than 2 teams.</Note>
        </Section>

        {/* 8 ─────────────────────────────────────────────────────── */}
        <Section id="fixtures" no="08" title="Step 5 · Generate fixtures">
          <P>
            <b>Fixtures tab → Generate fixtures</b> creates every match in one shot:
          </P>
          <FieldTable
            rows={[
              ["League", "A full round-robin — every team plays every other once."],
              ["Pools → Knockout", "A round-robin inside each pool, then the bracket skeleton: semi-finals/final wired with “Winner Pool A” / “Seed #2” placeholders that fill themselves as results land."],
              ["Knockout", "A randomly seeded bracket, byes auto-inserted when teams aren't a power of 2."],
            ]}
          />
          <P>
            For a 9-team, 3-pool, 1-qualifier cup with overall-record seeding you get 12 matches: 9 pool games,
            Semi Final 1 (<span className="font-mono text-xs">Seed #1 vs BYE</span> — resolves to a walkover),
            Semi Final 2 (<span className="font-mono text-xs">Seed #2 vs Seed #3</span>) and the Final.
          </P>
          <Note tone="danger">
            Regenerating wipes and rebuilds all fixtures (and frees their court blocks) — allowed only until the first
            match goes LIVE or COMPLETED. After that the button refuses.
          </Note>
        </Section>

        {/* 9 ─────────────────────────────────────────────────────── */}
        <Section id="schedule" no="09" title="Step 6 · Schedule matches — this is what blocks the courts">
          <P>
            Every match row on the <b>Fixtures tab</b> carries a <b>Schedule</b> button while the match is still
            unplayed. This is the only place a match gets its date, time and court — and scheduling is the exact
            moment the court hours are taken away from normal customer booking.
          </P>
          <Screen title="Fixtures tab · one match row with the schedule form open">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
              <div>
                <div className="text-[10px] uppercase text-zinc-500">Pool A · Match 1</div>
                <div className="text-xs text-white">
                  Vrindavan Vipers <span className="text-zinc-600">vs</span> Nandgaon Knights
                </div>
              </div>
              <span className="rounded-lg border border-sky-500/30 px-3 py-1.5 text-[11px] text-sky-400">Schedule</span>
            </div>
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <MockInput label="Court" value="Full Field ▾" />
              <MockInput label="Date" value="01/08/2026" />
              <MockInput label="Start" value="7:00 AM ▾" />
              <MockInput label="Duration" value="1 hour ▾" />
              <span className="rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-medium text-white">Save</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-[11px] text-zinc-300">
              <CalendarClock className="h-3.5 w-3.5 text-emerald-400" />
              Sat, 1 Aug, 7:00 am · Full Field · 1h
              <span className="ml-auto rounded border border-zinc-700 px-1.5 text-zinc-500">✕ unschedule</span>
            </div>
          </Screen>
          <P>What happens the moment you press Save:</P>
          <Steps
            items={[
              <>The system first checks for clashes — an existing customer booking on that court/date/hours, or another block (rain block, other tournament). A clash rejects the schedule with the reason; nothing is double-booked, ever.</>,
              <>One <b>slot block</b> is created per hour, labelled “Tournament: &lt;name&gt; — &lt;match&gt;”. From this instant those hours show as <b>blocked</b> in the customer booking grid on web and app — customers cannot book them.</>,
              <>The match card (admin, public page, app) shows the date, time and court.</>,
            ]}
          />
          <FieldTable
            rows={[
              ["When to schedule", "Any time after fixtures exist. Pool matches can be scheduled immediately; bracket matches can be scheduled before their teams are known — the card shows “Seed #1 vs …” until results fill it in."],
              ["Rescheduling", "Press ✕ to unschedule (this frees the blocked hours immediately), then Schedule again with the new slot."],
              ["Completed matches", "Can no longer be scheduled or unscheduled — their buttons disappear."],
              ["Bye matches", "Resolve as walkovers and never need a court — don't schedule them."],
              ["Seeing all blocks", "Courts & Pricing → Slot Blocks lists every block, tournament ones included, and the admin calendar shows them in place."],
            ]}
          />
        </Section>

        {/* 10 ────────────────────────────────────────────────────── */}
        <Section id="live" no="10" title="Step 7 · Live scoring (the scorer console)">
          <Steps
            items={[
              <>Press <b>Go live</b> on the manage page on match day (🔔 push fires). Live scoring must be enabled in the wizard.</>,
              <>Find the <b>scorer code</b> at the top of the manage page. Share it with whoever scores — no account needed. <RotateCw className="inline h-3 w-3" /> <b>Rotate</b> invalidates the old code instantly if it leaks.</>,
              <>The scorer opens the console: on the web at <span className="font-mono text-xs">/score/&lt;CODE&gt;</span> (the code on the manage page is a click-through link), or in the app via <b>Account → Score a match</b>. The app remembers recent codes.</>,
              <>Pick the match, press <b>Start Match</b>, then choose who bats first.</>,
            ]}
          />
          <Screen title="Scorer console · cricket">
            <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-3">
              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <span>‹ Matches</span>
                <span>Match 1</span>
                <span className="flex items-center gap-1 text-red-400">
                  <Radio className="h-3 w-3" /> LIVE
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-sm font-semibold text-white">Vrindavan Vipers</span>
                <span className="text-xl font-extrabold text-emerald-400">
                  91/2 <span className="text-xs font-medium text-zinc-500">(10.0)</span>
                </span>
              </div>
              <div className="mt-2 space-y-1 border-t border-zinc-800 pt-2 text-[11px]">
                <div className="flex justify-between text-zinc-200">
                  <span>Rohan Gupta *</span>
                  <span>34 (22)</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Kabir Singh</span>
                  <span>18 (15)</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Imran Khan</span>
                  <span className="font-mono">2.0–29–1</span>
                </div>
                <div className="flex gap-1 pt-1">
                  {["1", "4", "·", "W", "2", "6"].map((b, i) => (
                    <span
                      key={i}
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${b === "W" ? "bg-red-500/20 text-red-300" : b === "4" || b === "6" ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-800 text-zinc-300"}`}
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                ["0", "DOT"], ["1", "RUN"], ["2", "RUNS"], ["3", "RUNS"],
                ["4", "FOUR"], ["6", "SIX"], ["W", "OUT"], ["Wd", "WIDE"],
              ].map(([g, c]) => (
                <div
                  key={g}
                  className={`flex h-14 flex-col items-center justify-center rounded-xl border ${g === "W" ? "border-red-500/40 bg-red-600/10" : g === "4" || g === "6" ? "border-emerald-500/40 bg-emerald-600/10" : g === "Wd" ? "border-amber-500/40 bg-amber-600/10" : "border-zinc-700 bg-zinc-900"}`}
                >
                  <span className={`text-lg font-extrabold ${g === "W" ? "text-red-300" : g === "4" || g === "6" ? "text-emerald-300" : g === "Wd" ? "text-amber-300" : "text-white"}`}>{g}</span>
                  <span className="text-[8px] font-bold tracking-wider text-zinc-500">{c}</span>
                </div>
              ))}
            </div>
          </Screen>
          <P>How the console runs a cricket innings — the console asks for everything at the moment it&apos;s needed:</P>
          <Steps
            items={[
              <>It asks for the <b>opening striker and bowler</b> before the first ball — the pad stays locked behind an amber hint until both are picked.</>,
              <>Tap a key per delivery: 0–6 runs, <b>W</b> wicket, <b>Wd</b> wide, <b>Nb</b> no-ball, <b>B</b> bye. Wides/no-balls add a run and don&apos;t count the ball. Odd runs rotate strike automatically.</>,
              <>On a wicket the “who&apos;s in?” sheet opens by itself — dismissed batters are greyed out for the rest of the innings.</>,
              <>At the end of each over the bowler sheet opens — bowlers at their quota, and whoever bowled the last over, are greyed with the reason. Each row shows their spell (e.g. 1.0 ov / 2).</>,
              <>After the configured overs the innings locks itself (“Innings complete”). Press <b>End Innings</b>; the second innings shows the target and “need N more”.</>,
              <><b>Undo</b> removes the last event and recomputes everything — score, strike, spells, stats. Use it freely for fat fingers.</>,
              <>Press <b>End Match</b> when done. On a tie it asks you to pick the winner (super over / toss). The result feeds the table and bracket instantly.</>,
            ]}
          />
          <Note>
            Everything the console shows is computed on the server from the ball-by-ball log — a phone dying, a page
            reload or two scorers on two phones all see the same state. The audience match centre (scorecard,
            commentary, “batting now” panel) derives live from the same log.
          </Note>
          <P>
            <b>Football:</b> Start/stop the match clock, tap +1 on the scoring team (optionally tag scorer and
            assist — own goals tag the other side&apos;s player), record yellow/red cards. <b>Pickleball:</b> tap the
            rally winner per point, <b>End game</b> at each game&apos;s end; games won decide the match.
          </P>
        </Section>

        {/* 11 ────────────────────────────────────────────────────── */}
        <Section id="scores" no="11" title="Step 8 · Enter or fix results without live scoring">
          <P>
            The <b>Scores tab</b> records results directly — for matches you didn&apos;t live-score, or paper-scored games.
          </P>
          <Steps
            items={[
              <>Pick the match, enter both scores and optional notes (e.g. “91/2 in 10 ov”).</>,
              <>Equal scores: in a pool/league you may tick <b>Draw</b> or pick a winner; in a knockout you must pick the winner (super over / shootout).</>,
              <>Optionally add per-player stats (runs, wickets, goals…) — these feed the leaderboards — and a Player of the Match.</>,
              <>Saving marks the match COMPLETED and immediately updates the table, seeds and bracket.</>,
              <><b>Reopen</b> un-completes a match to fix a mis-entry — blocked once a later knockout match that consumed this result has itself been decided (fix that one first).</>,
            ]}
          />
        </Section>

        {/* 12 ────────────────────────────────────────────────────── */}
        <Section id="bracket" no="12" title="Step 9 · Standings, seeding & bracket — all automatic">
          <Flow
            nodes={[
              { label: "Result lands", sub: "console or Scores tab" },
              { label: "Pool table updates", sub: "points + tiebreakers" },
              { label: "Pool completes", sub: "ranks final" },
              { label: "Seeds resolve", sub: "all pools done (overall-record)" },
              { label: "Bracket fills", sub: "byes walk over" },
              { label: "Champion", tone: "done" },
            ]}
          />
          <FieldTable
            rows={[
              ["Standings", "Recomputed on every result from your points config, ties broken by the tiebreaker chain in order."],
              ["Pool-rank slots", "“Winner Pool A” fills as soon as that pool's last game finishes."],
              ["Overall-record seeds", "“Seed #1…#3” fill only when every pool is finished — a late result can reorder them, so they wait."],
              ["Byes", "The instant its opponent is known, a bye match auto-completes as a WALKOVER — no court, no scoring needed."],
              ["Winner-of chains", "Semi winners flow into the final (and losers into the 3rd-place match) automatically."],
            ]}
          />
        </Section>

        {/* 13 ────────────────────────────────────────────────────── */}
        <Section id="complete" no="13" title="Step 10 · Complete the tournament & award prizes">
          <Steps
            items={[
              <>When the final is decided, press <b>Complete</b> on the manage page. The 👑 champion push fires.</>,
              <>Every prize row with an attached pass is settled automatically: the system reads the finishing order (final → 1st/2nd, 3rd-place match → 3rd, league → table) and mints each pass onto that team&apos;s <b>captain account</b>, valid from today.</>,
              <>The winner sees it instantly in <b>My Passes</b> (web and app) and redeems it at checkout like any purchased pass. You manage it under <b>Promotions → Passes → Sold passes</b> (method shows “Gift”) — Extend / Adjust / Cancel all work on it.</>,
            ]}
          />
          <Screen title="Promotions → Passes · the minted prize pass">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-[11px]">
              <div>
                <div className="font-medium text-white">Radha Kund Royals Captain</div>
                <div className="text-zinc-500">Momentum Cup Runner-up Pass · bought 29 Jul</div>
              </div>
              <div className="flex items-center gap-3 text-zinc-300">
                <span>1h / 1h</span>
                <span>₹0</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5">Gift</span>
                <span>05 Aug</span>
                <span className="text-emerald-400">ACTIVE</span>
              </div>
            </div>
          </Screen>
          <Note tone="warn">
            A pass is skipped (never blocking completion) when the winning team has <b>no linked captain account</b>
            (venue-registered without a customer), or the pass&apos;s court was deactivated. Each slot is minted at most
            once — completing again after a correction can&apos;t double-award.
          </Note>
        </Section>

        {/* 14 ────────────────────────────────────────────────────── */}
        <Section id="campaign" no="14" title="Marketing autopilot (Campaign tab)">
          <P>
            Creating a tournament drafts seven campaign items — announcement, registrations-open, closing-soon,
            reveal-tonight, pools-revealed, we-are-live and champion. Each is a push notification to all app users
            plus (where an image is set) a homepage banner.
          </P>
          <FieldTable
            rows={[
              ["Automatic sends", "Opening registrations, revealing pools, going live and completing each fire their matching item — if it's still enabled."],
              ["Editing", "Rewrite title/body, attach an image, or toggle any item off in the Campaign tab before it fires."],
              ["Send now", "Fires an item manually — use it for “closing soon” and “reveal tonight”, which have no automatic trigger."],
            ]}
          />
        </Section>

        {/* 15 ────────────────────────────────────────────────────── */}
        <Section id="audience" no="15" title="What customers see">
          <FieldTable
            rows={[
              ["Tournament page", "Banner, prizes, format, rules, team wall, and tabs: Pool Reveal (countdown + ceremony), Points Table (with qualification zone), Bracket, Matches, Leaderboards."],
              ["Match centre", "Every match links to an ESPN-style page — full batting/bowling scorecard, fall of wickets, ball-by-ball commentary, and a “batting now / bowling” panel while live."],
              ["Live screen", "A big-screen scoreboard at /tournaments/<slug>/live/<match> (add ?tv=1 for the venue TV). Gated by the wizard's platform setting — App only shows web visitors a download upsell."],
              ["Your team", "Registered captains manage their squad from the tournament page (web) or the team card (app) any time."],
              ["App", "The 🏆 hub lists Active / Upcoming / Finished tournaments; detail, registration, match centre and live screens mirror the web."],
            ]}
          />
        </Section>

        {/* 16 ────────────────────────────────────────────────────── */}
        <Section id="rules" no="16" title="Rules the system enforces (so scorers can't break a match)">
          <P>
            Every rule is enforced on the server against the full match log — a scorer with the code cannot bypass
            them, and the console greys out illegal choices before the tap.
          </P>
          <FieldTable
            rows={[
              ["Cricket", "No ball without a striker AND a bowler · batter must be in the batting side, bowler in the fielding side · a dismissed batter can't return · no bowler bowls two overs in a row · per-bowler over quota · innings closes at the configured overs · innings ends at 10 wickets · exactly two innings, no team bats twice."],
              ["Football", "Goal needs a team; scorer must be in it (own goal: the other side) · assist must be a team-mate, never the scorer, never on an own goal · no card after a red, no third yellow · clock can't start twice or stop when idle."],
              ["Pickleball", "Point needs a side; tagged player must be in it · a game can't end 0-0 or level."],
              ["Everyone", "Runs per ball capped at 12 · undo works only while the match is LIVE · results only for matches whose teams are decided."],
            ]}
          />
        </Section>

        {/* 17 ────────────────────────────────────────────────────── */}
        <Section id="faq" no="17" title="Troubleshooting & FAQ">
          <FieldTable
            rows={[
              ["“Invalid scorer code”", "The code was rotated or mistyped. Send the current one from the manage page. Repeated wrong guesses rate-limit that network for a few minutes — the correct code always keeps working."],
              ["Scorer can't pick a bowler", "Everyone eligible is greyed out: they're at the over quota or bowled the previous over. If quota × squad exactly equals the innings, the rotation has no slack — the wizard warns about this; raise the quota or field more players."],
              ["Innings stuck one over short", "Same cause as above — the only bowler under quota is the one who just bowled. Fix the rotation earlier, or adjust the quota."],
              ["“That slot is already blocked”", "Another block or booking holds the hour. Check Courts & Pricing → Slot Blocks and the admin calendar, then pick a free hour."],
              ["Prize pass wasn't issued", "The completion summary lists the reason — almost always a winner registered at the venue with no customer account. Issue it manually via Promotions → Passes → Gift a pass."],
              ["Need to fix a finished match", "Scores tab → Reopen. If a later bracket match already consumed the result, reopen that one first. Undo in the console only works while LIVE."],
              ["Regenerate fixtures is refused", "At least one match is LIVE/COMPLETED. Fixtures are frozen once play starts — fix individual results via the Scores tab instead."],
              ["Customers can't see the tournament", "Check the module master switch (Tournaments list), the status (DRAFT is invisible), and that you published."],
            ]}
          />
        </Section>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-400">
          <Trophy className="mb-2 h-5 w-5 text-emerald-400" />
          That&apos;s the whole journey: <b className="text-zinc-200">create → publish → register → pools → fixtures →
          schedule → live → complete</b>. The engine handles progression, seeding, byes and prizes — your job is the
          transitions and the scorer&apos;s thumb.
        </div>
      </div>
    </div>
  );
}
