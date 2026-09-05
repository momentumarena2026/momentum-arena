import { Pressable, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react-native";
import { Text } from "./ui/Text";
import { colors, radius, spacing } from "../theme";
import { rewardsApi } from "../lib/rewards";
import { trackRewardsTileTap } from "../lib/analytics";
import type { HomeStackParamList } from "../navigation/types";

/** This chip renders only inside HomeStack (HomeScreen). Typing it to the
 *  stack rather than the tabs is what lets it push in place, so Back
 *  returns to Home instead of AccountHome. */
type Nav = NativeStackNavigationProp<HomeStackParamList>;

/**
 * Header pill showing the signed-in user's Momentum Points balance.
 * Mirrors the web `RewardsChip` in `components/rewards/rewards-chip.tsx`:
 *   - Hidden entirely when rewards are disabled in config
 *   - Hidden when the user isn't signed in (parent shouldn't render
 *     this at all in that case — but we guard anyway)
 *   - Muted "0 pts" state when the user has a zero balance, so layout
 *     doesn't shift between empty and non-empty states
 *
 * On press: navigates to the Account stack's Rewards screen. The
 * Account stack already mounts RewardsScreen as a child of
 * AccountHome (see navigation/AccountStack.tsx).
 */
interface Props {
  /** If false, skip the network call entirely (signed-out state). */
  enabled?: boolean;
}

export function RewardsChip({ enabled = true }: Props) {
  const navigation = useNavigation<Nav>();

  const { data } = useQuery({
    queryKey: ["rewards", "overview"],
    queryFn: () => rewardsApi.overview(),
    enabled,
    // Refetch on tab focus so the chip is current after the user
    // earns/redeems elsewhere in the app.
    refetchOnWindowFocus: true,
  });

  if (!enabled) return null;
  const overview = data?.overview;
  if (!overview) return null;
  if (!overview.config.enabled) return null;

  const points = overview.pointsAvailable;
  const isEmpty = points <= 0;

  function go() {
    trackRewardsTileTap(points);
    // In-stack. This chip only renders on Home, so pushing here keeps
    // Back pointing at Home instead of stranding the customer on
    // AccountHome. If it is ever reused on another screen, that stack
    // needs its own Rewards registration — same pattern.
    navigation.navigate("Rewards");
  }

  return (
    <Pressable
      onPress={go}
      accessibilityRole="button"
      accessibilityLabel={`Reward points: ${points}`}
      style={({ pressed }) => [
        styles.chip,
        isEmpty ? styles.chipEmpty : styles.chipActive,
        pressed && styles.pressed,
      ]}
      hitSlop={6}
    >
      <Sparkles
        size={12}
        color={isEmpty ? colors.zinc500 : colors.emerald400}
      />
      <Text
        variant="small"
        weight="700"
        color={isEmpty ? colors.zinc400 : "#6ee7b7"}
        style={styles.value}
      >
        {points.toLocaleString("en-IN")}
      </Text>
      <Text
        variant="tiny"
        color={isEmpty ? colors.zinc500 : colors.emerald400}
        style={styles.unit}
      >
        pts
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing["2.5"],
    paddingVertical: 4,
  },
  chipActive: {
    borderColor: colors.emerald500_30,
    backgroundColor: colors.emerald500_10,
  },
  chipEmpty: {
    borderColor: colors.zinc700,
    backgroundColor: "rgba(24, 24, 27, 0.6)",
  },
  pressed: {
    opacity: 0.7,
  },
  value: {
    // RN doesn't honour the inherited line-height + the icon spacing
    // by default — tighten the baseline so the chip stays compact.
    lineHeight: 16,
  },
  unit: {
    letterSpacing: 0.5,
    textTransform: "uppercase",
    lineHeight: 14,
  },
});
