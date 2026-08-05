import { Pressable, StyleSheet, View } from "react-native";
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
 * payment). The from-price is the court group's single admin-designated
 * cheapest pass. Tapping goes to the Passes storefront.
 *
 * Built from plain Views on purpose. Earlier versions wrapped the card
 * in a LinearGradient, whose native view measured its own height without
 * counting the children's spacing — the card came out short and sliced
 * the "View Passes" pill in half. There is no gradient and no `gap`
 * anywhere here: the Pressable IS the card, every child states its own
 * margin, and the pill declares a real height, so the layout can only
 * grow to fit its content.
 */
export function PassPitchBanner({
  pitch,
  onPress,
}: {
  pitch: PassPitchData;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Save more with Arena passes — book from ${formatRupees(pitch.fromPerHour)} per hour`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.headRow}>
        <View style={styles.iconTile}>
          <Ticket size={20} color="#ffffff" />
        </View>
        <View style={styles.headText}>
          <Text
            variant="bodyStrong"
            color={colors.foreground}
            style={styles.headline}
          >
            Save More with Arena Passes
          </Text>
          <Text weight="800" color={colors.emerald400} style={styles.price}>
            Book from just {formatRupees(pitch.fromPerHour)}/hour*
          </Text>
        </View>
      </View>

      <Text variant="small" color={colors.zinc300} style={styles.body}>
        Get guaranteed savings on every game. Choose the pass that fits your
        schedule.
      </Text>

      <View style={styles.cta}>
        <Text variant="small" weight="700" color="#022c22">
          View Passes
        </Text>
        <ArrowRight size={15} color="#022c22" style={styles.ctaIcon} />
      </View>
    </Pressable>
  );
}

const CTA_HEIGHT = 36;

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.45)",
    // Flat emerald wash instead of a gradient — same tone, none of the
    // native gradient view's measuring quirks.
    backgroundColor: "rgba(6,78,59,0.35)",
    paddingHorizontal: spacing["4"],
    paddingTop: spacing["4"],
    paddingBottom: spacing["4"],
  },
  cardPressed: {
    opacity: 0.9,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.emerald500,
    marginRight: spacing["3"],
  },
  headText: {
    flex: 1,
    minWidth: 0,
  },
  headline: {
    fontSize: 15,
    lineHeight: 20,
  },
  price: {
    fontSize: 19,
    lineHeight: 25,
    marginTop: 2,
  },
  body: {
    marginTop: spacing["3"],
    lineHeight: 19,
  },
  cta: {
    marginTop: spacing["3"],
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    // An explicit height (rather than padding alone) means the pill
    // reserves its space even if a parent ever mis-measures again.
    height: CTA_HEIGHT,
    paddingHorizontal: spacing["4"],
    borderRadius: CTA_HEIGHT / 2,
    backgroundColor: colors.emerald400,
  },
  ctaIcon: {
    marginLeft: 6,
  },
});
