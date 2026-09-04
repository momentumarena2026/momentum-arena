import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Send, Sparkles } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius, spacing } from "../../theme";
import { api } from "../../lib/api";
import { bookingApi } from "../../lib/booking";
import { useAuth } from "../../providers/AuthProvider";
import type { BookStackParamList, RootStackParamList } from "../../navigation/types";
import type { NavigationProp as RootNavType } from "@react-navigation/native";

/**
 * Conversational booking.
 *
 * The screen is a thin shell: it sends a sentence to /api/mobile/booking-bot
 * and renders whatever comes back. Every decision — parsing, court choice,
 * pricing, alternatives — is made server-side by lib/booking-bot, so the
 * two can never disagree and the rules can be fixed without an app update.
 *
 * Confirming a proposal calls the SAME bookingApi.lock + Checkout route the
 * slot picker uses. There is no bot-specific payment path: the bot's job
 * ends the moment a hold exists.
 */

type Proposal = {
  sport: string;
  courtConfigId: string;
  courtLabel: string;
  date: string;
  startHour: number;
  endHour: number;
  hours: number[];
  timeLabel: string;
  price: number;
};

type Suggestion = Proposal & { differentCourt: boolean };

/** The partial reading the server hands back so the next turn can build on it. */
type ParsedContext = {
  sport: string | null;
  date: string | null;
  startHour: number | null;
  endHour: number | null;
  assumedPm: boolean;
  assumedToday: boolean;
  missing: string[];
};

type BotReply =
  | { kind: "needs"; missing: string[]; message: string; parsed?: ParsedContext }
  | { kind: "proposal"; message: string; note: string | null; proposal: Proposal }
  | { kind: "taken"; message: string; requested: { date: string; timeLabel: string }; suggestions: Suggestion[] };

type Bubble =
  | { id: string; from: "me"; text: string }
  | { id: string; from: "bot"; reply: BotReply };

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00.000Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });

/** Chips offered when the sentence was short something. */
const QUICK: Record<string, string[]> = {
  sport: ["Cricket", "Football", "Pickleball"],
  date: ["today", "tomorrow", "saturday"],
  time: ["6-7 pm", "7-8 pm", "8-9 pm"],
};

let seq = 0;
const nextId = () => `b${++seq}`;

export function BookingBotScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<BookStackParamList>>();
  const { state } = useAuth();
  const listRef = useRef<FlatList<Bubble>>(null);

  const [bubbles, setBubbles] = useState<Bubble[]>([
    {
      id: nextId(),
      from: "bot",
      reply: {
        kind: "needs",
        missing: [],
        message:
          "Tell me what you'd like to book — say something like \"football tomorrow 7 to 8 pm\".",
      },
    },
  ]);
  /**
   * What the conversation already knows, carried between turns.
   *
   * The server parses each message in isolation, so without this the chip
   * path loops: "football tomorrow" asks for a time, and tapping "7-8 pm"
   * asks for a sport again. Cleared once a proposal lands, so the next
   * request starts clean rather than inheriting a finished booking.
   */
  const [context, setContext] = useState<ParsedContext | null>(null);
  /**
   * Mirrors of the mutable state that `send` reads.
   *
   * FlatList does NOT re-render a row just because renderItem's closure
   * changed — only when `data` or `extraData` does. So chip rows kept the
   * `send` captured when they mounted, complete with the in-flight guard
   * still true from the request that produced them, and every chip tap
   * after the first turn hit `if (sending) return` and silently did
   * nothing. Reading these through refs keeps `send` and `renderBubble`
   * stable, so no row can hold a stale one.
   */
  const sendingRef = useRef(false);
  const contextRef = useRef<ParsedContext | null>(null);
  const lockingRef = useRef(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollDown = useCallback(() => {
    // A beat, so the row is measured before we scroll to it.
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sendingRef.current) return;

      if (!state || state.status !== "signedIn") {
        navigation
          .getParent<RootNavType<RootStackParamList>>()
          ?.navigate("Phone");
        return;
      }

      setError(null);
      setDraft("");
      setBubbles((b) => [...b, { id: nextId(), from: "me", text }]);
      scrollDown();
      sendingRef.current = true;
      setSending(true);
      try {
        const reply = await api.post<BotReply>("/api/mobile/booking-bot", {
          text,
          context: contextRef.current,
        });
        setBubbles((b) => [...b, { id: nextId(), from: "bot", reply }]);
        // Carry a partial reading forward; drop it the moment the booking
        // is fully specified so a later message starts fresh.
        const next = reply.kind === "needs" ? (reply.parsed ?? null) : null;
        contextRef.current = next;
        setContext(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't reach the assistant");
      } finally {
        sendingRef.current = false;
        setSending(false);
        scrollDown();
      }
    },
    [navigation, scrollDown, state],
  );

  /**
   * Confirm → hold → the existing checkout. Availability is re-checked
   * server-side inside lock(), so a slot taken between the proposal and
   * this tap fails here rather than double-selling.
   */
  const confirm = useCallback(
    async (p: Proposal) => {
      if (lockingRef.current) return;
      lockingRef.current = true;
      setLocking(true);
      setError(null);
      try {
        const res = await bookingApi.lock({
          courtConfigId: p.courtConfigId,
          date: p.date,
          hours: p.hours,
        });
        if (!res?.holdId) throw new Error("That slot just went — try another time.");
        navigation.navigate("Checkout", { holdId: res.holdId });
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Couldn't hold that slot — it may have gone.",
        );
      } finally {
        lockingRef.current = false;
        setLocking(false);
      }
    },
    [navigation],
  );

  const renderBubble = useCallback(
    ({ item }: { item: Bubble }) => {
      if (item.from === "me") {
        return (
          <View style={styles.meRow}>
            <View style={styles.me}>
              <Text style={styles.meText}>{item.text}</Text>
            </View>
          </View>
        );
      }

      const r = item.reply;
      return (
        <View style={styles.botRow}>
          <View style={styles.bot}>
            <Text style={styles.botText}>{r.message}</Text>

            {r.kind === "needs" && r.missing.length > 0 && (
              <View style={styles.chips}>
                {r.missing.flatMap((m) =>
                  (QUICK[m] ?? []).map((label) => (
                    <Pressable
                      key={`${m}-${label}`}
                      onPress={() => void send(label)}
                      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.75 }]}
                    >
                      <Text style={styles.chipText}>{label}</Text>
                    </Pressable>
                  )),
                )}
              </View>
            )}

            {r.kind === "proposal" && (
              <>
                <ProposalCard p={r.proposal} />
                {r.note ? <Text style={styles.note}>{r.note}</Text> : null}
                <Pressable
                  onPress={() => void confirm(r.proposal)}
                  disabled={locking}
                  style={({ pressed }) => [
                    styles.cta,
                    (pressed || locking) && { opacity: 0.8 },
                  ]}
                >
                  {locking ? (
                    <ActivityIndicator color="#04140e" size="small" />
                  ) : (
                    <Text style={styles.ctaText}>
                      Confirm &amp; pay {inr(r.proposal.price)}
                    </Text>
                  )}
                </Pressable>
              </>
            )}

            {r.kind === "taken" && r.suggestions.length > 0 && (
              <View style={styles.suggestions}>
                {r.suggestions.map((s) => (
                  <Pressable
                    key={`${s.courtConfigId}-${s.startHour}`}
                    onPress={() => void confirm(s)}
                    style={({ pressed }) => [styles.sug, pressed && { opacity: 0.8 }]}
                  >
                    <View style={styles.sugMain}>
                      <Text style={styles.sugTime}>{s.timeLabel}</Text>
                      <Text style={styles.sugMeta}>
                        {s.courtLabel}
                        {s.differentCourt ? " · other court" : ""}
                      </Text>
                    </View>
                    <Text style={styles.sugPrice}>{inr(s.price)}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </View>
      );
    },
    [confirm, locking, send],
  );
  // Belt and braces: even with stable callbacks, tell FlatList when the
  // things a row RENDERS (the confirm spinner) have changed.

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <FlatList
          ref={listRef}
          data={bubbles}
          keyExtractor={(b) => b.id}
          renderItem={renderBubble}
          extraData={locking}
          contentContainerStyle={styles.list}
          onContentSizeChange={scrollDown}
          keyboardShouldPersistTaps="handled"
        />

        {sending && (
          <View style={styles.typing}>
            <ActivityIndicator size="small" color={colors.zinc500} />
            <Text style={styles.typingText}>Checking availability…</Text>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="football tomorrow 7 to 8 pm"
            placeholderTextColor={colors.zinc600}
            style={styles.input}
            returnKeyType="send"
            onSubmitEditing={() => void send(draft)}
            editable={!sending}
          />
          <Pressable
            onPress={() => void send(draft)}
            disabled={sending || !draft.trim()}
            style={({ pressed }) => [
              styles.sendBtn,
              (!draft.trim() || sending) && { opacity: 0.4 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Send size={18} color="#04140e" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function ProposalCard({ p }: { p: Proposal }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Sparkles size={13} color={colors.emerald400} />
        <Text style={styles.cardCourt}>{p.courtLabel}</Text>
      </View>
      <Text style={styles.cardWhen}>
        {dayLabel(p.date)} · {p.timeLabel}
      </Text>
      <Text style={styles.cardPrice}>{inr(p.price)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: spacing["4"], gap: 10, paddingBottom: 16 },

  meRow: { alignItems: "flex-end" },
  me: {
    maxWidth: "84%",
    backgroundColor: colors.emerald500_10,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    borderRadius: radius.lg,
    borderBottomRightRadius: 4,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  meText: { color: colors.foreground, fontSize: 14.5 },

  botRow: { alignItems: "flex-start" },
  bot: {
    maxWidth: "92%",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 10,
  },
  botText: { color: colors.zinc300, fontSize: 14.5, lineHeight: 20 },
  note: { color: colors.yellow400, fontSize: 12, lineHeight: 17 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: 999,
    paddingHorizontal: 13,
    height: 32,
    justifyContent: "center",
  },
  chipText: { color: colors.zinc300, fontSize: 13, fontWeight: "600" },

  card: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    borderRadius: radius.lg,
    padding: 13,
    gap: 3,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardCourt: { color: colors.foreground, fontSize: 15, fontWeight: "700" },
  cardWhen: { color: colors.zinc400, fontSize: 13 },
  cardPrice: {
    color: colors.emerald400,
    fontSize: 19,
    fontWeight: "800",
    marginTop: 2,
  },

  cta: {
    backgroundColor: colors.emerald500,
    borderRadius: radius.lg,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { color: "#04140e", fontSize: 15, fontWeight: "800" },

  suggestions: { gap: 8 },
  sug: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  sugMain: { flex: 1, gap: 2 },
  sugTime: { color: colors.foreground, fontSize: 14.5, fontWeight: "700" },
  sugMeta: { color: colors.zinc500, fontSize: 12 },
  sugPrice: { color: colors.emerald400, fontSize: 15, fontWeight: "700" },

  typing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing["4"],
    paddingBottom: 6,
  },
  typingText: { color: colors.zinc500, fontSize: 12.5 },
  error: {
    color: colors.destructive,
    fontSize: 13,
    paddingHorizontal: spacing["4"],
    paddingBottom: 6,
  },

  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: spacing["4"],
    paddingTop: 10,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    color: colors.foreground,
    fontSize: 14.5,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.emerald500,
    alignItems: "center",
    justifyContent: "center",
  },
});
