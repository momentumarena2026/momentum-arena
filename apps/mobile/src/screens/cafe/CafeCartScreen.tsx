import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Coffee, Minus, Plus, Trash2 } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";
import { useCafeCart } from "../../providers/CafeCartProvider";
import type { CafeStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<CafeStackParamList, "CafeCart">;

/**
 * Cafe cart — pure local-state view of what the customer has
 * picked. Lines drive everything off the cart context (no server
 * round-trip until checkout). Stock-cap is enforced via
 * `trackedStock` snapshotted at add-time; if the admin restocks
 * later the cap relaxes only after refreshing the menu.
 */
export function CafeCartScreen() {
  const navigation = useNavigation<Nav>();
  const cart = useCafeCart();

  if (cart.lines.length === 0) {
    return (
      <Screen>
        <View style={styles.empty}>
          <Coffee size={48} color={colors.zinc600} />
          <Text variant="title" weight="700" color={colors.foreground}>
            Cart is empty
          </Text>
          <Text variant="small" color={colors.zinc500} align="center">
            Add something from the menu to get started.
          </Text>
          <Button
            label="Browse menu"
            onPress={() => navigation.navigate("CafeMenu")}
            size="md"
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text variant="title" weight="700" color={colors.foreground}>
          Your Cart
        </Text>
        <Text variant="small" color={colors.zinc500}>
          {cart.itemCount} item{cart.itemCount !== 1 ? "s" : ""} ·{" "}
          {formatRupees(cart.subtotal)} subtotal
        </Text>

        <View style={styles.lines}>
          {cart.lines.map((line) => {
            const stockReached =
              line.trackedStock !== null && line.quantity >= line.trackedStock;
            return (
              <View key={line.cafeItemId} style={styles.line}>
                {line.imageUrl ? (
                  <Image
                    source={{ uri: line.imageUrl }}
                    style={styles.thumb}
                  />
                ) : (
                  <View style={styles.thumbPlaceholder} />
                )}
                <View style={styles.lineBody}>
                  <View style={styles.lineNameRow}>
                    <View
                      style={[
                        styles.vegBadge,
                        {
                          borderColor: line.isVeg
                            ? "rgba(16, 185, 129, 0.5)"
                            : "rgba(239, 68, 68, 0.5)",
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.vegDot,
                          {
                            backgroundColor: line.isVeg
                              ? colors.emerald400
                              : colors.destructive,
                          },
                        ]}
                      />
                    </View>
                    <Text
                      variant="body"
                      weight="600"
                      color={colors.foreground}
                      style={{ flex: 1 }}
                      numberOfLines={1}
                    >
                      {line.name}
                    </Text>
                  </View>
                  <Text variant="small" color={colors.zinc500}>
                    {formatRupees(line.price)} each
                  </Text>
                  {stockReached ? (
                    <Text variant="tiny" color={colors.warning}>
                      Max stock — admin may have only {line.trackedStock} left
                    </Text>
                  ) : null}
                </View>
                <View style={styles.lineRight}>
                  <Text variant="bodyStrong" color={colors.foreground}>
                    {formatRupees(line.price * line.quantity)}
                  </Text>
                  <View style={styles.qtyRow}>
                    <Pressable
                      onPress={() => cart.decrement(line.cafeItemId)}
                      style={({ pressed }) => [
                        styles.qtyBtn,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Minus size={12} color={colors.foreground} />
                    </Pressable>
                    <Text
                      variant="small"
                      weight="700"
                      color={colors.foreground}
                    >
                      {line.quantity}
                    </Text>
                    <Pressable
                      disabled={stockReached}
                      onPress={() => cart.increment(line.cafeItemId)}
                      style={({ pressed }) => [
                        styles.qtyBtn,
                        pressed && { opacity: 0.7 },
                        stockReached && { opacity: 0.4 },
                      ]}
                    >
                      <Plus size={12} color={colors.foreground} />
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        <Pressable
          onPress={cart.clear}
          style={({ pressed }) => [
            styles.clearBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Trash2 size={14} color={colors.destructive_300} />
          <Text variant="small" weight="600" color={colors.destructive_300}>
            Clear cart
          </Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          <Text variant="tiny" color={colors.zinc500}>
            Total
          </Text>
          <Text variant="heading" weight="700" color={colors.emerald400}>
            {formatRupees(cart.subtotal)}
          </Text>
        </View>
        <Button
          label="Checkout"
          onPress={() => navigation.navigate("CafeCheckout")}
          size="lg"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["3"],
    padding: spacing["6"],
  },
  scroll: {
    padding: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["3"],
  },
  lines: { gap: spacing["2"], marginTop: spacing["2"] },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.card,
  },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
  thumbPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.zinc900,
  },
  lineBody: { flex: 1, gap: 2 },
  lineNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  vegBadge: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  vegDot: { width: 6, height: 6, borderRadius: 3 },
  lineRight: { alignItems: "flex-end", gap: spacing["2"] },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  qtyBtn: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["2"],
    padding: spacing["3"],
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["3"],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});
