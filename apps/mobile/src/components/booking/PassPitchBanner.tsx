import { Pressable, StyleSheet, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { ArrowRight, Ticket } from "lucide-react-native";
import { Text } from "../ui/Text";
import { colors, radius, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";

export interface PassPitchData {
  planName: string;
  sport: string;
  fromPerHour: number;
}

/**
 * "Save More with Arena Passes" — shown on the slot-selection screens
 * (deliberately NOT at checkout, where a detour risks dropping the
 * payment). Mirrors the web PassPitchBanner: the from-price is the
 * court group's single admin-designated cheapest pass. Tapping goes to
 * the Passes storefront.
 */
export function PassPitchBanner({
  pitch,
  onPress,
}: {
  pitch: PassPitchData;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.9 }}>
      <LinearGradient
        colors={["rgba(16,185,129,0.28)", "rgba(6,78,59,0.20)", "rgba(0,0,0,0)"]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={styles.topRow}>
          <LinearGradient colors={["#10b981", "#059669"]} style={styles.iconTile}>
            <Ticket size={20} color="#fff" />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" color={colors.foreground} style={styles.headline}>
              Save More with Arena Passes
            </Text>
            <Text weight="800" color={colors.emerald400} style={styles.price}>
              Book from just {formatRupees(pitch.fromPerHour)}/hour*
            </Text>
          </View>
        </View>

        <Text variant="small" color={colors.zinc300} style={styles.body}>
          Get guaranteed savings on every game. Choose the pass that fits
          your schedule.
        </Text>

        <View style={styles.cta}>
          <Text variant="small" weight="700" color="#022c22">
            View Passes
          </Text>
          <ArrowRight size={15} color="#022c22" />
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.45)",
    padding: spacing["4"],
    gap: spacing["3"],
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  headline: {
    fontSize: 15,
    lineHeight: 20,
  },
  price: {
    fontSize: 19,
    lineHeight: 25,
    marginTop: 1,
  },
  body: {
    lineHeight: 19,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.emerald400,
    borderRadius: 999,
    paddingVertical: spacing["2"],
    paddingHorizontal: spacing["4"],
    alignSelf: "flex-start",
  },
});
