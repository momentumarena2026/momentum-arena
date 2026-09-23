"use client";

import Link from "next/link";
import { ArrowLeft, Swords } from "lucide-react";

/**
 * One challenge, told as what happened to it.
 *
 * The list view answers "what state is this in"; this answers "why". Those
 * are different questions, and the second one cost a real afternoon: a
 * challenge sat at AGREED with nobody paid, no court held and no way for
 * anybody to see it, and working out how it got there meant reading the
 * source. Everything below was already recorded the whole time — the event
 * log has carried the story since the module shipped, including the REFUSED
 * rows that hold, in the customer's own words, what the server turned
 * somebody away with. This page is the reading, not new bookkeeping.
 *
 * Built mobile-first on purpose. The venue reads this standing on a pitch
 * with a phone, not at a desk: every row stacks, every long string wraps,
 * and nothing is in a table that would need sideways scrolling.
 */

const STATUS_TONE: Record<string, string> = {
  OPEN: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  COUNTERED: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  AGREED: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  PART_PAID: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  CONFIRMED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  SLOT_LOST: "border-red-500/40 bg-red-500/10 text-red-300",
  EXPIRED: "border-zinc-700 bg-zinc-900 text-zinc-500",
  WITHDRAWN: "border-zinc-700 bg-zinc-900 text-zinc-500",
};

/**
 * What each event MEANS, in the venue's language rather than the enum's.
 *
 * `HOME_CARD_SHOWN` tells somebody reading a feed nothing; "the home screen
 * card was shown to somebody" tells them what happened. The tone column is
 * doing real work too: the two that cost money — a slot lost, a refund owed
 * — must not look like the twenty that are telemetry.
 */
const EVENT: Record<string, { label: string; tone: string }> = {
  HOME_CARD_SHOWN: { label: "Home screen card shown", tone: "text-zinc-600" },
  HOME_CARD_TAPPED: { label: "Home screen card tapped", tone: "text-zinc-600" },
  BOARD_VIEWED: { label: "Opened the board", tone: "text-zinc-600" },
  POST_OPENED: { label: "Opened the post form", tone: "text-zinc-600" },
  POSTED: { label: "Posted the challenge", tone: "text-sky-300" },
  ANNOUNCED: { label: "Announced to the app", tone: "text-sky-300" },
  DETAIL_VIEWED: { label: "Opened this challenge", tone: "text-zinc-600" },
  ACCEPT_TAPPED: { label: "Tapped take / accept", tone: "text-zinc-500" },
  ACCEPTED: { label: "Accepted a time", tone: "text-violet-300" },
  COUNTER_OPENED: { label: "Opened the suggest form", tone: "text-zinc-600" },
  COUNTERED: { label: "Suggested a different time", tone: "text-violet-300" },
  SUGGEST_AGREED: { label: "Poster agreed to a suggested time", tone: "text-emerald-300" },
  SUGGEST_DECLINED: { label: "Poster turned a suggested time down", tone: "text-zinc-400" },
  WITHDRAWN: { label: "Withdrawn by the captain", tone: "text-zinc-400" },
  REFUSED: { label: "Refused — what the customer was told", tone: "text-amber-300" },
  ADMIN_TOOK_DOWN: { label: "Taken down by the arena", tone: "text-zinc-400" },
  EXPIRED: { label: "Expired", tone: "text-zinc-400" },
  PAY_STARTED: { label: "Opened the payment sheet", tone: "text-zinc-500" },
  PAID: { label: "A half was PAID", tone: "text-emerald-300" },
  SLOT_LOST: { label: "The hour went to somebody else", tone: "text-red-300" },
  SPUN: { label: "Spun the prize wheel", tone: "text-amber-300" },
  OFFER_TAKEN: { label: "Took the discounted hour", tone: "text-emerald-300" },
  OFFER_LAPSED: { label: "Let the discount lapse", tone: "text-zinc-500" },
  REFUNDED: { label: "Marked refunded by the arena", tone: "text-zinc-400" },
  MONEY_NOTE: { label: "Money note", tone: "text-amber-300" },
};

type Person = { id: string; name: string | null; phone: string | null };

function ist(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return (
    new Date(d.getTime() + 5.5 * 3600_000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 16) + " IST"
  );
}

function hr(h: number): string {
  const x = h % 24;
  return x === 0 ? "12am" : x < 12 ? `${x}am` : x === 12 ? "12pm" : `${x - 12}pm`;
}

function day(v: string | Date): string {
  return new Date(v).toISOString().slice(0, 10);
}

function money(n: number | null | undefined): string {
  return "₹" + (n ?? 0).toLocaleString("en-IN");
}

/** A person, named the way the venue would ring them. */
function Who({ p }: { p: Person | null | undefined }) {
  if (!p) return <span className="text-zinc-600">—</span>;
  return (
    <span className="break-words">
      <span className="text-white">{p.name || "Unnamed"}</span>{" "}
      {p.phone ? <span className="text-zinc-500">{p.phone}</span> : null}
    </span>
  );
}

function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {lead ? <p className="mt-0.5 text-xs text-zinc-500">{lead}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A label/value pair that stacks on a phone instead of squeezing. */
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-zinc-900 py-2 last:border-0 sm:flex-row sm:gap-3">
      <div className="shrink-0 text-xs text-zinc-500 sm:w-44">{k}</div>
      <div className="min-w-0 break-words text-sm text-zinc-200">{v}</div>
    </div>
  );
}

export function ChallengeStory({
  data,
}: {
  data: {
    challenge: Record<string, never> & {
      id: string;
      sport: string;
      teamName: string | null;
      playerCount: number;
      notes: string | null;
      status: string;
      createdAt: string;
      expiresAt: string;
      announcedAt: string | null;
      acceptedAt: string | null;
      withdrawReason: string | null;
      bookingId: string | null;
      agreedWindowId: string | null;
      counterCountChallenger: number;
      counterCountAcceptor: number;
      createdBy: Person | null;
      acceptedBy: Person | null;
      booking: { id: string; status: string; date: string; totalAmount: number } | null;
      windows: {
        id: string;
        date: string;
        startHour: number;
        endHour: number;
        proposedBy: string;
        proposedByUserId: string;
        status: string;
        approvedAt: string | null;
        createdAt: string;
        courtConfig: { label: string } | null;
      }[];
      payments: {
        id: string;
        side: string;
        amount: number;
        createdAt: string;
        paidAt: string | null;
        placedAt: string | null;
        refundOwedAt: string | null;
        refundOwedReason: string | null;
        refundedAt: string | null;
        refundNote: string | null;
        razorpayOrderId: string | null;
        razorpayPaymentId: string | null;
        phonePeMerchantTxnId: string | null;
        user: Person | null;
      }[];
      spin: {
        id: string;
        wonPct: number;
        createdAt: string;
        user: { name: string | null } | null;
        offer: {
          id: string;
          kind: string;
          expiresAt: string;
          takenAt: string | null;
          date: string | null;
          startHour: number | null;
        } | null;
      } | null;
    };
    events: {
      id: string;
      type: string;
      detail: string | null;
      createdAt: string;
      userId: string | null;
      user: Person | null;
    }[];
    orders: {
      id: string;
      razorpayOrderId: string;
      userId: string;
      side: string;
      amount: number;
      createdAt: string;
      settledAt: string | null;
      strandedAt: string | null;
      strandedReason: string | null;
      refundedAt: string | null;
    }[];
    people: Person[];
    paymentWindowMins: number;
  };
}) {
  const c = data.challenge;
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const now = Date.now();

  const paid = c.payments.filter((p) => p.paidAt && !p.refundOwedAt);
  const owed = c.payments.filter((p) => p.refundOwedAt && !p.refundedAt);
  const liveHold = c.payments.find(
    (p) =>
      !p.paidAt &&
      !p.refundOwedAt &&
      new Date(p.createdAt).getTime() + data.paymentWindowMins * 60000 > now,
  );

  /**
   * Why it is where it is, in one paragraph.
   *
   * This is the sentence somebody actually came for, and leaving them to
   * infer it from the timeline is how the question got asked in the first
   * place. Every branch names the money and the court explicitly, because
   * "agreed" and "somebody has paid" and "a court is held" are three
   * different facts that this module deliberately keeps apart.
   */
  const reading: string[] = [];
  if (c.status === "OPEN") {
    reading.push("On the board and takeable. Nobody has paid, no court is held.");
  } else if (c.status === "COUNTERED") {
    reading.push(
      "Somebody has suggested a different time. That claims nothing — the challenge is still on the board and still takeable by anyone, and no court is held.",
    );
  } else if (c.status === "AGREED") {
    reading.push(
      "A time is settled and nobody has paid. No court is held and none is blocked: the hour stays on sale until BOTH halves are in, so a walk-in can still take it.",
    );
    reading.push(
      "This state can no longer be reached by suggesting a time — it dates from before that was fixed, or from a plain accept between two captains already in the match.",
    );
  } else if (c.status === "PART_PAID") {
    reading.push(
      `${paid.length} of 2 halves paid. The hour is STILL NOT HELD — it is bought only when both halves are in, so it can be sold to somebody else meanwhile.`,
    );
  } else if (c.status === "CONFIRMED") {
    reading.push("Both halves are in and the court is booked.");
  } else if (c.status === "SLOT_LOST") {
    reading.push(
      "The hour went to somebody else before both halves were in. Anyone who paid is owed a refund — the arena makes it by hand.",
    );
  } else if (c.status === "EXPIRED") {
    reading.push("Nobody took it in time, and the sweep closed it.");
  } else if (c.status === "WITHDRAWN") {
    reading.push(
      c.withdrawReason
        ? `Pulled: ${c.withdrawReason}`
        : "Pulled by the captain, or taken down by the arena.",
    );
  }
  if (owed.length > 0) {
    reading.push(
      `${owed.length} payment(s) flagged as a refund owed and NOT yet returned — ${money(owed.reduce((t, p) => t + p.amount, 0))}.`,
    );
  }
  if (liveHold) {
    reading.push(
      `${liveHold.user?.name ?? "Somebody"} has the ${liveHold.side.toLowerCase()} payment slot open until ${ist(
        new Date(new Date(liveHold.createdAt).getTime() + data.paymentWindowMins * 60000),
      )}. Nobody else can pay that half until then.`,
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <Link
        href="/admin/challenges"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Challenge board
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Swords className="h-5 w-5 shrink-0 text-emerald-400" />
        <h1 className="min-w-0 break-words text-xl font-bold text-white sm:text-2xl">
          {c.teamName || "(no team name)"}
        </h1>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] ${
            STATUS_TONE[c.status] ?? "border-zinc-700 text-zinc-400"
          }`}
        >
          {c.status.toLowerCase().replace("_", " ")}
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-400">
        {c.sport.charAt(0) + c.sport.slice(1).toLowerCase()} · {c.playerCount} players
      </p>
      {c.notes ? <p className="mt-1 text-sm text-zinc-400 break-words">{c.notes}</p> : null}

      <div className="mt-5 space-y-4">
        <Section title="Where it stands, and why">
          <ul className="space-y-2">
            {reading.map((r) => (
              <li key={r} className="text-sm leading-relaxed text-zinc-200">
                {r}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Who">
          <Row k="Posted by" v={<Who p={c.createdBy} />} />
          <Row
            k="Taken by"
            v={
              c.acceptedBy ? (
                <>
                  <Who p={c.acceptedBy} />
                  <span className="ml-2 text-xs text-zinc-500">
                    {c.acceptedAt ? ist(c.acceptedAt) : ""}
                  </span>
                </>
              ) : (
                <span className="text-zinc-500">
                  Nobody. The acceptor is set when somebody PAYS.
                </span>
              )
            }
          />
          <Row k="Posted at" v={ist(c.createdAt)} />
          <Row
            k="Expires"
            v={
              <>
                {ist(c.expiresAt)}
                {new Date(c.expiresAt).getTime() < now ? (
                  <span className="ml-2 text-amber-300">— past</span>
                ) : null}
              </>
            }
          />
          <Row
            k="Announced by push"
            v={c.announcedAt ? ist(c.announcedAt) : <span className="text-zinc-500">never</span>}
          />
          <Row
            k="Booking"
            v={
              c.booking ? (
                <Link
                  href={`/admin/bookings/${c.booking.id}`}
                  className="text-emerald-300 underline underline-offset-2"
                >
                  {c.booking.status} · {money(c.booking.totalAmount)}
                </Link>
              ) : (
                <span className="text-zinc-500">none — NO COURT IS HELD</span>
              )
            }
          />
          <Row k="Challenge id" v={<span className="font-mono text-xs">{c.id}</span>} />
        </Section>

        <Section
          title="Times"
          lead="Who put each one up, and whether anybody can buy it."
        >
          <div className="space-y-2">
            {c.windows.map((w) => {
              const pending =
                w.status === "OFFERED" && w.proposedBy === "ACCEPTOR" && !w.approvedAt;
              const takeable =
                w.status === "OFFERED" && (w.proposedBy === "CHALLENGER" || !!w.approvedAt);
              return (
                <div
                  key={w.id}
                  className={`rounded-lg border p-3 ${
                    w.id === c.agreedWindowId
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : w.status === "OFFERED"
                        ? "border-zinc-800"
                        : "border-zinc-900 opacity-60"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={`text-sm ${
                        w.status === "OFFERED" || w.status === "ACCEPTED"
                          ? "text-white"
                          : "text-zinc-500 line-through"
                      }`}
                    >
                      {day(w.date)} {hr(w.startHour)}–{hr(w.endHour)}
                    </span>
                    {w.courtConfig ? (
                      <span className="text-xs text-zinc-500">{w.courtConfig.label}</span>
                    ) : null}
                    <span className="text-[11px] text-zinc-500">{w.status.toLowerCase()}</span>
                    {w.id === c.agreedWindowId ? (
                      <span className="text-[11px] text-emerald-300">the agreed time</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-zinc-400 break-words">
                    {/* The STATUS wins over who proposed it. An accepted or
                        declined window still read "anyone can take it",
                        which is the one sentence on this page somebody might
                        act on and be wrong. */}
                    {w.status !== "OFFERED" ? (
                      <>
                        {w.proposedBy === "CHALLENGER" ? (
                          <>Offered by the poster</>
                        ) : (
                          <>
                            Suggested by <Who p={byId.get(w.proposedByUserId)} />
                          </>
                        )}{" "}
                        — {w.status === "ACCEPTED" ? "this is the match" : w.status.toLowerCase()}
                      </>
                    ) : w.proposedBy === "CHALLENGER" ? (
                      <>Offered by the poster — anyone can take it</>
                    ) : pending ? (
                      <>
                        Suggested by <Who p={byId.get(w.proposedByUserId)} /> — waiting on the
                        poster. Nobody can buy it yet.
                      </>
                    ) : w.approvedAt ? (
                      <>
                        Suggested by <Who p={byId.get(w.proposedByUserId)} />, agreed by the poster{" "}
                        {ist(w.approvedAt)} — on sale to anyone
                      </>
                    ) : null}
                  </p>
                </div>
              );
            })}
            {c.windows.length === 0 ? (
              <p className="text-sm text-zinc-500">No times.</p>
            ) : null}
          </div>
        </Section>

        <Section
          title="Money"
          lead="One row per payment slot. Opening the sheet claims a side; paying is what buys."
        >
          {c.payments.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Nothing. No slot opened, no money started, nothing owed.
            </p>
          ) : (
            <div className="space-y-3">
              {c.payments.map((p) => {
                const holdEnds = new Date(
                  new Date(p.createdAt).getTime() + data.paymentWindowMins * 60000,
                );
                const holding = !p.paidAt && holdEnds.getTime() > now;
                return (
                  <div key={p.id} className="rounded-lg border border-zinc-800 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-white">
                        {p.side === "CHALLENGER" ? "Poster" : "Taker"} · {money(p.amount)}
                      </span>
                      <span
                        className={`rounded border px-2 py-0.5 text-[11px] ${
                          p.refundedAt
                            ? "border-zinc-700 text-zinc-500"
                            : p.refundOwedAt
                              ? "border-red-500/40 text-red-300"
                              : p.paidAt
                                ? "border-emerald-500/40 text-emerald-300"
                                : "border-amber-500/40 text-amber-300"
                        }`}
                      >
                        {p.refundedAt
                          ? "refunded"
                          : p.refundOwedAt
                            ? "refund owed"
                            : p.paidAt && !p.placedAt
                              ? "captured, not on a booking"
                              : p.paidAt
                                ? "paid"
                                : "started, unpaid"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">
                      <Who p={p.user} />
                    </p>
                    <dl className="mt-2 space-y-1 text-xs text-zinc-400">
                      <div className="break-words">
                        Sheet opened {ist(p.createdAt)}
                        {holding ? (
                          <span className="text-amber-300">
                            {" "}
                            — HOLDS this side until {ist(holdEnds)}
                          </span>
                        ) : !p.paidAt ? (
                          <span className="text-zinc-500"> — hold lapsed</span>
                        ) : null}
                      </div>
                      <div>Paid {p.paidAt ? ist(p.paidAt) : "— not paid"}</div>
                      <div>On a booking {p.placedAt ? ist(p.placedAt) : "— no"}</div>
                      {p.refundOwedAt ? (
                        <div className="text-red-300 break-words">
                          Refund owed since {ist(p.refundOwedAt)}
                          {p.refundOwedReason ? ` — ${p.refundOwedReason}` : ""}
                          {p.refundedAt ? ` · returned ${ist(p.refundedAt)}` : " · NOT RETURNED"}
                          {p.refundNote ? ` (${p.refundNote})` : ""}
                        </div>
                      ) : null}
                      <div className="break-all text-zinc-600">
                        {p.phonePeMerchantTxnId
                          ? `UPI ${p.phonePeMerchantTxnId}`
                          : p.razorpayOrderId
                            ? `card ${p.razorpayOrderId}${p.razorpayPaymentId ? ` / ${p.razorpayPaymentId}` : ""}`
                            : "no instrument yet"}
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>
          )}

          {data.orders.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-semibold text-zinc-400">
                Order ledger
                <span className="ml-1 font-normal text-zinc-600">
                  — outlives the payment row, so a capture whose slot was reassigned still
                  appears here
                </span>
              </p>
              <div className="mt-2 space-y-2">
                {data.orders.map((o) => (
                  <div
                    key={o.id}
                    className="rounded-lg border border-zinc-900 p-2.5 text-xs text-zinc-400"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-zinc-200">
                        {money(o.amount)} · {o.side === "CHALLENGER" ? "poster" : "taker"}
                      </span>
                      <span>
                        <Who p={byId.get(o.userId)} />
                      </span>
                      {o.strandedAt ? (
                        <span className="rounded border border-red-500/40 px-1.5 py-0.5 text-red-300">
                          stranded
                        </span>
                      ) : o.settledAt ? (
                        <span className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-emerald-300">
                          settled
                        </span>
                      ) : (
                        <span className="rounded border border-zinc-700 px-1.5 py-0.5">open</span>
                      )}
                    </div>
                    {o.strandedReason ? (
                      <p className="mt-1 break-words text-red-300">{o.strandedReason}</p>
                    ) : null}
                    <p className="mt-1 break-all text-zinc-600">{o.razorpayOrderId}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Section>

        {c.spin ? (
          <Section title="Prize wheel">
            <Row k="Won" v={`${c.spin.wonPct}% off, ${ist(c.spin.createdAt)}`} />
            <Row k="Spun by" v={c.spin.user?.name ?? "—"} />
            {c.spin.offer ? (
              <Row
                k="The offer"
                v={
                  <>
                    {c.spin.offer.kind}
                    {c.spin.offer.date
                      ? ` · ${day(c.spin.offer.date)} ${hr(c.spin.offer.startHour ?? 0)}`
                      : ""}{" "}
                    · {c.spin.offer.takenAt ? `taken ${ist(c.spin.offer.takenAt)}` : "not taken"} ·
                    expires {ist(c.spin.offer.expiresAt)}
                  </>
                }
              />
            ) : null}
          </Section>
        ) : null}

        <Section
          title="Everything that happened"
          lead={`${data.events.length} events, oldest first. REFUSED rows carry the exact sentence the customer was shown.`}
        >
          <ol className="space-y-2.5">
            {data.events.map((e) => {
              const meta = EVENT[e.type] ?? { label: e.type, tone: "text-zinc-400" };
              return (
                <li key={e.id} className="border-b border-zinc-900 pb-2.5 last:border-0">
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                    <span className="shrink-0 font-mono text-[11px] text-zinc-600 sm:w-36">
                      {ist(e.createdAt)}
                    </span>
                    <span className={`text-sm ${meta.tone}`}>{meta.label}</span>
                  </div>
                  {e.user ? (
                    <p className="mt-0.5 text-xs sm:ml-[9.75rem]">
                      <Who p={e.user} />
                    </p>
                  ) : null}
                  {e.detail ? (
                    <p className="mt-0.5 break-words text-xs text-zinc-400 sm:ml-[9.75rem]">
                      {e.detail}
                    </p>
                  ) : null}
                </li>
              );
            })}
            {data.events.length === 0 ? (
              <p className="text-sm text-zinc-500">No events recorded.</p>
            ) : null}
          </ol>
        </Section>
      </div>
    </div>
  );
}
