import { Pressable, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronRight, Sparkles } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { RainBanner } from "../../components/RainBanner";
import { SportIcon } from "../../components/booking/SportIcon";
import { SportCardGradient } from "../../components/booking/SportCardGradient";
import { colors, radius, spacing } from "../../theme";
import type { Sport } from "../../lib/types";
import { sportLabel } from "../../lib/format";
import { trackSportSelected } from "../../lib/analytics";
import type { BookStackParamList } from "../../navigation/types";
import { PromoBannerSlot } from "../../components/promo/PromoBannerSlot";

type Nav = NativeStackNavigationProp<BookStackParamList, "BookSport">;

/**
 * Per-sport palette — mirrors web's `components/booking/sport-card.tsx`:
 *
 *   CRICKET    → from-emerald-500/20  to-emerald-600/5  border-emerald-500/30  text-emerald-400
 *   FOOTBALL   → from-blue-500/20     to-blue-600/5     border-blue-500/30     text-blue-400
 *   PICKLEBALL → from-yellow-500/20   to-yellow-600/5   border-yellow-500/30   text-yellow-400
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
    from: "rgba(234, 179, 8, 0.20)", // yellow-500/20
    to: "rgba(202, 138, 4, 0.05)", // yellow-600/5
    border: "rgba(234, 179, 8, 0.30)", // yellow-500/30
    icon: "#facc15", // yellow-400
  },
};

// Sport → launch-promo pill in the top-right of the tile. Empty when
// no promo is live (the pickleball 25% launch pill retired 2026-08 —
// web's SportCard dropped its promoLabel overlay at the same time).
const SPORT_PROMO_LABEL: Partial<Record<Sport, string>> = {};

const SPORTS: Sport[] = ["CRICKET", "FOOTBALL", "PICKLEBALL"];
const CARD_RADIUS = 16; // Tailwind rounded-2xl

export function BookSportScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <Screen scrollable edges={["top", "bottom"]}>
      {/* Rain "all-weather" banner — mirrors web's /book page. Rounded,
          informational (no deep-link; the user is already booking).
          Renders only when getRainBanner() says to. */}
      <RainBanner rounded />

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

      {/* Quick book — type it instead of tapping through sport, court,
          date and slot. Sits ABOVE the sport tiles but is styled as a
          secondary row, not a hero: the tile grid stays the obvious path
          for anyone who does not already know what they want, and this
          is the shortcut for the regular who does. */}
      <Pressable
        onPress={() => navigation.navigate("BookingBot")}
        style={({ pressed }) => [styles.quickBook, pressed && { opacity: 0.85 }]}
      >
        <View style={styles.quickIcon}>
          <Sparkles size={16} color={colors.emerald400} />
        </View>
        <View style={styles.quickBody}>
          <Text variant="body" weight="700" color={colors.foreground}>
            Quick book
          </Text>
          <Text variant="tiny" color={colors.zinc500}>
            Type &ldquo;football tomorrow 7 to 8 pm&rdquo;
          </Text>
        </View>
        <ChevronRight size={18} color={colors.zinc600} />
      </Pressable>

      {/* Admin-managed promotion banners for this screen. */}
      <PromoBannerSlot screen="BOOK_SPORT" style={{ marginBottom: spacing["4"] }} />

      <View style={styles.list}>
        {SPORTS.map((sport) => {
          const theme = SPORT_THEME[sport];
          const promoLabel = SPORT_PROMO_LABEL[sport];
          return (
            <Pressable
              key={sport}
              onPress={() => {
                trackSportSelected(sport);
                navigation.navigate("BookCourt", { sport });
              }}
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
              {/* Top-right launch-promo pill — mirrors web's sport-card
                  `promoLabel`. Positioned absolutely so the row layout
                  stays unchanged; sits left of the chevron so it doesn't
                  overlap the affordance. */}
              {promoLabel ? (
                <View style={styles.promoPill}>
                  <Text style={styles.promoPillText}>{promoLabel}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  quickBook: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: spacing["4"],
  },
  quickIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.emerald500_10,
    borderWidth: 1,
    borderColor: colors.emerald500_30,
  },
  quickBody: { flex: 1, gap: 1 },
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
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  // Top-right launch-promo pill — mirrors web's amber chip on the
  // pickleball sport tile (right-12 top-3 in sport-card.tsx, sized so
  // it doesn't crowd the chevron on the right edge).
  promoPill: {
    position: "absolute",
    right: spacing["10"], // leave room for the chevron
    top: spacing["3"],
    paddingHorizontal: spacing["2.5"],
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(250, 204, 21, 0.95)", // yellow-400/95
    borderWidth: 1,
    borderColor: "rgba(253, 224, 71, 0.6)", // yellow-300/60
  },
  promoPillText: {
    color: "#18181b", // zinc-900
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
