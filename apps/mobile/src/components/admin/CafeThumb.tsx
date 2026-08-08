import { Image, StyleSheet, View } from "react-native";
import { Text } from "../ui/Text";
import { colors, radius } from "../../theme";

/**
 * Photo thumbnail for a cafe item, admin side.
 *
 * The admin menu was drawing the diet emoji where the photo belongs, so a
 * screenful of items all read as "🥬" and told the counter staff nothing
 * about what they were about to tap — while the customer app had been
 * showing the real photo the whole time. The create-order screen showed
 * nothing at all, which is the screen where picking the wrong item costs
 * someone their lunch.
 *
 * The veg/non-veg marker moves to the corner square — the convention on
 * every Indian menu — so the diet signal survives once a photo is present
 * instead of being displaced by it.
 */
export function CafeThumb({
  uri,
  isVeg,
  size = 44,
}: {
  uri?: string | null;
  isVeg: boolean;
  size?: number;
}) {
  const tint = isVeg ? colors.emerald400 : colors.destructive;
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {uri ? (
        <Image source={{ uri }} style={styles.img} resizeMode="cover" />
      ) : (
        // No photo uploaded: fall back to the diet emoji rather than an
        // empty grey square, so the row still carries something readable.
        <Text style={{ fontSize: Math.round(size * 0.42) }}>
          {isVeg ? "🥬" : "🍗"}
        </Text>
      )}
      <View style={[styles.diet, { borderColor: tint }]}>
        <View style={[styles.dietDot, { backgroundColor: tint }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  img: { width: "100%", height: "100%" },
  diet: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 10,
    height: 10,
    borderRadius: 2,
    borderWidth: 1,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  dietDot: { width: 4, height: 4, borderRadius: 2 },
});
