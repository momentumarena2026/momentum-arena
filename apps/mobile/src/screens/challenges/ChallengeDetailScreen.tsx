import { useEffect, useMemo, useState } from "react";
import {
  View,
  ScrollView,
  Pressable,
  Alert,
  RefreshControl,
  Modal,
  StyleSheet,
} from "react-native";
import { Smartphone, CreditCard } from "lucide-react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { DqrCheckout, type DqrEndpoints } from "../../components/payment/DqrCheckout";
import { bookingApi } from "../../lib/booking";
import { SpinWheel } from "./SpinWheel";
import type { AccountStackParamList } from "../../navigation/types";
import { getCurrentMinutesIST, getTodayIST, getUpcomingDatesIST } from "../../lib/ist-date";
import {
  fetchChallenge,
  acceptChallenge,
  counterChallenge,
  withdrawChallenge,
  hourLabel,
  statusLabel,
  dayLabel,
  trackChallenge,
  challengeErrorMessage,
  createChallengePayOrder,
  verifyChallengePayment,
  spinChallengeWheel,
  createOfferPayOrder,
  verifyOfferPayment,
  type SpinResult,
  type OfferPick,
  type OfferSlots,
  fetchOfferSlots,
  releaseChallengePayHold,
  challengeDqr,
  type PaymentHold,
} from "../../lib/challenges";
import RazorpayCheckout from "react-native-razorpay";
import { useAuth } from "../../providers/AuthProvider";

/**
 * One challenge, and what you can do about it.
 *
 * The server decides what is allowed and says why in a sentence; this
 * screen shows that sentence rather than working the rules out again. Two
 * surfaces answering the same question separately is how the cricket
 * engines drifted, and there is no reason to repeat it here.
 */
/**
 * Razorpay rejects for two very different reasons down one channel: the
 * user closed the sheet, or the payment failed. Only the first deserves
 * silence.
 */
function isSheetDismissal(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  const desc = String((e as { description?: unknown } | null)?.description ?? "").toLowerCase();
  // Razorpay's PAYMENT_CANCELLED is 0 (and 2 on some builds); the text is
  // the fallback for versions that only populate the description.
  if (code === 0 || code === 2 || code === "0") return true;
  return desc.includes("cancel") || desc.includes("dismiss");
}

export function ChallengeDetailScreen() {
  const route = useRoute<RouteProp<AccountStackParamList, "ChallengeDetail">>();
  const nav = useNavigation();
  const qc = useQueryClient();
  const id = route.params.id;
  const [busy, setBusy] = useState(false);
  const [showCounter, setShowCounter] = useState(false);
  const [paying, setPaying] = useState(false);
  // WHICH window is being paid for. One shared boolean spun every "Take it"
  // button on the screen at once, so a captain tapping one time saw all three
  // go busy and could not tell which one they had chosen.
  const [payingWindowId, setPayingWindowId] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [spun, setSpun] = useState<SpinResult | null>(null);
  const [slots, setSlots] = useState<OfferSlots | null>(null);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  // Which payment is waiting for the customer to pick a method, and which
  // one is mid-UPI. Held separately from `paying` because the Razorpay
  // sheet and the QR sheet are different lifetimes: one blocks, the other
  // sits on screen polling.
  const [choosing, setChoosing] = useState<{ windowId?: string } | null>(null);
  const [method, setMethod] = useState<"upi" | "razorpay">("upi");
  const [dqrFor, setDqrFor] = useState<{ windowId?: string; amount: number } | null>(null);
  const { state: authState } = useAuth();

  // Which methods the arena is actually running. Same source the booking
  // checkout and the pass store read, so the three cannot disagree about
  // whether UPI is on.
  const { data: payCfg } = useQuery({
    queryKey: ["payment-config"],
    queryFn: () => bookingApi.paymentConfig(),
  });
  const dqrEnabled = !!payCfg?.dqrEnabled;

  // The next seven days — as far ahead as anyone arranges a pickup game.
  //
  // Built from the IST helpers, and starting TODAY when today still has a legal
  // hour left in it. Both bugs the post form already had: `i + 1` made tonight
  // unreachable when countering while it was reachable when posting, and
  // `toISOString()` on a local Date returns yesterday between midnight and
  // 05:30 IST — at a venue open until 2am.
  const [day, setDay] = useState<string>("");
  const [hour, setHour] = useState<number>(18);
  const [len, setLen] = useState<number>(2);
  // A countdown computed once in render sits frozen until something else
  // re-renders the screen — so a captain watches "12 minutes left" for twelve
  // minutes and then finds the offer gone. One tick a second, mounted only
  // while this screen is.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);


  const chip = (on: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: on ? colors.emerald400 : colors.zinc800,
    backgroundColor: on ? colors.emerald500_10 : "transparent",
  });

  const q = useQuery({ queryKey: ["challenge", id], queryFn: () => fetchChallenge(id) });
  const c = q.data?.challenge;

  // ABOVE THE EARLY RETURNS, for the reason spelled out in the comment
  // below — which I walked straight past and reproduced: the screen threw
  // "Rendered more hooks than during the previous render" and died on open,
  // because this sat beside the values it reads instead of with the hooks.
  //
  // Memoised at all because DqrCheckout re-initiates a PhonePe transaction
  // on every render of a fresh object, which is a live QR per keystroke.
  const dqrEndpoints: DqrEndpoints = useMemo(
    () => ({
      initiate: async () => {
        const r = await challengeDqr.initiate(id, dqrFor?.windowId);
        return {
          mode: r.mode,
          qrString: r.qrString ?? null,
          qrImage: r.qrImage ?? null,
          transactionId: r.transactionId,
          expiresIn: r.expiresIn,
          error: r.error,
        };
      },
      status: async (txn: string) => {
        const r = await challengeDqr.status(txn);
        return {
          state: r.state,
          confirmedId: r.confirmedId ?? null,
          paymentReceived: r.paymentReceived,
          error: r.error,
        };
      },
    }),
    [id, dqrFor?.windowId],
  );

  // Keep the counter picker's selection legal.
  //
  // THIS HOOK MUST STAY ABOVE THE EARLY RETURNS. It was written down beside
  // the values it reads, which sit after `if (!c) return …` — so on a render
  // where the challenge had not loaded, React saw fewer hooks than the render
  // before and threw "Rendered more hooks than during the previous render".
  // The screen died on open. Hooks are positional; derived values are not.
  useEffect(() => {
    const close = q.data?.hours?.end ?? 25;
    const open = q.data?.hours?.start ?? 5;
    const earliest = Math.ceil((getCurrentMinutesIST() + (q.data?.minLeadMins ?? 240)) / 60);
    const strip = getUpcomingDatesIST(8).slice(earliest < close ? 0 : 1, 8);
    const all = Array.from({ length: Math.max(1, close - open) }, (_, i) => i + open);
    const legal = all.filter((h) => (day || strip[0]) !== getTodayIST() || h >= earliest);
    if (!day && strip[0]) setDay(strip[0]);
    if (legal.length > 0 && !legal.includes(hour)) setHour(legal[0]);
    if (hour + len > close) setLen(Math.max(1, close - hour));
  }, [q.data, day, hour, len]);
  const me = q.data?.viewerId;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["challenge", id] });
    await qc.invalidateQueries({ queryKey: ["challenges"] });
  };

  if (!c) {
    return (
      <Screen>
        <View style={{ padding: 24 }}>
          <Text variant="small" color={colors.zinc500}>
            {q.isLoading ? "Loading…" : "That challenge is gone."}
          </Text>
        </View>
      </Screen>
    );
  }

  const counterBlock = q.data?.counterBlock ?? null;
  const quote = q.data?.quote ?? null;
  const spinEnabled = q.data?.spinEnabled ?? false;
  const windowQuotes = q.data?.windowQuotes ?? [];
  const hold: PaymentHold | null = q.data?.hold ?? null;

  // The arena's real hours, not a hard-coded 5–25. When the venue moved its
  // closing time the chips kept offering the old range while the board
  // refused what the arena was actually selling.
  const openHour = q.data?.hours?.start ?? 5;
  const closeHour = q.data?.hours?.end ?? 25;
  const hours = Array.from({ length: Math.max(1, closeHour - openHour) }, (_, i) => i + openHour);
  const minLeadMins = q.data?.minLeadMins ?? 240;
  const earliestHourToday = Math.ceil((getCurrentMinutesIST() + minLeadMins) / 60);
  const days = getUpcomingDatesIST(8).slice(earliestHourToday < closeHour ? 0 : 1, 8);
  // Today offers fewer hours than the rest of the strip does.
  const legalHours = hours.filter((h) => day !== getTodayIST() || h >= earliestHourToday);
  const boardEnabled = q.data?.boardEnabled ?? true;
  // The prize comes from the SERVER, not from state left over in this
  // component. Spin, background the app, come back — it is still here, and
  // every nudge deep-links to exactly this screen.
  const serverOffer = q.data?.offer ?? null;
  // The SERVER wins whenever it has spoken. Preferring local state meant a
  // lapsed offer kept its panel and its Book button alive indefinitely, and
  // a refresh could not correct it — the user tapped a live-looking button
  // and got "That offer has expired."
  const spinOutcome = q.data?.spin ?? null;
  // Once the server has answered, IT decides. Falling back to local state
  // when the server says "no live offer" is how a lapsed prize kept a live
  // Book button that refreshing could not clear — and how a SPENT prize
  // disappeared entirely and the spin button came back.
  const serverAnswered = q.isSuccess;
  const prize: SpinResult | null =
    (serverOffer
      ? {
          pct: serverOffer.pct,
          kind: serverOffer.kind,
          offerId: serverOffer.offerId,
          expiresAt: serverOffer.expiresAt,
          hour: serverOffer.hour,
          date: serverOffer.date,
          price: serverOffer.price,
          saving: serverOffer.saving,
        }
      : serverAnswered
        ? null
        : spun) ?? (serverAnswered ? null : spun);
  const mine = c.createdByUserId === me;
  const iAmIn = mine || c.acceptedByUserId === me;
  // A switched-off board must stop offering actions here too. This field was
  // on the wire and read by nothing, so Take, Accept, Pay and Suggest all
  // stayed live and were refused server-side.
  const live = boardEnabled && ["OPEN", "COUNTERED", "AGREED"].includes(c.status);
  // Only a time the OTHER side put up can be accepted — accepting your own
  // suggestion is just waiting for an answer.
  const mySide = mine ? "CHALLENGER" : "ACCEPTOR";
  const takeable = c.windows.filter(
    (w) => w.status === "OFFERED" && (!iAmIn || w.proposedBy !== mySide),
  );

  /**
   * Pay this side's half.
   *
   * Three steps, and the middle one leaves the app: open an order for
   * exactly this side's share, run Razorpay's sheet, hand the signature
   * back. A cancelled sheet is not an error — people back out of payment
   * screens constantly and telling them off for it is wrong — so it just
   * returns quietly and leaves the challenge as it was.
   */
  /**
   * Every pay button lands here first.
   *
   * The rest of the app asks which method before it takes money — UPI by
   * default, the gateway second — and this screen went straight to
   * Razorpay, so the one place a captain pays for a match was the one
   * place they could not avoid the gateway fee. When only one method is
   * running there is nothing to ask, so it goes straight through rather
   * than showing a chooser with one option.
   */
  const startPay = (acceptWindowId?: string) => {
    if (!dqrEnabled) {
      void pay(acceptWindowId);
      return;
    }
    setMethod("upi");
    setChoosing({ windowId: acceptWindowId });
  };

  const pay = async (acceptWindowId?: string) => {
    setPaying(true);
    setPayingWindowId(acceptWindowId ?? null);
    try {
      const order = await createChallengePayOrder(id, acceptWindowId);
      let paid: {
        razorpay_order_id?: string;
        razorpay_payment_id?: string;
        razorpay_signature?: string;
      };
      try {
        paid = (await RazorpayCheckout.open({
          key: order.keyId,
          amount: Math.round(order.amount * 100),
          currency: "INR",
          name: "Momentum Arena",
          description: `Your half${order.courtLabel ? ` · ${order.courtLabel}` : ""}`,
          order_id: order.orderId,
          prefill: {
            name: authState.user?.name ?? "",
            email: authState.user?.email ?? "",
            contact: authState.user?.phone ?? "",
          },
          theme: { color: colors.emerald500 },
        })) as typeof paid;
      } catch (e) {
        // A dismissed sheet and a FAILED payment arrive down the same path,
        // and treating both as silence meant somebody who pressed a button
        // in their bank and got nothing back had no idea whether money had
        // left their account. Razorpay's cancellation carries its own code;
        // anything else is a real failure and deserves a sentence.
        // Re-read before showing the error: the reason a capture fails is
        // usually that the world moved, and the panel behind the alert was
        // still telling the captain to pay for a court that had gone.
        void refresh();
        if (!isSheetDismissal(e)) {
          Alert.alert(
            "That payment didn't go through",
            "Nothing has been charged. You can try again — the time is still yours to take.",
          );
        }
        return;
      }
      const res = await verifyChallengePayment({
        challengeId: id,
        razorpayOrderId: paid.razorpay_order_id ?? "",
        razorpayPaymentId: paid.razorpay_payment_id ?? "",
        razorpaySignature: paid.razorpay_signature ?? "",
      });
      await refresh();
      await qc.invalidateQueries({ queryKey: ["challenges"] });
      Alert.alert(
        // NOT "Court held" — it is not, until both halves are in, and this
        // alert's own body says so three lines later.
        res.status === "CONFIRMED" ? "Match confirmed" : "Your half is in",
        res.status === "CONFIRMED"
          ? "Both halves are in and the court is booked. See you there."
          : acceptWindowId
            ? "You're in. We've told the other captain their half is due — the hour is only held once both halves are in."
            : "Your half is paid. We've told the other captain theirs is due — the hour is only held once both halves are in.",
      );
    } catch (e) {
      Alert.alert("Payment problem", challengeErrorMessage(e));
    } finally {
      setPaying(false);
      setPayingWindowId(null);
    }
  };

  /**
   * Spin. The result is decided and stored on the server before this call
   * returns — the animation shows what already happened, so backgrounding
   * the app mid-spin cannot buy a second roll.
   */
  const spin = async () => {
    setSpinning(true);
    try {
      setSpun(await spinChallengeWheel(id));
    } catch (e) {
      setWheelOpen(false);
      Alert.alert("No spin", challengeErrorMessage(e));
    } finally {
      setSpinning(false);
    }
  };

  const loadSlots = async () => {
    const id2 = spun?.offerId ?? q.data?.offer?.offerId;
    if (!id2) return;
    setLoadingSlots(true);
    try {
      setSlots(await fetchOfferSlots(id2));
    } catch (e) {
      Alert.alert("Couldn't load hours", challengeErrorMessage(e));
    } finally {
      setLoadingSlots(false);
    }
  };

  /** Pay for the whole discounted hour. No split — the captain fronts it. */
  const takeOffer = async (pick?: OfferPick) => {
    const prize = spun ?? (q.data?.offer ? { ...q.data.offer } : null);
    if (!prize) return;
    setPaying(true);
    try {
      const order = await createOfferPayOrder(prize.offerId, pick);
      let paid: {
        razorpay_order_id?: string;
        razorpay_payment_id?: string;
        razorpay_signature?: string;
      };
      try {
        paid = (await RazorpayCheckout.open({
          key: order.keyId,
          amount: Math.round(order.amount * 100),
          currency: "INR",
          name: "Momentum Arena",
          description: `${prize.pct}% off ${prize.hour ?? "an extra hour"}`,
          order_id: order.orderId,
          prefill: {
            name: authState.user?.name ?? "",
            email: authState.user?.email ?? "",
            contact: authState.user?.phone ?? "",
          },
          theme: { color: colors.emerald500 },
        })) as typeof paid;
      } catch (e) {
        if (!isSheetDismissal(e)) {
          Alert.alert(
            "That payment didn't go through",
            "Nothing has been charged. Your discount is still yours — try again before it expires.",
          );
        }
        return;
      }
      await verifyOfferPayment({
        offerId: prize.offerId,
        razorpayOrderId: paid.razorpay_order_id ?? "",
        razorpayPaymentId: paid.razorpay_payment_id ?? "",
        razorpaySignature: paid.razorpay_signature ?? "",
        pick,
      });
      setSpun(null);
      setSlots(null);
      await refresh();
      Alert.alert("Booked", `That hour is yours at ${prize.pct}% off. See you there.`);
    } catch (e) {
      Alert.alert("Couldn't book it", challengeErrorMessage(e));
    } finally {
      setPaying(false);
      setPayingWindowId(null);
    }
  };

  const act = async (fn: () => Promise<{ ok?: boolean; error?: string }>) => {
    setBusy(true);
    const res = await fn().catch((e) => ({ error: challengeErrorMessage(e) }));
    setBusy(false);
    if (res.error) {
      Alert.alert("Can't do that", res.error);
      return;
    }
    await refresh();
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 16 }}
        refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={refresh} />}
      >
        <View style={{ gap: 4 }}>
          <Text variant="title" color={colors.foreground}>
            {c.teamName || c.createdBy?.name || "A team"}
          </Text>
          <Text variant="small" color={colors.zinc500}>
            {c.sport[0] + c.sport.slice(1).toLowerCase()} · {c.playerCount} players ·{" "}
            {statusLabel(c.status)}
          </Text>
          {c.notes ? (
            <Text variant="small" color={colors.zinc400} style={{ marginTop: 4 }}>
              {c.notes}
            </Text>
          ) : null}
        </View>

        {/* SLOT_LOST belongs here too. Without it, a captain who had paid
            ₹1000 into an hour that was then sold opened the challenge and saw
            a status line and nothing else — no mention of his money, no
            mention of the refund, no next step — in a system where no refund
            happens by itself. */}
        {(c.status === "SLOT_LOST" ||
          c.status === "AGREED" ||
          c.status === "PART_PAID" ||
          c.status === "CONFIRMED") &&
        quote ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: colors.emerald400,
              backgroundColor: colors.emerald500_10,
              borderRadius: radius.md,
              padding: 14,
              gap: 10,
            }}
          >
            <Text
              variant="bodyStrong"
              color={c.status === "SLOT_LOST" ? colors.zinc300 : colors.emerald400}
            >
              {c.status === "SLOT_LOST"
                ? quote.youHavePaid
                  ? "That hour went — your money is coming back"
                  : "That hour went"
                : c.status === "CONFIRMED"
                  ? "Match confirmed"
                  : c.status === "PART_PAID"
                    ? quote.youHavePaid
                      ? "Your half is in"
                      : "Your half is due — the hour isn't held yet"
                    : "Match agreed"}
            </Text>
            {c.status === "SLOT_LOST" && (
              <Text variant="small" color={colors.zinc300}>
                {quote.youHavePaid
                  ? `Somebody else booked it before both halves were in. The ₹${quote.yourShare ?? 0} you paid is being refunded in full — the arena does it by hand, so give them a day or two.`
                  : "Somebody else booked it before both halves were in. Nothing was charged to you."}
              </Text>
            )}

            {/* Say the whole shape of the money, not just what is due now.
                Somebody who pays ₹500 and then meets a ₹1,000 bill at the
                gate was misled, however technically correct the first
                number was. */}
            <Text variant="small" color={colors.zinc300}>
              {quote.courtLabel ? `${quote.courtLabel} · ` : ""}₹{quote.total} for the court.
              ₹{quote.advance} online, split ₹{quote.shares.CHALLENGER}/₹{quote.shares.ACCEPTOR}
              {quote.venueBalance > 0 ? ` — ₹${quote.venueBalance} at the venue on the day.` : "."}
            </Text>

            {c.status === "CONFIRMED" ? (
              <>
                <Text variant="small" color={colors.zinc300}>
                  Both halves are in and the court is booked. See you there.
                </Text>
                {mine && !prize && !spinOutcome && spinEnabled && (
                  <Button
                    label="Spin the wheel"
                    variant="primary"
                    onPress={() => setWheelOpen(true)}
                  />
                )}
                {!prize && spinOutcome && (
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: colors.zinc800,
                      borderRadius: radius.md,
                      padding: 12,
                      gap: 6,
                    }}
                  >
                    <Text variant="bodyStrong" color={colors.emerald400}>
                      You won {spinOutcome.pct}% off
                    </Text>
                    <Text variant="small" color={colors.zinc400}>
                      {spinOutcome.spentOn
                        ? `Used on ${spinOutcome.date ?? ""} ${spinOutcome.hour ?? "an extra hour"}.`.replace(
                            /\s+/g,
                            " ",
                          )
                        : "That offer has lapsed."}
                    </Text>
                    {spinOutcome.spentOn ? (
                      <Button
                        label="See that booking"
                        variant="secondary"
                        size="sm"
                        onPress={() =>
                          (nav as never as { navigate: (s: string, p: object) => void }).navigate(
                            "BookingDetail",
                            { bookingId: spinOutcome.spentOn },
                          )
                        }
                      />
                    ) : null}
                  </View>
                )}

                {prize && (
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: colors.emerald400,
                      borderRadius: radius.md,
                      padding: 12,
                      gap: 8,
                    }}
                  >
                    <Text variant="bodyStrong" color={colors.emerald400}>
                      {prize.pct}% off the next hour
                    </Text>
                    <Text variant="small" color={colors.zinc300}>
                      {prize.kind === "ADJACENT" && prize.hour && prize.gone
                        ? `${prize.date ? `${prize.date}, ` : ""}${prize.hour} has been booked by somebody else.`
                        : prize.kind === "ADJACENT" && prize.hour
                        ? `${prize.date ? `${prize.date}, ` : ""}${prize.hour} is free — ₹${prize.price} instead of ₹${(prize.price ?? 0) + (prize.saving ?? 0)}. Ask your side, then take it.`
                        : `The hour after your match is taken. This is good on another hour of the same size of court you just played on — pick one below.`}
                    </Text>
                    <Text variant="tiny" color={colors.zinc500}>
                      {(() => {
                        // Minutes remaining, not a wall-clock time. "Expires
                        // 12:39 PM" on a thirty-minute offer invites the
                        // reading that the HOUR is this afternoon.
                        const mins = Math.max(
                          0,
                          Math.ceil((new Date(prize.expiresAt).getTime() - Date.now()) / 60000),
                        );
                        return mins > 0
                          ? `${mins} minute${mins === 1 ? "" : "s"} left to take it`
                          : "This offer has expired.";
                      })()}
                    </Text>
                    {prize.kind === "ADJACENT" &&
                    !prize.gone &&
                    Math.ceil((new Date(prize.expiresAt).getTime() - Date.now()) / 60000) > 0 ? (
                      <Button
                        label={`Book it — ₹${prize.price}`}
                        variant="primary"
                        loading={paying}
                        disabled={paying}
                        onPress={() => takeOffer()}
                      />
                    ) : prize.kind === "ADJACENT" ? (
                      /* A button that is certain to be refused is not an
                         affordance. The hour has been sold, or the clock has
                         run out — say which, and stop offering it. */
                      <Text variant="small" color={colors.zinc400}>
                        {prize.gone
                          ? "Somebody else booked that hour. Nothing has been charged — this prize can't be used on it."
                          : "That offer has expired."}
                      </Text>
                    ) : slots ? (
                      // Shown as evenings rather than a flat list: "any hour
                      // in the next day" is a choice made by looking at a
                      // night, not by scrolling a hundred rows.
                      <View style={{ gap: 10 }}>
                        {slots.days.map((d) => (
                          <View key={`${d.date}-${d.courtConfigId}`} style={{ gap: 6 }}>
                            <Text variant="tiny" color={colors.zinc500}>
                              {dayLabel(d.date)} · {d.courtLabel}
                            </Text>
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                              {d.hours.map((h) => (
                                <Pressable
                                  key={h.startHour}
                                  disabled={paying}
                                  onPress={() =>
                                    takeOffer({
                                      courtConfigId: d.courtConfigId,
                                      date: d.date,
                                      startHour: h.startHour,
                                    })
                                  }
                                  style={{
                                    paddingHorizontal: 10,
                                    paddingVertical: 6,
                                    borderRadius: radius.md,
                                    borderWidth: 1,
                                    borderColor: colors.emerald400,
                                  }}
                                >
                                  <Text variant="tiny" color={colors.emerald400}>
                                    {h.label} · ₹{h.price}
                                  </Text>
                                </Pressable>
                              ))}
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Button
                        label="Pick an hour"
                        variant="primary"
                        loading={loadingSlots}
                        disabled={loadingSlots}
                        onPress={loadSlots}
                      />
                    )}
                  </View>
                )}
              </>
            ) : c.status === "SLOT_LOST" ? null : quote.youHavePaid ? (
              <Text variant="small" color={colors.zinc300}>
                {/* "The hour is held either way" was true under the old rule and
                    is the single most dangerous thing this screen could now
                    say: nothing holds the court until both halves are in, and a
                    captain who believes otherwise will not chase the other one. */}
                Waiting on the other captain&apos;s half. The hour is NOT held until
                both halves are in, so somebody else can still book it — give them a
                nudge. If it goes, or they never pay, the arena refunds you in full.
              </Text>
            ) : quote.refusal ? (
              <Text variant="small" color={colors.zinc300}>
                {quote.refusal}
              </Text>
            ) : (
              <>
                <Text variant="small" color={colors.zinc300}>
                  {quote.paidSides.length > 0
                    ? // NOT "the hour is booked" — it is not, and this sat
                      // directly under a heading that correctly said so. The
                      // whole point of telling this captain anything is that
                      // their half is what buys the court.
                      "The other captain has paid. The hour is NOT held until your half is in too — pay it to lock the court."
                    : // Was "Whoever pays first blocks the court. Nothing is
                      // held until then." — which contradicted itself inside
                      // one sentence and told the first payer the thing this
                      // design exists to stop them believing.
                      "Nothing is held until you have BOTH paid. Whoever pays first is waiting on the other."}
                </Text>
                <Button
                  label={`Pay my half — ₹${quote.yourShare ?? 0}`}
                  variant="primary"
                  loading={paying}
                  disabled={paying}
                  onPress={() => startPay()}
                />
              </>
            )}
          </View>
        ) : null}

        {/* ABOVE the times, not after them. The hold is the reason the
            buttons below will refuse, so it has to be read before they are
            tapped — that was the whole failure: a live-looking button and
            an explanation that only arrived once it had been pressed. */}
        {hold ? (
          <HoldBanner hold={hold} challengeId={c.id} onReleased={() => void refresh()} />
        ) : null}

        <View style={{ gap: 8 }}>
          <Text variant="tiny" color={colors.zinc500}>
            TIMES ON THE TABLE
          </Text>
          {c.windows
            .filter((w) => w.status !== "SUPERSEDED")
            .map((w) => {
              const isAccepted = w.status === "ACCEPTED";
              const declined = w.status === "DECLINED";
              const canTake = live && takeable.some((t) => t.id === w.id);
              return (
                <View
                  key={w.id}
                  style={{
                    borderWidth: 1,
                    borderColor: isAccepted ? colors.emerald400 : colors.zinc800,
                    borderRadius: radius.md,
                    padding: 12,
                    gap: 8,
                    opacity: declined ? 0.45 : 1,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text
                      variant="body"
                      color={isAccepted ? colors.emerald400 : colors.foreground}
                    >
                      {dayLabel(w.date)} · {hourLabel(w.startHour)}–{hourLabel(w.endHour)}
                    </Text>
                    <Text variant="tiny" color={colors.zinc600}>
                      {w.proposedBy === (mine ? "CHALLENGER" : "ACCEPTOR")
                        ? "your time"
                        : w.proposedBy === "CHALLENGER"
                          ? "their time"
                          : "counter-offer"}
                    </Text>
                  </View>
                  {canTake &&
                    (iAmIn ? (
                      // Already in the match: settling on one of their times
                      // needs no money from this side beyond the half
                      // already owed, so this stays a plain accept.
                      <Button
                        label="Accept this time"
                        variant="primary"
                        size="sm"
                        loading={busy}
                        onPress={() => {
                          trackChallenge("ACCEPT_TAPPED", { challengeId: c.id });
                          void act(() => acceptChallenge(c.id, w.id));
                        }}
                      />
                    ) : (
                      // Taking a stranger's challenge IS paying for it. The
                      // button says so rather than leading with "Take this
                      // match" and producing a payment sheet nobody asked
                      // for — a price on the button is the difference
                      // between a considered tap and an ambushed one.
                      (() => {
                        // THIS window's price and THIS window's refusal. One
                        // quote from the first window used to be stamped on
                        // every button — ₹500 on a slot costing ₹1,300 — and
                        // a window that could not be taken still rendered a
                        // live button that failed with a sentence telling
                        // the user to do what the server had just refused.
                        const wq = windowQuotes.find((x) => x.windowId === w.id);
                        // No quote means this window is not one a stranger
                        // can buy into — an acceptor's counter-offer, say.
                        // A bare "Take this match" with no price here was
                        // always refused by the server.
                        if (!wq) {
                          return (
                            <Text variant="tiny" color={colors.zinc600}>
                              waiting on them
                            </Text>
                          );
                        }
                        if (wq?.refusal) {
                          return (
                            <Text variant="tiny" color={colors.zinc600} style={{ flexShrink: 1 }}>
                              {wq.refusal}
                            </Text>
                          );
                        }
                        return (
                          <View style={{ alignItems: "flex-end", gap: 4 }}>
                            {/* What the game actually costs, BEFORE the
                                money is taken. The share alone reads as the
                                price of the match, and the balance due at
                                the gate was only ever shown afterwards. */}
                            {wq.share !== null && wq.total > 0 && (
                              <Text variant="tiny" color={colors.zinc500} style={{ textAlign: "right" }}>
                                ₹{wq.total} for the court · your half now
                                {wq.venueBalance > 0
                                  ? `, ₹${wq.venueBalance} at the venue on the day`
                                  : ""}
                              </Text>
                            )}
                          <Button
                            label={wq?.share ? `Take it — pay ₹${wq.share}` : "Take this match"}
                            variant="primary"
                            size="sm"
                            loading={paying && payingWindowId === w.id}
                            disabled={paying}
                            onPress={() => {
                              trackChallenge("ACCEPT_TAPPED", { challengeId: c.id });
                              setPayingWindowId(w.id);
                              startPay(w.id);
                            }}
                          />
                          </View>
                        );
                      })()
                    ))}
                </View>
              );
            })}
        </View>

        {/* Counter-offer. Open to whichever side the ball is with — a
            stranger countering an open challenge becomes its acceptor by
            doing so, and the poster answers a counter with one of their
            own. The server enforces the cap and says so if it is spent. */}
        {live && (
          <View style={{ gap: 8 }}>
            {/* A matched challenge cannot be countered — the server refuses
                with "that challenge has already been matched". The status
                exclusions below were suppressing the EXPLANATION and then
                falling through to the button, so the one state where
                countering is impossible was the one that offered it. */}
            {c.status === "AGREED" || c.status === "PART_PAID" ? null : counterBlock ? (
              // The server already told us this viewer's counter is spent (or
              // otherwise not theirs to make), so say so instead of offering a
              // button whose only outcome is that same sentence in an alert.
              <Text variant="tiny" color={colors.zinc600}>
                {counterBlock}
              </Text>
            ) : !showCounter ? (
              <>
                <Text variant="tiny" color={colors.zinc600}>
                  None of those work? Suggest one of your own. It replaces any time you&apos;ve already offered.
                </Text>
                <Button
                  label="Suggest a different time"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => {
                    trackChallenge("COUNTER_OPENED", { challengeId: c.id });
                    setShowCounter(true);
                  }}
                />
              </>
            ) : (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.zinc800,
                  borderRadius: radius.md,
                  padding: 12,
                  gap: 10,
                }}
              >
                <Text variant="tiny" color={colors.zinc500}>
                  YOUR SUGGESTION
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {days.map((d) => (
                      <Pressable key={d} onPress={() => setDay(d)} style={chip(day === d)}>
                        <Text variant="tiny" color={day === d ? colors.emerald400 : colors.zinc400}>
                          {new Date(d).toLocaleDateString("en-IN", {
                            weekday: "short",
                            day: "numeric",
                          })}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {legalHours.map((h) => (
                      <Pressable
                        key={h}
                        onPress={() => {
                          setHour(h);
                          // Late hours have fewer durations available; a
                          // 3h selection carried over from 7pm to midnight
                          // would send a window the arena cannot sell.
                          if (h + len > closeHour) setLen(Math.max(1, closeHour - h));
                        }}
                        style={chip(hour === h)}
                      >
                        <Text variant="tiny" color={hour === h ? colors.emerald400 : colors.zinc400}>
                          {hourLabel(h)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                  <Text variant="tiny" color={colors.zinc500}>
                    for
                  </Text>
                  {/* Only the durations that FIT before closing. Offering
                      1am + 3h produced a window past the arena's last hour,
                      which the server then refused by naming a field — the
                      picker has the closing time, so it should never put the
                      captain in front of that. */}
                  {[1, 2, 3]
                    .filter((n) => hour + n <= closeHour)
                    .map((n) => (
                      <Pressable key={n} onPress={() => setLen(n)} style={chip(len === n)}>
                        <Text variant="tiny" color={len === n ? colors.emerald400 : colors.zinc400}>
                          {n}h
                        </Text>
                      </Pressable>
                    ))}
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button
                    label="Cancel"
                    variant="secondary"
                    size="sm"
                    onPress={() => setShowCounter(false)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    label="Send suggestion"
                    variant="primary"
                    size="sm"
                    loading={busy}
                    style={{ flex: 1 }}
                    onPress={async () => {
                      await act(() =>
                        counterChallenge(c.id, {
                          date: day,
                          startHour: hour,
                          endHour: hour + len,
                        }),
                      );
                      setShowCounter(false);
                    }}
                  />
                </View>
              </View>
            )}
          </View>
        )}

        {mine && live && (
          <Pressable
            onPress={() =>
              Alert.alert("Withdraw this challenge?", "It comes off the board.", [
                { text: "Keep it", style: "cancel" },
                {
                  text: "Withdraw",
                  style: "destructive",
                  onPress: async () => {
                    await act(() => withdrawChallenge(c.id));
                    nav.goBack();
                  },
                },
              ])
            }
            hitSlop={8}
          >
            <Text variant="small" color={colors.zinc500} style={{ textAlign: "center" }}>
              Withdraw this challenge
            </Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Pick a method. Same order and the same default as the booking
          checkout and the pass store: UPI first and pre-selected, the
          gateway second. The point is not symmetry — UPI carries no
          gateway fee, so steering to it is worth real money to the venue
          on every half. */}
      <Modal
        visible={!!choosing}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setChoosing(null);
          setPayingWindowId(null);
        }}
      >
        <Pressable
          style={payStyles.backdrop}
          onPress={() => {
            setChoosing(null);
            setPayingWindowId(null);
          }}
        >
          {/* Swallows the backdrop press so a tap inside the sheet does not
              dismiss the thing being tapped. */}
          <Pressable style={payStyles.sheet} onPress={() => undefined}>
            <Text variant="small" color={colors.zinc500}>
              PAY WITH
            </Text>
            <Pressable
              onPress={() => setMethod("upi")}
              style={[payStyles.tile, method === "upi" && payStyles.tileOn]}
            >
              <Smartphone
                size={18}
                color={method === "upi" ? colors.emerald400 : colors.zinc400}
              />
              <View style={{ flex: 1 }}>
                <Text variant="small" color={colors.foreground}>
                  UPI
                </Text>
                <Text variant="tiny" color={colors.zinc500}>
                  GPay, PhonePe, any UPI app — auto-confirms
                </Text>
              </View>
              <View style={payStyles.badge}>
                <Text variant="tiny" color="#6ee7b7">
                  RECOMMENDED
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => setMethod("razorpay")}
              style={[payStyles.tile, method === "razorpay" && payStyles.tileOn]}
            >
              <CreditCard
                size={18}
                color={method === "razorpay" ? colors.emerald400 : colors.zinc400}
              />
              <View style={{ flex: 1 }}>
                <Text variant="small" color={colors.foreground}>
                  Card / Netbanking
                </Text>
                <Text variant="tiny" color={colors.zinc500}>
                  Via Razorpay — cards, netbanking, wallets
                </Text>
              </View>
            </Pressable>
            <Button
              label="Continue"
              variant="primary"
              onPress={() => {
                const w = choosing?.windowId;
                setChoosing(null);
                if (method === "upi") {
                  // The amount is whatever the server quoted for THIS
                  // window — the sheet only shows it, the claim decides it.
                  const wq = w
                    ? windowQuotes.find((x) => x.windowId === w)
                    : null;
                  setDqrFor({ windowId: w, amount: wq?.share ?? quote?.yourShare ?? 0 });
                } else {
                  void pay(w);
                }
              }}
            />
            <Pressable
              onPress={() => {
                setChoosing(null);
                setPayingWindowId(null);
              }}
              style={{ alignSelf: "center", padding: 8 }}
            >
              <Text variant="small" color={colors.zinc500}>
                Not now
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {dqrFor ? (
        <DqrCheckout
          amount={dqrFor.amount}
          claimSurface="pass"
          endpoints={dqrEndpoints}
          successNote="Your half is in."
          onConfirmed={() => {
            setDqrFor(null);
            setPayingWindowId(null);
            void refresh();
            void qc.invalidateQueries({ queryKey: ["challenges"] });
          }}
          onCancel={() => {
            setDqrFor(null);
            setPayingWindowId(null);
            // The slot was CLAIMED when the QR was minted, so a customer who
            // backs out is holding the half. Re-read so the hold banner
            // appears and they can hand it back.
            void refresh();
          }}
        />
      ) : null}

      <SpinWheel
        visible={wheelOpen}
        segments={q.data?.wheel ?? []}
        landOn={spun?.pct ?? null}
        spinning={spinning}
        onSpin={spin}
        onClose={() => {
          setWheelOpen(false);
          // The prize lives on the SERVER's payload. Closing the wheel
          // without re-reading it dropped the screen back to "Spin the
          // wheel" while a 30-minute clock was already running on the
          // discount they had just won — and tapping Spin again answers
          // "you've already spun for this match", which reads as the prize
          // having been lost.
          void refresh();
        }}
        subtitle={(() => {
          if (!spun) return null;
          // THE DEADLINE BELONGS HERE TOO. The celebratory screen is the one a
          // captain reads first and sometimes the only one they read; omitting
          // the clock meant the single most time-critical fact in the promo
          // appeared only on the card behind it.
          const mins = Math.max(
            0,
            Math.ceil((new Date(spun.expiresAt).getTime() - Date.now()) / 60000),
          );
          const clock = mins > 0 ? ` Take it within ${mins} minute${mins === 1 ? "" : "s"}.` : "";
          return spun.kind === "ADJACENT" && spun.hour
            ? `${spun.date ? `${spun.date}, ` : ""}${spun.hour} for ₹${spun.price} instead of ₹${(spun.price ?? 0) + (spun.saving ?? 0)}.${clock}`
            : `Good on another hour — pick one below.${clock}`;
        })()}
      />
    </Screen>
  );
}

/**
 * "Somebody is paying for this" — as a banner with a clock, not an alert
 * after a wasted tap.
 *
 * The hold was invisible until you tried to pay. The board showed a
 * takeable match, the button looked live, and the refusal said "try again
 * shortly" for a wait that can be the venue's whole payment window. Three
 * people in a row tap Pay, read the same sentence, and conclude the
 * feature is broken.
 *
 * Ticks locally rather than re-fetching: a countdown that only moves when
 * you pull to refresh is a timestamp wearing a costume, and polling every
 * second for a two-hour wait is fifty devices hammering the board. The
 * server's `msLeft` is the truth at load; the clock counts it down, and
 * the next refresh re-anchors it.
 */
function HoldBanner({
  hold,
  challengeId,
  onReleased,
}: {
  hold: PaymentHold;
  challengeId: string;
  onReleased: () => void;
}) {
  const [msLeft, setMsLeft] = useState(hold.msLeft);
  const [releasing, setReleasing] = useState(false);

  // Re-anchor whenever the server speaks again, or a pull-to-refresh would
  // leave the old countdown running against a hold that has changed.
  useEffect(() => setMsLeft(hold.msLeft), [hold.msLeft, hold.freeAt]);

  useEffect(() => {
    if (msLeft <= 0) return;
    const t = setInterval(() => {
      setMsLeft((v) => Math.max(0, v - 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [msLeft <= 0]);

  // mm:ss under an hour, h:mm:ss over it. A bare "7412 seconds" is a number,
  // not an answer.
  const total = Math.ceil(msLeft / 1000);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const clock =
    hh > 0
      ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
      : `${mm}:${String(ss).padStart(2, "0")}`;

  const release = async () => {
    setReleasing(true);
    try {
      const r = await releaseChallengePayHold(challengeId);
      Alert.alert(
        "Released",
        r.shortened
          ? // Say the delay and WHY, or it reads as the release not working.
            "Your payment slot is being given back. It takes a few minutes, so that a UPI payment you already approved can still land on you rather than on whoever takes the match next."
          : // Nothing was shortened because the hold was already about to
            // lapse. Claiming otherwise would be a small lie the next
            // screen refresh contradicts.
            "That slot was already about to open to everyone, so there was nothing to give back.",
      );
      onReleased();
    } catch (e) {
      Alert.alert("Couldn't release that", challengeErrorMessage(e));
    } finally {
      setReleasing(false);
    }
  };

  if (msLeft <= 0) {
    // The clock ran out while the screen was open. Do not keep showing a
    // block that no longer exists — say it is free and let them refresh.
    return (
      <View
        style={{
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.zinc800,
          backgroundColor: colors.card,
          padding: 14,
          gap: 4,
        }}
      >
        <Text variant="small" color={colors.foreground}>
          That hold has lapsed
        </Text>
        <Text variant="tiny" color={colors.zinc400}>
          Pull to refresh and the match should be takeable again.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: hold.heldByViewer ? colors.zinc700 : "#78350f",
        backgroundColor: hold.heldByViewer ? colors.card : "#1c1207",
        padding: 14,
        gap: 8,
      }}
    >
      <Text variant="small" color={colors.foreground}>
        {hold.heldByViewer ? "You have a payment open on this" : "Somebody is paying for this"}
      </Text>
      <Text variant="tiny" color={colors.zinc400}>
        {hold.message}
      </Text>
      <Text variant="tiny" color={hold.heldByViewer ? colors.zinc500 : "#fbbf24"}>
        {hold.heldByViewer ? `Yours for another ${clock}` : `Opens to anyone in ${clock}`}
      </Text>
      {hold.releasable ? (
        <Button
          label="I'm not paying — release it"
          variant="secondary"
          size="sm"
          loading={releasing}
          disabled={releasing}
          onPress={release}
        />
      ) : null}
    </View>
  );
}


const payStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#18181b",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing["5"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  tile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24,24,27,0.6)",
    padding: spacing["3"],
  },
  tileOn: {
    borderColor: colors.emerald500,
    backgroundColor: "rgba(16,185,129,0.08)",
  },
  badge: {
    borderRadius: 999,
    backgroundColor: "rgba(16,185,129,0.15)",
    paddingHorizontal: spacing["2"],
    paddingVertical: 3,
  },
});
