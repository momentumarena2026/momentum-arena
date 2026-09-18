import { useState } from "react";
import { View, ScrollView, Pressable, Alert, RefreshControl } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { colors, radius } from "../../theme";
import type { AccountStackParamList } from "../../navigation/types";
import {
  fetchChallenge,
  acceptChallenge,
  counterChallenge,
  withdrawChallenge,
  hourLabel,
  dayLabel,
  trackChallenge,
  challengeErrorMessage,
  createChallengePayOrder,
  verifyChallengePayment,
  spinChallengeWheel,
  createOfferPayOrder,
  verifyOfferPayment,
  type SpinResult,
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
export function ChallengeDetailScreen() {
  const route = useRoute<RouteProp<AccountStackParamList, "ChallengeDetail">>();
  const nav = useNavigation();
  const qc = useQueryClient();
  const id = route.params.id;
  const [busy, setBusy] = useState(false);
  const [showCounter, setShowCounter] = useState(false);
  const [paying, setPaying] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [spun, setSpun] = useState<SpinResult | null>(null);
  const { state: authState } = useAuth();

  // The next seven days — as far ahead as anyone arranges a pickup game.
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    return d.toISOString().slice(0, 10);
  });
  const hours = Array.from({ length: 20 }, (_, i) => i + 5); // 5am–1am
  const [day, setDay] = useState<string>(days[0]);
  const [hour, setHour] = useState<number>(18);
  const [len, setLen] = useState<number>(2);

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
  const mine = c.createdByUserId === me;
  const iAmIn = mine || c.acceptedByUserId === me;
  const live = ["OPEN", "COUNTERED"].includes(c.status);
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
  const pay = async (acceptWindowId?: string) => {
    setPaying(true);
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
      } catch {
        return; // sheet dismissed — nothing was charged, say nothing
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
        res.status === "CONFIRMED" ? "Match confirmed" : "Court held",
        res.status === "CONFIRMED"
          ? "Both halves are in and the court is booked. See you there."
          : acceptWindowId
            ? "You're in, and the hour is now blocked. We've told the other captain their half is due."
            : "Your half is paid and the hour is now blocked. We've told the other captain theirs is due.",
      );
    } catch (e) {
      Alert.alert("Payment problem", challengeErrorMessage(e));
    } finally {
      setPaying(false);
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
      Alert.alert("No spin", challengeErrorMessage(e));
    } finally {
      setSpinning(false);
    }
  };

  /** Pay for the whole discounted hour. No split — the captain fronts it. */
  const takeOffer = async () => {
    if (!spun) return;
    setPaying(true);
    try {
      const order = await createOfferPayOrder(spun.offerId);
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
          description: `${spun.pct}% off ${spun.hour ?? "an extra hour"}`,
          order_id: order.orderId,
          prefill: {
            name: authState.user?.name ?? "",
            email: authState.user?.email ?? "",
            contact: authState.user?.phone ?? "",
          },
          theme: { color: colors.emerald500 },
        })) as typeof paid;
      } catch {
        return; // sheet dismissed — the offer is still live
      }
      await verifyOfferPayment({
        offerId: spun.offerId,
        razorpayOrderId: paid.razorpay_order_id ?? "",
        razorpayPaymentId: paid.razorpay_payment_id ?? "",
        razorpaySignature: paid.razorpay_signature ?? "",
      });
      setSpun(null);
      await refresh();
      Alert.alert("Booked", `That hour is yours at ${spun.pct}% off. See you there.`);
    } catch (e) {
      Alert.alert("Couldn't book it", challengeErrorMessage(e));
    } finally {
      setPaying(false);
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
            {c.status.replace("_", " ").toLowerCase()}
          </Text>
          {c.notes ? (
            <Text variant="small" color={colors.zinc400} style={{ marginTop: 4 }}>
              {c.notes}
            </Text>
          ) : null}
        </View>

        {(c.status === "AGREED" || c.status === "PART_PAID" || c.status === "CONFIRMED") &&
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
            <Text variant="bodyStrong" color={colors.emerald400}>
              {c.status === "CONFIRMED"
                ? "Match confirmed"
                : c.status === "PART_PAID"
                  ? quote.youHavePaid
                    ? "Your half is in"
                    : "The court is held — your half is due"
                  : "Match agreed"}
            </Text>

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
                {mine && !spun && (
                  <Button
                    label="Spin for a discount on the next hour"
                    variant="primary"
                    loading={spinning}
                    disabled={spinning}
                    onPress={spin}
                  />
                )}
                {spun && (
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
                      {spun.pct}% off the next hour
                    </Text>
                    <Text variant="small" color={colors.zinc300}>
                      {spun.kind === "ADJACENT" && spun.hour
                        ? `${spun.hour} is free — ₹${spun.price} instead of ₹${(spun.price ?? 0) + (spun.saving ?? 0)}. Ask your side, then take it.`
                        : `The hour after your match is taken, so this is good on any hour in the next day.`}
                    </Text>
                    <Text variant="tiny" color={colors.zinc500}>
                      Expires {new Date(spun.expiresAt).toLocaleTimeString("en-IN", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Text>
                    {spun.kind === "ADJACENT" && (
                      <Button
                        label={`Book it — ₹${spun.price}`}
                        variant="primary"
                        loading={paying}
                        disabled={paying}
                        onPress={takeOffer}
                      />
                    )}
                  </View>
                )}
              </>
            ) : quote.youHavePaid ? (
              <Text variant="small" color={colors.zinc300}>
                Waiting on the other captain's half. The hour is held either way —
                if they never pay, the arena will sort it out with you.
              </Text>
            ) : quote.refusal ? (
              <Text variant="small" color={colors.zinc300}>
                {quote.refusal}
              </Text>
            ) : (
              <>
                <Text variant="small" color={colors.zinc300}>
                  {quote.paidSides.length > 0
                    ? "The other captain has paid and the hour is booked. Pay your half to confirm the match."
                    : "Whoever pays first blocks the court. Nothing is held until then."}
                </Text>
                <Button
                  label={`Pay my half — ₹${quote.yourShare ?? 0}`}
                  variant="primary"
                  loading={paying}
                  disabled={paying}
                  onPress={() => pay()}
                />
              </>
            )}
          </View>
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
                      {w.proposedBy === "CHALLENGER" ? "their time" : "counter-offer"}
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
                      <Button
                        label={
                          quote?.shares.ACCEPTOR
                            ? `Take it — pay ₹${quote.shares.ACCEPTOR}`
                            : "Take this match"
                        }
                        variant="primary"
                        size="sm"
                        loading={paying}
                        disabled={paying}
                        onPress={() => {
                          trackChallenge("ACCEPT_TAPPED", { challengeId: c.id });
                          void pay(w.id);
                        }}
                      />
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
            {counterBlock ? (
              // The server already told us this viewer's counter is spent (or
              // otherwise not theirs to make), so say so instead of offering a
              // button whose only outcome is that same sentence in an alert.
              <Text variant="tiny" color={colors.zinc600}>
                {counterBlock}
              </Text>
            ) : !showCounter ? (
              <>
                <Text variant="tiny" color={colors.zinc600}>
                  None of those work? Suggest one of your own — one counter-offer each.
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
                    {hours.map((h) => (
                      <Pressable key={h} onPress={() => setHour(h)} style={chip(hour === h)}>
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
                  {[1, 2, 3].map((n) => (
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
    </Screen>
  );
}
