import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import {
  ArrowRight,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react-native";
import { Text } from "../../components/ui/Text";
import { colors, radius, spacing } from "../../theme";
import {
  createInitialContext,
  processMessage,
  type ChatMessage,
} from "../../lib/chat-engine";
import type { MainTabsParamList } from "../../navigation/types";
import type { Sport } from "../../lib/types";

type Nav = BottomTabNavigationProp<MainTabsParamList, "Chat">;

/**
 * Mirrors `components/chatbot/chat-widget.tsx` on web — same chat-engine,
 * same welcome message, same intent flow. Web renders a floating panel;
 * mobile gives the assistant a full tab so the keyboard has somewhere
 * to live and the message history isn't squeezed into a corner.
 */
const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hey! \uD83D\uDC4B I'm the Momentum Arena assistant. I can help with bookings, pricing, sports, timings — anything about our facility. What would you like to know?",
  suggestions: [
    "How to book?",
    "Sports available",
    "Pricing info",
    "Operating hours",
    "Location",
    "Help",
  ],
  timestamp: Date.now(),
};

const FAQ_URL = "https://www.momentumarena.com/faq";

/**
 * Map an href emitted by chat-engine quick-actions to either an in-app
 * navigation action or an external URL. The chat-engine speaks in web
 * routes (`/book`, `/dashboard`, `/cafe/*`); we translate the common
 * ones to React Navigation calls and fall back to opening the
 * equivalent web page for routes the mobile app doesn't have yet
 * (`/faq`, `/rewards`, `/coupons`, …).
 */
function resolveQuickAction(href: string, nav: Nav): () => void {
  // Absolute URL — let the OS handle it (Safari/Chrome/Maps).
  if (/^https?:\/\//i.test(href)) {
    return () => {
      void Linking.openURL(href);
    };
  }

  // /book/{sport} — navigate into the Sports stack at the court picker.
  const bookSportMatch = href.match(/^\/book\/([a-zA-Z]+)$/);
  if (bookSportMatch) {
    const sportSlug = bookSportMatch[1].toUpperCase() as Sport;
    return () =>
      nav.navigate("Sports", {
        screen: "BookCourt",
        params: { sport: sportSlug },
      });
  }

  switch (href) {
    case "/":
      return () => nav.navigate("Home");
    case "/book":
      return () => nav.navigate("Sports", { screen: "BookSport" });
    case "/cafe":
      return () => nav.navigate("Cafe");
    case "/bookings":
      return () =>
        nav.navigate("Account", { screen: "BookingsList" });
    case "/dashboard":
    case "/profile":
      return () =>
        nav.navigate("Account", { screen: "AccountHome" });
    default:
      // Anything we don't know how to handle in-app (e.g. /rewards,
      // /coupons, /faq) falls back to the web — keeps the chat useful
      // even when the mobile app's surface area lags behind.
      return () => {
        void Linking.openURL(`https://www.momentumarena.com${href}`);
      };
  }
}

/**
 * Render `**bold**` segments inside an assistant message. Uses the
 * same simple rule as the web widget: split on `**…**`, render the
 * inner text in a heavier weight.
 */
function FormattedContent({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/(\*\*[^*]+\*\*)/g), [text]);
  return (
    <Text variant="body" color={colors.zinc300}>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <Text
              key={i}
              variant="body"
              weight="700"
              color={colors.foreground}
            >
              {part.slice(2, -2)}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
}

export function ChatScreen() {
  const navigation = useNavigation<Nav>();
  const [messages, setMessages] = useState<ChatMessage[]>([
    WELCOME_MESSAGE,
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [context, setContext] = useState(createInitialContext);
  const scrollRef = useRef<ScrollView>(null);

  // Keep the view pinned to the latest message — mirrors the web's
  // scrollIntoView behaviour. `requestAnimationFrame` waits for layout
  // so the new bubble is measured before we scroll past it.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => cancelAnimationFrame(id);
  }, [messages, isTyping]);

  const handleSend = useCallback(
    (text?: string) => {
      const query = (text ?? input).trim();
      if (!query) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: query,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsTyping(true);

      // Web simulates 200–600ms of "typing" so the bot doesn't reply
      // instantaneously — feels more natural. Same heuristic here.
      const delay = Math.min(200 + query.length * 10, 600);
      setTimeout(() => {
        const { response, updatedContext } = processMessage(query, context);
        setContext(updatedContext);
        setMessages((prev) => [...prev, response]);
        setIsTyping(false);
      }, delay);
    },
    [input, context],
  );

  const handleReset = useCallback(() => {
    setMessages([WELCOME_MESSAGE]);
    setContext(createInitialContext());
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header — matches the web widget's gradient bar (assistant
            name + status pill on the left, action buttons on the
            right). */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.avatar}>
              <Sparkles size={18} color={colors.emerald400} />
            </View>
            <View>
              <Text variant="body" weight="700">
                Arena Assistant
              </Text>
              <Text variant="tiny" color={colors.emerald400}>
                Always online &middot; Free
              </Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={handleReset}
              hitSlop={8}
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityLabel="New conversation"
            >
              <RotateCcw size={16} color={colors.zinc400} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map((msg) => (
            <View key={msg.id} style={styles.messageBlock}>
              <View
                style={[
                  styles.bubbleRow,
                  msg.role === "user"
                    ? styles.bubbleRowRight
                    : styles.bubbleRowLeft,
                ]}
              >
                <View
                  style={[
                    styles.bubble,
                    msg.role === "user"
                      ? styles.bubbleUser
                      : styles.bubbleAssistant,
                  ]}
                >
                  {msg.role === "assistant" ? (
                    <FormattedContent text={msg.content} />
                  ) : (
                    <Text variant="body" color="#fff">
                      {msg.content}
                    </Text>
                  )}
                </View>
              </View>

              {msg.quickActions && msg.quickActions.length > 0 ? (
                <View style={styles.chipRow}>
                  {msg.quickActions.map((action) => (
                    <Pressable
                      key={action.href}
                      onPress={resolveQuickAction(action.href, navigation)}
                      style={({ pressed }) => [
                        styles.chip,
                        styles.chipAction,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text
                        variant="tiny"
                        weight="600"
                        color={colors.emerald400}
                      >
                        {action.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {msg.suggestions && msg.suggestions.length > 0 ? (
                <View style={styles.chipRow}>
                  {msg.suggestions.map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => handleSend(s)}
                      style={({ pressed }) => [
                        styles.chip,
                        styles.chipSuggestion,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text variant="tiny" color={colors.zinc400}>
                        {s}
                      </Text>
                      <ArrowRight
                        size={12}
                        color={colors.zinc500}
                        style={styles.chipIcon}
                      />
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ))}

          {/* "Typing…" three-dot indicator while the next reply is
              being generated. Pure cosmetics — the engine itself is
              synchronous, the delay is the artificial 200-600ms above. */}
          {isTyping ? (
            <View style={[styles.bubbleRow, styles.bubbleRowLeft]}>
              <View style={[styles.bubble, styles.bubbleAssistant, styles.typing]}>
                <View style={styles.typingDot} />
                <View style={styles.typingDot} />
                <View style={styles.typingDot} />
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.inputRow}>
            <TextInput
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => handleSend()}
              placeholder="Ask anything about Momentum Arena..."
              placeholderTextColor={colors.zinc500}
              returnKeyType="send"
              editable={!isTyping}
              blurOnSubmit={false}
              style={styles.input}
            />
            <Pressable
              onPress={() => handleSend()}
              disabled={!input.trim() || isTyping}
              style={({ pressed }) => [
                styles.sendBtn,
                (!input.trim() || isTyping) && styles.sendBtnDisabled,
                pressed && input.trim() && !isTyping && { opacity: 0.85 },
              ]}
              accessibilityLabel="Send message"
            >
              <Send size={16} color="#fff" />
            </Pressable>
          </View>
          <Pressable
            onPress={() => {
              void Linking.openURL(FAQ_URL);
            }}
            style={({ pressed }) => [
              styles.faqBtn,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text variant="tiny" color={colors.zinc600} align="center">
              Powered by Momentum Arena &middot; View all FAQs
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["3"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    backgroundColor: colors.emerald500_10,
    borderWidth: 1,
    borderColor: colors.emerald500_20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerActions: {
    flexDirection: "row",
    gap: spacing["1"],
  },
  iconBtn: {
    padding: spacing["2"],
    borderRadius: radius.md,
  },
  messagesContent: {
    padding: spacing["4"],
    gap: spacing["4"],
  },
  messageBlock: {
    gap: spacing["2"],
  },
  bubbleRow: {
    flexDirection: "row",
  },
  bubbleRowLeft: {
    justifyContent: "flex-start",
  },
  bubbleRowRight: {
    justifyContent: "flex-end",
  },
  bubble: {
    maxWidth: "88%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.xl,
  },
  bubbleAssistant: {
    backgroundColor: "rgba(39, 39, 42, 0.80)", // zinc-800/80
    borderWidth: 1,
    borderColor: "rgba(63, 63, 70, 0.50)", // zinc-700/50
    borderBottomLeftRadius: radius.sm,
  },
  bubbleUser: {
    backgroundColor: colors.primaryHover, // emerald-600
    borderBottomRightRadius: radius.sm,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2"],
    paddingLeft: spacing["1"],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  chipAction: {
    backgroundColor: colors.emerald500_10,
    borderColor: colors.emerald500_30,
  },
  chipSuggestion: {
    backgroundColor: "rgba(39, 39, 42, 0.40)",
    borderColor: "rgba(63, 63, 70, 0.60)",
  },
  chipIcon: {
    opacity: 0.6,
  },
  typing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.emerald400,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: "rgba(24, 24, 27, 0.50)",
    paddingHorizontal: spacing["3"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["3"],
    gap: spacing["2"],
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  input: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(63, 63, 70, 0.60)",
    backgroundColor: "rgba(39, 39, 42, 0.60)",
    color: colors.foreground,
    fontSize: 14,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryHover,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  faqBtn: {
    paddingVertical: 2,
  },
});
