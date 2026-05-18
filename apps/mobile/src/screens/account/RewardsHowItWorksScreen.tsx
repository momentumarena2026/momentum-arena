import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ColorValue,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useQuery } from "@tanstack/react-query";
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import {
  ArrowRight,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  Coffee,
  Coins,
  Gift,
  IndianRupee,
  Info,
  Percent,
  Sparkles,
  TrendingUp,
  Trophy,
  Wallet,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { colors, radius, spacing } from "../../theme";
import { rewardsApi } from "../../lib/rewards";
import type {
  AccountStackParamList,
  MainTabsParamList,
} from "../../navigation/types";

type Nav = NativeStackNavigationProp<AccountStackParamList, "RewardsHowItWorks">;

// ─── Tone palette ────────────────────────────────────────────────────────

type Tone = "emerald" | "amber" | "yellow" | "sky" | "zinc";

const TONE: Record<
  Tone,
  {
    accent: ColorValue;
    accentSoft: ColorValue;
    border: ColorValue;
  }
> = {
  emerald: {
    accent: colors.emerald400,
    accentSoft: colors.emerald500_10,
    border: colors.emerald500_30,
  },
  amber: {
    accent: "#fcd34d",
    accentSoft: "rgba(245, 158, 11, 0.10)",
    border: "rgba(245, 158, 11, 0.30)",
  },
  yellow: {
    accent: colors.yellow300,
    accentSoft: colors.yellow500_10,
    border: colors.yellow500_30,
  },
  sky: {
    accent: "#7dd3fc",
    accentSoft: "rgba(14, 165, 233, 0.10)",
    border: "rgba(14, 165, 233, 0.30)",
  },
  zinc: {
    accent: colors.zinc300,
    accentSoft: "rgba(39, 39, 42, 0.60)",
    border: colors.zinc700,
  },
};

// ─── Screen ──────────────────────────────────────────────────────────────

/**
 * Mobile "How Momentum Points work" page.
 *
 * Mirrors the web /rewards/how-it-works visual structure: hero with
 * friendly copy + balance, 3-step flow, worked example using live
 * config, earn cards, spend rules, expiry timeline (SVG), FAQ, CTAs.
 *
 * Every number is driven by rewardsApi.overview() (which wraps
 * getMyRewardOverview on the server), so admin edits in /admin/rewards
 * land here on the next focus refetch.
 */
export function RewardsHowItWorksScreen() {
  const navigation = useNavigation<Nav>();
  const overviewQ = useQuery({
    queryKey: ["rewards", "overview"],
    queryFn: () => rewardsApi.overview(),
    staleTime: 5 * 60 * 1000,
  });

  const overview = overviewQ.data?.overview ?? null;
  const cfg = overview?.config ?? null;

  const onRefresh = useCallback(() => {
    void overviewQ.refetch();
  }, [overviewQ]);

  // Live-number derivations
  const numbers = useMemo(() => {
    if (!cfg) return null;
    const earnPctBooking = Math.round(cfg.earnRateBookingBps / 100);
    const earnPctCafe = Math.round(cfg.earnRateCafeBps / 100);
    const pointValueRupees = (cfg.pointValuePaise / 100).toFixed(
      cfg.pointValuePaise % 100 === 0 ? 0 : 2,
    );
    const maxRedemptionRupees = cfg.maxRedemptionPaisePerTxn
      ? Math.round(cfg.maxRedemptionPaisePerTxn / 100)
      : null;
    // Worked example — ₹800 (typical pickleball night slot).
    const exampleSpend = 800;
    const examplePtsEarned = Math.floor(
      (exampleSpend * cfg.earnRateBookingBps) / 10000,
    );
    const exampleRupeesEarned = Math.floor(
      (examplePtsEarned * cfg.pointValuePaise) / 100,
    );
    return {
      earnPctBooking,
      earnPctCafe,
      pointValueRupees,
      maxRedemptionRupees,
      exampleSpend,
      examplePtsEarned,
      exampleRupeesEarned,
    };
  }, [cfg]);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={overviewQ.isRefetching}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* HERO */}
        <View style={styles.hero}>
          <View style={styles.heroEyebrow}>
            <Sparkles size={14} color={colors.emerald400} />
            <Text style={styles.heroEyebrowText}>Momentum Points</Text>
          </View>
          <Text style={styles.heroTitle}>
            The more you play,
          </Text>
          <Text style={styles.heroTitleAccent}>the more you save.</Text>
          <Text style={styles.heroBody}>
            Every booking earns you points. Every point trims your next bill.
            No codes, no catches.
          </Text>

          {/* Live balance */}
          {overview ? (
            <View style={styles.heroBalance}>
              <Text style={styles.heroBalanceLabel}>YOU HAVE</Text>
              <View style={styles.heroBalanceRow}>
                <Text style={styles.heroBalanceValue}>
                  {overview.pointsAvailable.toLocaleString("en-IN")}
                </Text>
                <Text style={styles.heroBalanceUnit}>pts</Text>
              </View>
              <Text style={styles.heroBalanceWorth}>
                = ₹
                {Math.round(overview.pointsValuePaise / 100).toLocaleString("en-IN")}{" "}
                off your next booking
              </Text>
            </View>
          ) : null}

          {cfg && !cfg.enabled ? (
            <View style={styles.warnPill}>
              <Info size={14} color="#fcd34d" />
              <Text style={styles.warnText}>Rewards are paused right now</Text>
            </View>
          ) : null}
        </View>

        {/* 3 STEPS */}
        {numbers ? (
          <View>
            <SectionLabel>The whole thing in 3 steps</SectionLabel>
            <View style={styles.stepStack}>
              <StepCard
                n={1}
                tone="emerald"
                Icon={Calendar}
                title="Book a court"
                body="Cricket, football, pickleball — or a snack from the cafe."
              />
              <StepCard
                n={2}
                tone="amber"
                Icon={Sparkles}
                title="Earn points"
                body={`${numbers.earnPctBooking}% of every booking comes straight back as Momentum Points.`}
              />
              <StepCard
                n={3}
                tone="yellow"
                Icon={Wallet}
                title="Save next time"
                body="Tick one checkbox at checkout. Your points cut your bill instantly."
              />
            </View>
          </View>
        ) : null}

        {/* WORKED EXAMPLE */}
        {numbers ? (
          <View style={styles.exampleCard}>
            <SectionLabel style={{ color: colors.yellow300 }}>
              See it with real numbers
            </SectionLabel>
            <Text style={styles.exampleIntro}>
              What actually happens when you book a ₹{numbers.exampleSpend}{" "}
              pickleball slot at tonight's rate:
            </Text>

            <View style={styles.examplePillCol}>
              <ExamplePill
                Icon={IndianRupee}
                label="You pay"
                value={`₹${numbers.exampleSpend}`}
                tone="zinc"
              />
              <View style={styles.examplePillArrow}>
                <ArrowRight size={16} color={colors.zinc600} />
              </View>
              <ExamplePill
                Icon={Sparkles}
                label={`Earn ${numbers.earnPctBooking}% back`}
                value={`+${numbers.examplePtsEarned.toLocaleString("en-IN")} pts`}
                tone="emerald"
              />
              <View style={styles.examplePillArrow}>
                <ArrowRight size={16} color={colors.zinc600} />
              </View>
              <ExamplePill
                Icon={Wallet}
                label="Next time save"
                value={`₹${numbers.exampleRupeesEarned.toLocaleString("en-IN")}`}
                tone="yellow"
              />
            </View>

            <Text style={styles.exampleFoot}>
              That's it. No promo codes — just a checkbox at checkout that
              takes ₹{numbers.exampleRupeesEarned} off your next bill.
            </Text>
          </View>
        ) : null}

        {/* HOW YOU EARN */}
        {numbers && cfg ? (
          <View>
            <SectionLabel>How you earn</SectionLabel>
            <Text style={styles.sectionSub}>
              Points show up automatically — you don't have to claim anything.
            </Text>
            <View style={styles.earnGrid}>
              <EarnCard
                Icon={TrendingUp}
                tone="emerald"
                headline={`${numbers.earnPctBooking}% back`}
                title="Every confirmed booking"
                body={`Spend ₹100 on a slot, get ${numbers.earnPctBooking} pts back. Lands the moment your booking confirms.`}
              />
              {cfg.cafeEarnEnabled ? (
                <EarnCard
                  Icon={Coffee}
                  tone="amber"
                  headline={`${numbers.earnPctCafe}% back`}
                  title="Cafe orders too"
                  body="Coffee, snacks, full meals — same earn rate as bookings."
                />
              ) : null}
              <EarnCard
                Icon={Gift}
                tone="yellow"
                headline="🎁"
                title="Bonus events"
                body="Welcome bonuses, referrals, birthday treats, and the occasional venue-wide promo land straight in your balance."
              />
              <EarnCard
                Icon={Trophy}
                tone="emerald"
                headline="∞"
                title="No cap on earning"
                body="There's no ceiling on how many points you can rack up. Play more, save more."
              />
            </View>
          </View>
        ) : null}

        {/* HOW YOU SPEND */}
        {numbers && cfg ? (
          <View>
            <SectionLabel>How you spend</SectionLabel>
            <Text style={styles.sectionSub}>
              A few sensible rules so the system stays fair for everyone.
            </Text>
            <View style={styles.ruleStack}>
              <RuleRow
                Icon={Coins}
                tone="yellow"
                title={`1 point = ₹${numbers.pointValueRupees}`}
                body={`Plain and simple. Every point is ₹${numbers.pointValueRupees} off your bill — no exchange rates, no fine print.`}
              />
              <RuleRow
                Icon={CheckCircle2}
                tone="emerald"
                title={`Start spending from ${cfg.minPointsToRedeem.toLocaleString("en-IN")} pts`}
                body={`We hold you back from spending until you have at least ${cfg.minPointsToRedeem.toLocaleString(
                  "en-IN",
                )} points — keeps the discount meaningful.`}
              />
              <RuleRow
                Icon={Percent}
                tone="sky"
                title={`Up to ${cfg.maxRedemptionPctOfBill}% of any bill`}
                body={`Points can cover up to ${cfg.maxRedemptionPctOfBill}% of any booking or cafe order. Pay the rest as usual.`}
              />
              {numbers.maxRedemptionRupees ? (
                <RuleRow
                  Icon={IndianRupee}
                  tone="sky"
                  title={`Cap of ₹${numbers.maxRedemptionRupees.toLocaleString("en-IN")} per transaction`}
                  body="The most rupees that can come off a single bill in points. Keeps things balanced across members."
                />
              ) : null}
              {cfg.earnToRedeemMinHours > 0 ? (
                <RuleRow
                  Icon={Clock}
                  tone="zinc"
                  title={`A short ${cfg.earnToRedeemMinHours}-hour wait`}
                  body={`Points you just earned are usable after ${cfg.earnToRedeemMinHours} hour${cfg.earnToRedeemMinHours === 1 ? "" : "s"}. (Safety thing — stops refund loops.)`}
                />
              ) : null}
            </View>
          </View>
        ) : null}

        {/* EXPIRY TIMELINE */}
        <View style={styles.expiryCard}>
          <SectionLabel>Time to use them</SectionLabel>
          <View style={styles.expiryHead}>
            <View style={styles.expiryIcon}>
              <CalendarClock size={26} color={colors.zinc300} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.expiryTitle}>Each batch lasts 12 months</Text>
              <Text style={styles.expiryBody}>
                Points expire 12 months after they're earned. Your statement
                flags any batch that's about to drop off so you never lose
                them by accident.
              </Text>
            </View>
          </View>

          {/* SVG timeline — gradient from emerald (just earned) to grey
              (expiring soon). 13 dots = 12 months between the bookends. */}
          <Svg viewBox="0 0 600 60" style={styles.svg}>
            <Defs>
              <SvgLinearGradient id="tg" x1="0" x2="1" y1="0" y2="0">
                <Stop offset="0%" stopColor="#10b981" />
                <Stop offset="70%" stopColor="#fde047" />
                <Stop offset="100%" stopColor="#71717a" />
              </SvgLinearGradient>
            </Defs>
            <Rect
              x="0"
              y="22"
              width="600"
              height="6"
              rx="3"
              fill="url(#tg)"
              opacity={0.7}
            />
            {Array.from({ length: 13 }).map((_, i) => {
              const isEdge = i === 0 || i === 12;
              return (
                <Circle
                  key={i}
                  cx={i * 50}
                  cy={25}
                  r={isEdge ? 6 : 3}
                  fill={i === 0 ? "#34d399" : i === 12 ? "#71717a" : "#fde047"}
                  opacity={isEdge ? 1 : 0.6}
                />
              );
            })}
            <SvgText x="0" y="55" fill="#34d399" fontSize="11" fontWeight="700">
              Day 1 · earned
            </SvgText>
            <SvgText
              x="600"
              y="55"
              fill="#a1a1aa"
              fontSize="11"
              fontWeight="700"
              textAnchor="end"
            >
              Month 12 · expires
            </SvgText>
          </Svg>
        </View>

        {/* FAQ */}
        <View>
          <SectionLabel>Quick answers</SectionLabel>
          <View style={styles.faqStack}>
            <FaqRow
              q="Do I need a code at checkout?"
              a="Nope — just tick the 'Redeem Momentum Points' checkbox at checkout. Your discount applies instantly."
            />
            <FaqRow
              q="Can I use points and a coupon together?"
              a="Yes. Points come off after coupons, so you stack savings."
            />
            <FaqRow
              q="What if I cancel a booking?"
              a="The points you earned on it are reversed automatically — you'll see a 'Reversed' row in your statement."
            />
            <FaqRow
              q="Can I transfer points to a friend?"
              a="Not today. Points are tied to your account."
            />
            <FaqRow
              q="Where do I see my history?"
              a="Your statement page lists every earn, redeem, and expiry with the booking ID, rupee value, and date for each entry."
            />
          </View>
        </View>

        {/* CTA */}
        <View style={styles.ctaRow}>
          <Pressable
            onPress={() =>
              navigation
                .getParent<BottomTabNavigationProp<MainTabsParamList>>()
                ?.jumpTo("Sports", { screen: "BookSport" })
            }
            style={({ pressed }) => [
              styles.ctaTilePrimary,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Calendar size={20} color={colors.emerald400} />
            <Text style={styles.ctaLabel}>Book a court</Text>
            <Text style={styles.ctaSubPrimary}>Start earning today</Text>
            <ArrowRight size={16} color={colors.emerald400} style={styles.ctaArrow} />
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("Rewards")}
            style={({ pressed }) => [
              styles.ctaTileSecondary,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Wallet size={20} color={colors.zinc300} />
            <Text style={styles.ctaLabel}>My statement</Text>
            <Text style={styles.ctaSubSecondary}>
              Earn, redeem & expiry — full detail
            </Text>
            <ArrowRight size={16} color={colors.zinc400} style={styles.ctaArrow} />
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────

function SectionLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  return <Text style={[styles.sectionLabel, style]}>{children}</Text>;
}

function StepCard({
  n,
  tone,
  Icon,
  title,
  body,
}: {
  n: number;
  tone: Tone;
  Icon: React.ComponentType<{ size?: number; color?: ColorValue }>;
  title: string;
  body: string;
}) {
  const t = TONE[tone];
  return (
    <View
      style={[
        styles.stepCard,
        { borderColor: t.border, backgroundColor: t.accentSoft },
      ]}
    >
      <Text style={styles.stepN}>{n}</Text>
      <Icon size={24} color={t.accent} />
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepBody}>{body}</Text>
    </View>
  );
}

function ExamplePill({
  Icon,
  label,
  value,
  tone,
}: {
  Icon: React.ComponentType<{ size?: number; color?: ColorValue }>;
  label: string;
  value: string;
  tone: Tone;
}) {
  const t = TONE[tone];
  return (
    <View
      style={[
        styles.examplePill,
        { borderColor: t.border, backgroundColor: t.accentSoft },
      ]}
    >
      <Icon size={20} color={t.accent} />
      <Text style={[styles.examplePillLabel, { color: t.accent }]}>
        {label}
      </Text>
      <Text style={[styles.examplePillValue, { color: t.accent }]}>
        {value}
      </Text>
    </View>
  );
}

function EarnCard({
  Icon,
  tone,
  headline,
  title,
  body,
}: {
  Icon: React.ComponentType<{ size?: number; color?: ColorValue }>;
  tone: Tone;
  headline: string;
  title: string;
  body: string;
}) {
  const t = TONE[tone];
  return (
    <View
      style={[
        styles.earnCard,
        { borderColor: t.border, backgroundColor: t.accentSoft },
      ]}
    >
      <View
        style={[
          styles.earnIcon,
          { borderColor: t.border, backgroundColor: t.accentSoft },
        ]}
      >
        <Icon size={18} color={t.accent} />
      </View>
      <Text style={[styles.earnHeadline, { color: t.accent }]}>{headline}</Text>
      <Text style={styles.earnTitle}>{title}</Text>
      <Text style={styles.earnBody}>{body}</Text>
    </View>
  );
}

function RuleRow({
  Icon,
  tone,
  title,
  body,
}: {
  Icon: React.ComponentType<{ size?: number; color?: ColorValue }>;
  tone: Tone;
  title: string;
  body: string;
}) {
  const t = TONE[tone];
  return (
    <View style={styles.ruleRow}>
      <View
        style={[
          styles.ruleIcon,
          { borderColor: t.border, backgroundColor: t.accentSoft },
        ]}
      >
        <Icon size={18} color={t.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.ruleTitle}>{title}</Text>
        <Text style={styles.ruleBody}>{body}</Text>
      </View>
    </View>
  );
}

function FaqRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      onPress={() => setOpen((p) => !p)}
      style={({ pressed }) => [
        styles.faqRow,
        pressed && { opacity: 0.9 },
      ]}
    >
      <View style={styles.faqHead}>
        <Text style={styles.faqQ}>{q}</Text>
        <ChevronDown
          size={16}
          color={colors.zinc500}
          style={[
            styles.faqChevron,
            open && { transform: [{ rotate: "180deg" }] },
          ]}
        />
      </View>
      {open ? <Text style={styles.faqA}>{a}</Text> : null}
    </Pressable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["6"],
  },

  // Hero
  hero: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_05,
    padding: spacing["6"],
    overflow: "hidden",
    gap: spacing["1"],
  },
  heroEyebrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
    paddingHorizontal: spacing["3"],
    paddingVertical: 4,
  },
  heroEyebrowText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.emerald400,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  heroTitle: {
    marginTop: spacing["3"],
    fontSize: 32,
    fontWeight: "800",
    lineHeight: 36,
    color: colors.foreground,
  },
  heroTitleAccent: {
    fontSize: 32,
    fontWeight: "800",
    lineHeight: 36,
    color: colors.emerald400,
  },
  heroBody: {
    marginTop: spacing["3"],
    fontSize: 13,
    color: colors.zinc400,
    lineHeight: 18,
  },
  heroBalance: {
    marginTop: spacing["4"],
    alignSelf: "flex-start",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: "rgba(9, 9, 11, 0.60)",
    paddingHorizontal: spacing["5"],
    paddingVertical: spacing["4"],
  },
  heroBalanceLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#6ee7b7",
    letterSpacing: 1.5,
  },
  heroBalanceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    marginTop: 2,
  },
  heroBalanceValue: {
    fontSize: 32,
    // Explicit lineHeight — the custom <Text> defaults to the `body`
    // variant (lineHeight 22), which clips the top of 32pt glyphs on
    // iOS. Same fix applied to every other big-font style below.
    lineHeight: 38,
    fontWeight: "800",
    color: colors.foreground,
  },
  heroBalanceUnit: {
    paddingBottom: spacing["1"],
    fontSize: 12,
    color: colors.zinc400,
  },
  heroBalanceWorth: {
    fontSize: 12,
    color: "#6ee7b7",
  },
  warnPill: {
    marginTop: spacing["3"],
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.30)",
    backgroundColor: "rgba(245, 158, 11, 0.10)",
    paddingHorizontal: spacing["3"],
    paddingVertical: 6,
  },
  warnText: {
    fontSize: 12,
    color: "#fcd34d",
    fontWeight: "600",
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    color: "#6ee7b7",
    textTransform: "uppercase",
  },
  sectionSub: {
    marginTop: 6,
    fontSize: 13,
    color: colors.zinc400,
    lineHeight: 18,
  },

  // Steps
  stepStack: {
    marginTop: spacing["3"],
    gap: spacing["3"],
  },
  stepCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing["5"],
    gap: 4,
    position: "relative",
    overflow: "hidden",
  },
  stepN: {
    position: "absolute",
    right: 16,
    top: 12,
    fontSize: 56,
    lineHeight: 64,
    fontWeight: "800",
    color: "rgba(39, 39, 42, 0.60)",
  },
  stepTitle: {
    marginTop: spacing["2"],
    fontSize: 16,
    fontWeight: "700",
    color: colors.foreground,
  },
  stepBody: {
    fontSize: 12,
    color: colors.zinc300,
    lineHeight: 17,
  },

  // Example
  exampleCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.yellow500_30,
    backgroundColor: "rgba(234, 179, 8, 0.05)",
    padding: spacing["5"],
    gap: spacing["3"],
    overflow: "hidden",
  },
  exampleIntro: {
    fontSize: 13,
    color: colors.zinc400,
    lineHeight: 18,
  },
  examplePillCol: {
    gap: 4,
  },
  examplePill: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing["3"],
    alignItems: "center",
    gap: 4,
  },
  examplePillArrow: {
    alignItems: "center",
    paddingVertical: 2,
  },
  examplePillLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    opacity: 0.8,
  },
  examplePillValue: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
  },
  exampleFoot: {
    marginTop: spacing["2"],
    fontSize: 11,
    color: colors.zinc500,
    lineHeight: 16,
  },

  // Earn
  earnGrid: {
    marginTop: spacing["3"],
    gap: spacing["3"],
  },
  earnCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing["5"],
    gap: 4,
  },
  earnIcon: {
    alignSelf: "flex-start",
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  earnHeadline: {
    marginTop: spacing["3"],
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
  },
  earnTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.foreground,
  },
  earnBody: {
    fontSize: 12,
    color: colors.zinc400,
    lineHeight: 17,
  },

  // Spend rules
  ruleStack: {
    marginTop: spacing["3"],
    gap: spacing["2"],
  },
  ruleRow: {
    flexDirection: "row",
    gap: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24, 24, 27, 0.40)",
    padding: spacing["4"],
  },
  ruleIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  ruleTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.foreground,
  },
  ruleBody: {
    marginTop: 2,
    fontSize: 12,
    color: colors.zinc400,
    lineHeight: 17,
  },

  // Expiry
  expiryCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24, 24, 27, 0.40)",
    padding: spacing["5"],
    gap: spacing["3"],
  },
  expiryHead: {
    flexDirection: "row",
    gap: spacing["3"],
  },
  expiryIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
  },
  expiryTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.foreground,
  },
  expiryBody: {
    marginTop: 4,
    fontSize: 12,
    color: colors.zinc400,
    lineHeight: 17,
  },
  svg: {
    width: "100%",
    aspectRatio: 10,
  },

  // FAQ
  faqStack: {
    marginTop: spacing["3"],
    gap: spacing["2"],
  },
  faqRow: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24, 24, 27, 0.40)",
    padding: spacing["4"],
  },
  faqHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing["3"],
  },
  faqQ: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: colors.foreground,
  },
  faqChevron: {
    transform: [{ rotate: "0deg" }],
  },
  faqA: {
    marginTop: spacing["2"],
    fontSize: 12,
    color: colors.zinc400,
    lineHeight: 17,
  },

  // CTA
  ctaRow: {
    flexDirection: "row",
    gap: spacing["3"],
  },
  ctaTilePrimary: {
    flex: 1,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
    padding: spacing["5"],
    minHeight: 130,
  },
  ctaTileSecondary: {
    flex: 1,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24, 24, 27, 0.60)",
    padding: spacing["5"],
    minHeight: 130,
  },
  ctaLabel: {
    marginTop: spacing["3"],
    fontSize: 14,
    fontWeight: "700",
    color: colors.foreground,
  },
  ctaSubPrimary: {
    marginTop: 4,
    fontSize: 11,
    color: "#6ee7b7",
  },
  ctaSubSecondary: {
    marginTop: 4,
    fontSize: 11,
    color: colors.zinc500,
  },
  ctaArrow: {
    position: "absolute",
    right: spacing["4"],
    bottom: spacing["4"],
  },
});
