import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Trash2 } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { shopApi } from "../../lib/shop";
import { formatRupees } from "../../lib/format";
import type { ShopStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ShopStackParamList, "ShopCart">;

export function ShopCartScreen() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();

  const cartQuery = useQuery({
    queryKey: ["shop-cart"],
    queryFn: () => shopApi.getCart(),
  });

  const setQtyMutation = useMutation({
    mutationFn: (vars: { productId: string; quantity: number }) =>
      shopApi.setCartQuantity(vars.productId, vars.quantity),
    onSuccess: (data) => qc.setQueryData(["shop-cart"], data),
  });

  const clearMutation = useMutation({
    mutationFn: () => shopApi.clearCart(),
    onSuccess: (data) => qc.setQueryData(["shop-cart"], data),
  });

  const cart = cartQuery.data?.cart ?? { lines: [], totalPaise: 0, itemCount: 0 };
  const pending = setQtyMutation.isPending || clearMutation.isPending;

  if (cartQuery.isLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <Screen>
        <Card style={styles.empty}>
          <Text variant="bodyStrong" align="center">
            Your cart is empty
          </Text>
          <Text
            variant="small"
            color={colors.mutedForeground}
            align="center"
            style={{ marginTop: spacing["1"] }}
          >
            Head back to the shop to add some gear.
          </Text>
          <Button
            label="Browse shop"
            onPress={() => navigation.goBack()}
            style={{ marginTop: spacing["4"] }}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {cart.lines.map((line) => {
          const reachedMax = line.quantity >= line.stockQuantity;
          return (
            <View
              key={line.productId}
              style={[styles.row, line.unavailable && { opacity: 0.6 }]}
            >
              <View style={styles.thumbWrap}>
                {line.imageUrl ? (
                  <Image
                    source={{ uri: line.imageUrl }}
                    style={styles.thumb}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.thumbPlaceholder} />
                )}
              </View>
              <View style={styles.rowBody}>
                <Text variant="small" weight="600" color={colors.foreground}>
                  {line.name}
                </Text>
                {line.unavailable ? (
                  <Text variant="tiny" color={colors.destructive}>
                    Currently unavailable
                  </Text>
                ) : (
                  <Text variant="tiny" color={colors.zinc500}>
                    {formatRupees(Math.round(line.pricePaise / 100))} ×{" "}
                    {line.quantity}
                  </Text>
                )}
              </View>
              {!line.unavailable ? (
                <View style={styles.stepper}>
                  <Pressable
                    onPress={() =>
                      setQtyMutation.mutate({
                        productId: line.productId,
                        quantity: Math.max(0, line.quantity - 1),
                      })
                    }
                    disabled={pending}
                    style={styles.stepperBtn}
                  >
                    <Minus size={12} color={colors.zinc300} />
                  </Pressable>
                  <Text
                    variant="small"
                    weight="700"
                    color={colors.foreground}
                    style={styles.stepperNum}
                  >
                    {line.quantity}
                  </Text>
                  <Pressable
                    onPress={() =>
                      setQtyMutation.mutate({
                        productId: line.productId,
                        quantity: line.quantity + 1,
                      })
                    }
                    disabled={pending || reachedMax}
                    style={[styles.stepperBtn, reachedMax && { opacity: 0.4 }]}
                  >
                    <Plus size={12} color={colors.zinc300} />
                  </Pressable>
                </View>
              ) : null}
              <Pressable
                onPress={() =>
                  setQtyMutation.mutate({
                    productId: line.productId,
                    quantity: 0,
                  })
                }
                disabled={pending}
                style={styles.removeBtn}
              >
                <Trash2 size={12} color={colors.destructive} />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerTotals}>
          <View>
            <Text variant="tiny" color={colors.zinc500}>
              Total
            </Text>
            <Text variant="heading" weight="700" color={colors.emerald400}>
              {formatRupees(Math.round(cart.totalPaise / 100))}
            </Text>
          </View>
          <Pressable
            onPress={() => clearMutation.mutate()}
            disabled={pending}
            style={styles.clearBtn}
          >
            <Text variant="small" color={colors.zinc400}>
              Clear cart
            </Text>
          </Pressable>
        </View>
        <Button
          label="Continue to checkout"
          onPress={() => navigation.navigate("ShopCheckout")}
          fullWidth
          size="lg"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["2"],
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    marginTop: spacing["10"],
    padding: spacing["6"],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  thumbWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.zinc800,
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  thumbPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: colors.zinc800,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.zinc700,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  stepperBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  stepperNum: {
    minWidth: 18,
    textAlign: "center",
  },
  removeBtn: {
    padding: spacing["2"],
    borderWidth: 1,
    borderColor: colors.destructive_30,
    borderRadius: radius.md,
    backgroundColor: colors.destructive_10,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["6"],
    backgroundColor: colors.background,
    gap: spacing["3"],
  },
  footerTotals: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  clearBtn: {
    padding: spacing["2"],
  },
});
