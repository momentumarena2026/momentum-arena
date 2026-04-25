import { Pressable, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronRight } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { SportIcon } from "../../components/booking/SportIcon";
import { SportCardGradient } from "../../components/booking/SportCardGradient";
import { colors, spacing } from "../../theme";
import type { Sport } from "../../lib/types";
import { sportLabel } from "../../lib/format";
import type { BookStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<BookStackParamList, "BookSport">;

/**
 * Per-sport palette — mirrors web's `components/booking/sport-card.tsx`:
 *
 *   CRICKET   → from-emerald-500/20  to-emerald-600/5  border-emerald-500/30  text-emerald-400
 *   FOOTBALL  → from-blue-500/20     to-blue-600/5     border-blue-500/30     text-blue-400
 *   PICKLEBALL (coming soon) → border-zinc-800, bg zinc-900/50, icon zinc-500
 *
 * We recreate Tailwind's `bg-gradient-to-br` (top-left → bottom-right,
 * two-stop linear gradient) with an SVG <LinearGradient> in
 * `SportCardGradient`, so the tile shows the same subtle texture as web.
 */
interface SportTheme {
  /** Tailwind `from-*-500/20` — the gradient's top-left stop. */
  from: string;
  /** Tailwind `to-*-600/5` — the gradient's bottom-right stop. */
  to: string;
  /** Tailwind `border-*-500/30`. */
  border: string;
  /** Tailwind `text-*-400` — icon colour. */
  icon: string;
}

const SPORT_THEME: Record<Sport, SportTheme> = {
  CRICKET: {
    from: "rgba(16, 185, 129, 0.20)", // emerald-500/20
    to: "rgba(5, 150, 105, 0.05)", // emerald-600/5
    border: "rgba(16, 185, 129, 0.30)", // emerald-500/30
    icon: "#34d399", // emerald-400
  },
  FOOTBALL: {
    from: "rgba(59, 130, 246, 0.20)", // blue-500/20
    to: "rgba(37, 99, 235, 0.05)", // blue-600/5
    border: "rgba(59, 130, 246, 0.30)", // blue-500/30
    icon: "#60a5fa", // blue-400
  },
  PICKLEBALL: {
    // Disabled / coming-soon — handled separately below, theme unused.
    from: "rgba(234, 179, 8, 0.20)",
    to: "rgba(202, 138, 4, 0.05)",
    border: "rgba(234, 179, 8, 0.30)",
    icon: "#facc15",
  },
};

const SPORTS: Sport[] = ["CRICKET", "FOOTBALL", "PICKLEBALL"];
const CARD_RADIUS = 16; // Tailwind rounded-2xl

export function BookSportScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <Screen scrollable>
      <View style={styles.header}>
        {/* Web: <h1 className="text-2xl font-bold text-white">Book a Court</h1> */}
        <Text variant="title" weight="700" color={colors.foreground}>
          Book a Court
        </Text>
        {/* Web: <p className="mt-1 text-zinc-400">Choose your sport to get started</p> */}
        <Text variant="body" color={colors.zinc400} style={styles.subheading}>
          Choose your sport to get started
        </Text>
      </View>

      <View style={styles.list}>
        {SPORTS.map((sport) => {
          const isComingSoon = sport === "PICKLEBALL";

          if (isComingSoon) {
            // Web:
            //   border-zinc-800 bg-zinc-900/50 p-6 opacity-60 h-[100px]
            //   inner tile: rounded-xl bg-zinc-800 p-3
            //   icon text-zinc-500
            //   badge (top-right): bg-amber-500/15 border-amber-500/30 text-amber-400
            return (
              <View key={sport} style={[styles.card, styles.cardDisabled]}>
                <View style={styles.row}>
                  <View style={[styles.iconTile, styles.iconTileDisabled]}>
                    <SportIcon sport={sport} size={32} color="#71717a" />
                  </View>
                  <View style={styles.textWrap}>
                    {/* Web uses text-zinc-400 for the name on the disabled card */}
                    <Text
                      variant="heading"
                      weight="600"
                      color={colors.zinc400}
                    >
                      {sportLabel(sport)}
                    </Text>
                  </View>
                </View>
                <View style={styles.comingSoonBadge}>
                  <Text style={styles.comingSoonBadgeText}>Coming Soon</Text>
                </View>
              </View>
            );
          }

          const theme = SPORT_THEME[sport];
          return (
            <Pressable
              key={sport}
              onPress={() => navigation.navigate("BookCourt", { sport })}
              style={({ pressed }) => [
                styles.card,
                { borderColor: theme.border },
                pressed && styles.pressed,
              ]}
            >
              {/* Web: bg-gradient-to-br from-{color}-500/20 to-{color}-600/5 */}
              <SportCardGradient fromColor={theme.from} toColor={theme.to} />
              <View style={styles.row}>
                {/* Web: rounded-xl bg-black/30 p-3 shrink-0 */}
                <View style={[styles.iconTile, styles.iconTileActive]}>
                  <SportIcon sport={sport} size={32} color={theme.icon} />
                </View>
                <View style={styles.textWrap}>
                  {/* Web: text-lg font-semibold text-white */}
                  <Text
                    variant="heading"
                    weight="600"
                    color={colors.foreground}
                  >
                    {sportLabel(sport)}
                  </Text>
                </View>
                {/* Web: chevron right, text-zinc-600 → text-zinc-400 on hover */}
                <ChevronRight size={20} color={colors.zinc600} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: spacing["4"],
  },
  // Web: mt-1 between h1 and the subheading.
  subheading: {
    marginTop: spacing["1"],
  },
  // Web uses gap-3 between cards; grid on md+ but always stacked on mobile.
  list: {
    marginTop: spacing["6"],
    gap: spacing["3"],
  },
  // Web: rounded-2xl border p-6 h-[100px] flex items-center
  // `overflow: "hidden"` clips the absolute-positioned gradient to the
  // rounded corners. The gradient itself sits at StyleSheet.absoluteFill.
  card: {
    position: "relative",
    overflow: "hidden",
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    padding: spacing["6"], // p-6 = 24px
    height: 100,
    justifyContent: "center",
  },
  // Web: border-zinc-800 bg-zinc-900/50 opacity-60 for PICKLEBALL
  cardDisabled: {
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24, 24, 27, 0.50)", // zinc-900/50
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.85,
  },
  // Web: flex items-center gap-4
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["4"],
  },
  // Web: rounded-xl p-3 shrink-0
  iconTile: {
    borderRadius: 12,
    padding: spacing["3"], // p-3 = 12px
    alignItems: "center",
    justifyContent: "center",
  },
  // Web: bg-black/30 for active cards
  iconTileActive: {
    backgroundColor: "rgba(0, 0, 0, 0.30)",
  },
  // Web: bg-zinc-800 for disabled card
  iconTileDisabled: {
    backgroundColor: colors.zinc800,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  // Web: absolute right-3 top-3 rounded-full bg-amber-500/15 border-amber-500/30
  //      px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-400
  comingSoonBadge: {
    position: "absolute",
    right: spacing["3"],
    top: spacing["3"],
    paddingHorizontal: spacing["2"],
    paddingVertical: spacing["0.5"],
    borderRadius: 999, // rounded-full
    backgroundColor: "rgba(245, 158, 11, 0.15)", // amber-500/15
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.30)", // amber-500/30
  },
  comingSoonBadgeText: {
    color: "#fbbf24", // amber-400
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.5, // tracking-wide
    textTransform: "uppercase",
  },
});
