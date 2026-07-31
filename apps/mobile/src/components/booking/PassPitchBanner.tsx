import { Pressable, StyleSheet, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { ArrowRight, Ticket } from "lucide-react-native";
import { Text } from "../ui/Text";
import { colors, radius, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";

export interface PassPitchData {
  planName: string | null;
  sport: string;
  morning: { withPass: number; regular: number; save: number } | null;
  night: { withPass: number; regular: number; save: number } | null;
}

/**
 * "Play more, pay less" — cheapest-hour pass pitch on the slot-selection
 * screens (deliberately NOT at checkout, where a detour risks dropping
 * the payment). Mirrors the web PassPitchBanner: morning = the sport's
 * OFF_PEAK anchor plan, night = the PEAK anchor. Tapping goes to the
 * Passes storefront.
 */
export function PassPitchBanner({
  pitch,
  onPress,
}: {
  pitch: PassPitchData;
  onPress: () => void;
}) {
  const sportTitle =
    pitch.sport.charAt(0) + pitch.sport.slice(1).toLowerCase();
  const name = pitch.planName ?? `${sportTitle} passes`;
  const m = pitch.morning;
  const n = pitch.night;

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
          <LinearGradient
            colors={["#10b981", "#059669"]}
            style={styles.iconTile}
          >
            <Ticket size={20} color="#fff" />
          </LinearGradient>
          <Text variant="bodyStrong" color={colors.foreground} style={styles.headline}>
            Play more, pay less with our {name}!
          </Text>
        </View>

        <Text variant="small" color={colors.zinc300} style={styles.body}>
          {m && n ? (
            <>
              Enjoy morning court hours at just{" "}
              <Text variant="small" weight="700" color={colors.emerald400}>
                {formatRupees(m.withPass)}
              </Text>{" "}
              and night sessions at{" "}
              <Text variant="small" weight="700" color={colors.emerald400}>
                {formatRupees(n.withPass)}
              </Text>
              . Save{" "}
              <Text variant="small" weight="700" color={colors.foreground}>
                {formatRupees(m.save)}
              </Text>{" "}
              on morning bookings and{" "}
              <Text variant="small" weight="700" color={colors.foreground}>
                {formatRupees(n.save)}
              </Text>{" "}
              on night bookings compared with regular rates.
            </>
          ) : (
            <>
              Enjoy {m ? "morning court hours" : "night sessions"} at just{" "}
              <Text variant="small" weight="700" color={colors.emerald400}>
                {formatRupees((m ?? n)!.withPass)}
              </Text>{" "}
              — save{" "}
              <Text variant="small" weight="700" color={colors.foreground}>
                {formatRupees((m ?? n)!.save)}
              </Text>{" "}
              per booking compared with regular rates.
            </>
          )}
        </Text>

        <View style={styles.cta}>
          <Text variant="small" weight="700" color="#022c22">
            See passes and start playing for less
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
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
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
