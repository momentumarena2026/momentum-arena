import { useCallback, useMemo } from "react";
import {
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
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Coffee,
  Coins,
  IndianRupee,
  Info,
  Percent,
  Sparkles,
  TrendingUp,
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

interface CardSpec {
  icon: React.ComponentType<{ size?: number; color?: ColorValue }>;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  headline: string;
  title: string;
  body: string;
}

/**
 * Graphical "How Momentum Points work" page for the mobile app.
 *
 * Mirrors web's /rewards/how-it-works. Every headline value (earn %,
 * conversion, redemption caps, holding period, expiry) is pulled from
 * the live RewardConfig via rewardsApi.overview(), so when admin
 * edits a knob in /admin/rewards the next focus refetch lands the
 * new number here without any code change.
 *
 * Stale-time + focus refetch mirrors the orders screens — coupons
 * and reward config change rarely but never want the user to see a
 * stale 20% earn rate after admin dropped it to 10%.
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

  const cards = useMemo<CardSpec[]>(() => {
    if (!cfg) return [];

    const earnPctBooking = Math.round(cfg.earnRateBookingBps / 100);
    const earnPctCafe = Math.round(cfg.earnRateCafeBps / 100);
    const pointValueRupees = (cfg.pointValuePaise / 100).toFixed(
      cfg.pointValuePaise % 100 === 0 ? 0 : 2,
    );
    const maxRedemptionRupees = cfg.maxRedemptionPaisePerTxn
      ? Math.round(cfg.maxRedemptionPaisePerTxn / 100)
      : null;

    const list: (CardSpec | null)[] = [
      {
        icon: TrendingUp,
        accent: colors.emerald400,
        accentSoft: colors.emerald500_10,
        accentBorder: colors.emerald500_30,
        headline: `${earnPctBooking}%`,
        title: "Earn on every booking",
        body: `Get ${earnPctBooking}% of every confirmed booking back as Momentum Points — credited the moment the booking confirms.`,
      },
      cfg.cafeEarnEnabled
        ? {
            icon: Coffee,
            accent: "#fcd34d",
            accentSoft: "rgba(245, 158, 11, 0.10)",
            accentBorder: "rgba(245, 158, 11, 0.30)",
            headline: `${earnPctCafe}%`,
            title: "Earn on cafe orders",
            body: `Pick up snacks, drinks, or meals at the venue and earn ${earnPctCafe}% back on every cafe order.`,
          }
        : null,
      {
        icon: Coins,
        accent: "#fde047",
        accentSoft: "rgba(234, 179, 8, 0.10)",
        accentBorder: "rgba(234, 179, 8, 0.30)",
        headline: `1 pt = ₹${pointValueRupees}`,
        title: "Worth real rupees",
        body: `Every point you earn is worth ₹${pointValueRupees} off your next bill — no exchange rates, no fine print.`,
      },
      {
        icon: CheckCircle2,
        accent: colors.emerald400,
        accentSoft: colors.emerald500_10,
        accentBorder: colors.emerald500_30,
        headline: `${cfg.minPointsToRedeem.toLocaleString("en-IN")} pts`,
        title: "Minimum to redeem",
        body: `You can start spending once your balance crosses ${cfg.minPointsToRedeem.toLocaleString(
          "en-IN",
        )} points.`,
      },
      {
        icon: Percent,
        accent: "#7dd3fc",
        accentSoft: "rgba(14, 165, 233, 0.10)",
        accentBorder: "rgba(14, 165, 233, 0.30)",
        headline: `${cfg.maxRedemptionPctOfBill}%`,
        title: "Of any bill, in points",
        body: `Apply up to ${cfg.maxRedemptionPctOfBill}% of any booking or cafe bill in points — pay the rest as usual.`,
      },
      maxRedemptionRupees
        ? {
            icon: IndianRupee,
            accent: "#7dd3fc",
            accentSoft: "rgba(14, 165, 233, 0.10)",
            accentBorder: "rgba(14, 165, 233, 0.30)",
            headline: `₹${maxRedemptionRupees.toLocaleString("en-IN")}`,
            title: "Max per transaction",
            body: `Up to ₹${maxRedemptionRupees.toLocaleString(
              "en-IN",
            )} can come off a single bill in points — keeps things fair for everyone.`,
          }
        : null,
      cfg.earnToRedeemMinHours > 0
        ? {
            icon: Clock,
            accent: colors.zinc300,
            accentSoft: "rgba(39, 39, 42, 0.60)",
            accentBorder: colors.zinc700,
            headline: `${cfg.earnToRedeemMinHours}h`,
            title: "Holding period",
            body: `Freshly-earned points become redeemable ${cfg.earnToRedeemMinHours} hour${cfg.earnToRedeemMinHours === 1 ? "" : "s"} after they hit your balance.`,
          }
        : null,
      {
        icon: CalendarClock,
        accent: colors.zinc300,
        accentSoft: "rgba(39, 39, 42, 0.60)",
        accentBorder: colors.zinc700,
        headline: "12 months",
        title: "Expiry window",
        body: "Each batch of points expires 12 months after it's earned. Activity page flags what's expiring soon.",
      },
    ];
    return list.filter((c): c is CardSpec => c !== null);
  }, [cfg]);

  const onRefresh = useCallback(() => {
    void overviewQ.refetch();
  }, [overviewQ]);

  const earnedRupeesValue = overview
    ? Math.round(overview.pointsValuePaise / 100)
    : 0;

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
        {/* Eyebrow + heading */}
        <View style={styles.eyebrowRow}>
          <View style={styles.eyebrowPill}>
            <Sparkles size={12} color={colors.emerald400} />
            <Text style={styles.eyebrowText}>Momentum Points</Text>
          </View>
        </View>
        <Text style={styles.heading}>How it works</Text>
        <Text style={styles.subheading}>
          Every value here is live — when the venue tweaks an earn-rate or a
          cap, this page reflects it immediately.
        </Text>

        {/* Disabled-rewards banner (rare; surface clearly when on) */}
        {cfg && !cfg.enabled ? (
          <View style={styles.warnCard}>
            <Info size={16} color="#fcd34d" />
            <View style={{ flex: 1 }}>
              <Text style={styles.warnTitle}>Rewards are temporarily paused</Text>
              <Text style={styles.warnBody}>
                You can still see how it normally works below. New points
                won't accrue while it's off.
              </Text>
            </View>
          </View>
        ) : null}

        {/* Current balance teaser — anchors the page, deep balance/
            statement lives on the Rewards screen. */}
        {overview ? (
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>YOUR BALANCE</Text>
            <View style={styles.balanceRow}>
              <Text style={styles.balanceNumber}>
                {overview.pointsAvailable.toLocaleString("en-IN")}
              </Text>
              <Text style={styles.balanceUnit}>pts</Text>
            </View>
            <Text style={styles.balanceWorth}>
              Worth ₹{earnedRupeesValue.toLocaleString("en-IN")} off your next bill
            </Text>
          </View>
        ) : null}

        {/* Card grid — graphical breakdown of every config knob */}
        <View style={styles.cardList}>
          {cards.map((card, i) => {
            const Icon = card.icon;
            return (
              <View
                key={i}
                style={[
                  styles.card,
                  {
                    borderColor: card.accentBorder,
                    backgroundColor: card.accentSoft,
                  },
                ]}
              >
                <View
                  style={[
                    styles.cardIcon,
                    {
                      borderColor: card.accentBorder,
                      backgroundColor: card.accentSoft,
                    },
                  ]}
                >
                  <Icon size={20} color={card.accent} />
                </View>
                <Text style={[styles.cardHeadline, { color: card.accent }]}>
                  {card.headline}
                </Text>
                <Text style={styles.cardTitle}>{card.title}</Text>
                <Text style={styles.cardBody}>{card.body}</Text>
              </View>
            );
          })}
        </View>

        {/* Footer CTAs */}
        <View style={styles.ctaRow}>
          <CtaTile
            label="Book a court"
            sub="Start earning points today"
            primary
            onPress={() =>
              navigation
                .getParent<BottomTabNavigationProp<MainTabsParamList>>()
                ?.jumpTo("Sports", { screen: "BookSport" })
            }
          />
          <CtaTile
            label="My statement"
            sub="Earned, redeemed & balance"
            onPress={() => navigation.navigate("Rewards")}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

function CtaTile({
  label,
  sub,
  onPress,
  primary,
}: {
  label: string;
  sub: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <View
      style={[
        styles.ctaTile,
        primary ? styles.ctaTilePrimary : styles.ctaTileSecondary,
      ]}
      onTouchEnd={onPress}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.ctaLabel, primary && styles.ctaLabelPrimary]}>
          {label}
        </Text>
        <Text style={[styles.ctaSub, primary && styles.ctaSubPrimary]}>
          {sub}
        </Text>
      </View>
      <ArrowRight
        size={16}
        color={primary ? colors.emerald400 : colors.zinc400}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["6"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["4"],
  },
  eyebrowRow: {
    flexDirection: "row",
  },
  eyebrowPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
    paddingHorizontal: spacing["3"],
    paddingVertical: 4,
  },
  eyebrowText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.emerald400,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  heading: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.foreground,
  },
  subheading: {
    fontSize: 13,
    color: colors.zinc400,
    lineHeight: 18,
  },

  warnCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing["2"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.30)",
    backgroundColor: "rgba(245, 158, 11, 0.10)",
    padding: spacing["3"],
  },
  warnTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fcd34d",
  },
  warnBody: {
    marginTop: 2,
    fontSize: 12,
    color: "#fcd34d",
    opacity: 0.85,
  },

  balanceCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_05,
    padding: spacing["6"],
    gap: 4,
  },
  balanceLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: colors.emerald400,
  },
  balanceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing["2"],
  },
  balanceNumber: {
    fontSize: 44,
    lineHeight: 48,
    fontWeight: "800",
    color: colors.foreground,
  },
  balanceUnit: {
    paddingBottom: spacing["2"],
    fontSize: 14,
    color: colors.zinc400,
  },
  balanceWorth: {
    marginTop: 2,
    fontSize: 13,
    color: "#6ee7b7",
  },

  cardList: {
    gap: spacing["3"],
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing["4"],
    gap: 6,
  },
  cardIcon: {
    alignSelf: "flex-start",
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cardHeadline: {
    marginTop: spacing["2"],
    fontSize: 26,
    fontWeight: "800",
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.foreground,
  },
  cardBody: {
    fontSize: 12,
    color: colors.zinc400,
    lineHeight: 17,
  },

  ctaRow: {
    flexDirection: "row",
    gap: spacing["3"],
    marginTop: spacing["2"],
  },
  ctaTile: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing["4"],
  },
  ctaTilePrimary: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
  },
  ctaTileSecondary: {
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24, 24, 27, 0.60)",
  },
  ctaLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.foreground,
  },
  ctaLabelPrimary: {
    color: colors.foreground,
  },
  ctaSub: {
    marginTop: 2,
    fontSize: 11,
    color: colors.zinc500,
  },
  ctaSubPrimary: {
    color: colors.emerald400,
  },
});
