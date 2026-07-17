import { useState } from "react";
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
import { Minus, Plus, ShoppingCart } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Card } from "../../components/ui/Card";
import { colors, radius, spacing } from "../../theme";
import { shopApi, type PublicProduct } from "../../lib/shop";
import { formatRupees } from "../../lib/format";
import { useAuth } from "../../providers/AuthProvider";
import type { ShopStackParamList } from "../../navigation/types";
import { PromoBannerSlot } from "../../components/promo/PromoBannerSlot";

type Nav = NativeStackNavigationProp<ShopStackParamList, "ShopHome">;

/**
 * Customer product catalog. Mirrors web /shop:
 *   - public product list (signed-out browsing OK)
 *   - per-card +/- stepper for signed-in users
 *   - sticky cart pill that navigates to ShopCart
 *
 * Anonymous mobile carts are not persisted locally for v1 — the
 * mobile bottom-nav is hidden behind sign-in anyway, so the user
 * is almost always authenticated when they hit this screen.
 */
export function ShopHomeScreen() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const { state } = useAuth();
  const signedIn = state.status === "signedIn";

  const productsQuery = useQuery({
    queryKey: ["shop-products"],
    queryFn: () => shopApi.products(),
  });
  const cartQuery = useQuery({
    queryKey: ["shop-cart"],
    queryFn: () => shopApi.getCart(),
    enabled: signedIn,
  });

  const addMutation = useMutation({
    mutationFn: (productId: string) => shopApi.addToCart(productId, 1),
    onSuccess: (data) => {
      qc.setQueryData(["shop-cart"], data);
    },
  });
  const setQtyMutation = useMutation({
    mutationFn: (vars: { productId: string; quantity: number }) =>
      shopApi.setCartQuantity(vars.productId, vars.quantity),
    onSuccess: (data) => {
      qc.setQueryData(["shop-cart"], data);
    },
  });

  const products = productsQuery.data?.products ?? [];
  const cart = cartQuery.data?.cart ?? { lines: [], totalPaise: 0, itemCount: 0 };

  function qtyOf(productId: string): number {
    return cart.lines.find((l) => l.productId === productId)?.quantity ?? 0;
  }

  const categories = (() => {
    const groups: Array<{ id: string | null; name: string | null; items: PublicProduct[] }> = [];
    for (const p of products) {
      const existing = groups.find((g) => g.id === p.categoryId);
      if (existing) existing.items.push(p);
      else groups.push({ id: p.categoryId, name: p.categoryName, items: [p] });
    }
    return groups;
  })();

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text variant="title">Shop</Text>
            <Text variant="small" color={colors.mutedForeground}>
              Pick up at the venue. No shipping.
            </Text>
          </View>
        </View>

        {/* Admin-managed promotion banners for this screen. */}
        <PromoBannerSlot
          screen="SHOP"
          style={{ marginHorizontal: spacing["4"], marginBottom: spacing["3"] }}
        />

        {productsQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : products.length === 0 ? (
          <Card style={styles.empty}>
            <Text variant="body" color={colors.mutedForeground} align="center">
              Nothing in stock right now. Check back soon!
            </Text>
          </Card>
        ) : (
          categories.map((cat) => (
            <View key={cat.id ?? "uncat"} style={styles.section}>
              {cat.name ? (
                <Text
                  variant="tiny"
                  color={colors.zinc500}
                  style={styles.sectionLabel}
                >
                  {cat.name.toUpperCase()}
                </Text>
              ) : null}
              <View style={styles.grid}>
                {cat.items.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    quantity={qtyOf(p.id)}
                    pending={
                      addMutation.isPending || setQtyMutation.isPending
                    }
                    signedIn={signedIn}
                    onAdd={() => {
                      if (!signedIn) {
                        navigation
                          .getParent()
                          ?.getParent()
                          ?.navigate("Phone");
                        return;
                      }
                      addMutation.mutate(p.id);
                    }}
                    onIncrement={() =>
                      setQtyMutation.mutate({
                        productId: p.id,
                        quantity: qtyOf(p.id) + 1,
                      })
                    }
                    onDecrement={() =>
                      setQtyMutation.mutate({
                        productId: p.id,
                        quantity: Math.max(0, qtyOf(p.id) - 1),
                      })
                    }
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Sticky cart pill */}
      {signedIn && cart.itemCount > 0 ? (
        <Pressable
          onPress={() => navigation.navigate("ShopCart")}
          style={({ pressed }) => [
            styles.cartPill,
            pressed && { opacity: 0.85 },
          ]}
        >
          <ShoppingCart size={16} color={colors.primaryForeground} />
          <Text
            variant="small"
            weight="700"
            color={colors.primaryForeground}
            style={{ marginLeft: spacing["2"] }}
          >
            {cart.itemCount} item{cart.itemCount === 1 ? "" : "s"} ·{" "}
            {formatRupees(Math.round(cart.totalPaise / 100))}
          </Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function ProductCard({
  product,
  quantity,
  pending,
  signedIn,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  product: PublicProduct;
  quantity: number;
  pending: boolean;
  signedIn: boolean;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const outOfStock = !product.isInStock;
  const reachedMax = quantity >= product.stockQuantity;
  const inCart = signedIn && quantity > 0;

  return (
    <View style={[styles.card, outOfStock && { opacity: 0.6 }]}>
      <View style={styles.imageWrap}>
        {product.imageUrl ? (
          <Image
            source={{ uri: product.imageUrl }}
            style={styles.image}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.imagePlaceholder} />
        )}
        {outOfStock ? (
          <View style={styles.outOfStockTag}>
            <Text variant="tiny" weight="700" color={colors.destructive}>
              Out of stock
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.cardBody}>
        <Text variant="small" weight="600" color={colors.foreground}>
          {product.name}
        </Text>
        {product.description ? (
          <Text variant="tiny" color={colors.zinc500} numberOfLines={2}>
            {product.description}
          </Text>
        ) : null}
        <View style={styles.cardFooter}>
          <Text variant="small" weight="700" color={colors.emerald400}>
            {formatRupees(Math.round(product.pricePaise / 100))}
          </Text>
          {!outOfStock ? (
            inCart ? (
              <View style={styles.stepper}>
                <Pressable
                  onPress={onDecrement}
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
                  {quantity}
                </Text>
                <Pressable
                  onPress={onIncrement}
                  disabled={pending || reachedMax}
                  style={[styles.stepperBtn, reachedMax && { opacity: 0.4 }]}
                >
                  <Plus size={12} color={colors.zinc300} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={onAdd}
                disabled={pending}
                style={({ pressed }) => [
                  styles.addBtn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Plus size={12} color={colors.primaryForeground} />
                <Text
                  variant="tiny"
                  weight="700"
                  color={colors.primaryForeground}
                  style={{ marginLeft: 4 }}
                >
                  Add
                </Text>
              </Pressable>
            )
          ) : null}
        </View>
        {product.stockQuantity > 0 && product.stockQuantity <= 5 ? (
          <Text
            variant="tiny"
            color={colors.yellow400}
            style={{ marginTop: 2 }}
          >
            Only {product.stockQuantity} left
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["10"],
    gap: spacing["4"],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    marginBottom: spacing["2"],
  },
  loading: {
    marginTop: spacing["8"],
  },
  empty: {
    marginTop: spacing["6"],
  },
  section: {
    gap: spacing["2"],
  },
  sectionLabel: {
    letterSpacing: 1.5,
    fontWeight: "700",
    marginBottom: spacing["1.5"],
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing["2.5"],
  },
  card: {
    width: "48%",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    overflow: "hidden",
  },
  imageWrap: {
    aspectRatio: 1,
    backgroundColor: colors.zinc800,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imagePlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: colors.zinc800,
  },
  outOfStockTag: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 4,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    alignItems: "center",
  },
  cardBody: {
    padding: spacing["3"],
    gap: 4,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing["1.5"],
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing["2"],
    paddingVertical: 4,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
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
  cartPill: {
    position: "absolute",
    bottom: spacing["6"],
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing["5"],
    paddingVertical: spacing["3"],
    borderRadius: 999,
    backgroundColor: colors.primary,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});
