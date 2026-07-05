import { useEffect, useMemo } from "react";
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
import { useQuery } from "@tanstack/react-query";
import { Clock, Coffee, Minus, Plus, ShoppingCart } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { cafeApi } from "../../lib/cafe";
import type { CafeItem } from "../../lib/types";
import { formatRupees } from "../../lib/format";
import { useCafeCart } from "../../providers/CafeCartProvider";
import {
  trackCafeBrowse,
  trackCafeItemAdded,
  trackCafeItemRemoved,
} from "../../lib/analytics";
import type { CafeStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<CafeStackParamList, "CafeMenu">;

/**
 * Cafe tab entry. Single query → {isOpen, items}; the screen
 * either renders the warm "Cafe closed" view or the open menu with
 * inline +/- qty controls. A sticky footer surfaces the cart count
 * + checkout CTA the moment there's anything in it.
 */
export function CafeMenuScreen() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["cafe", "menu"],
    queryFn: () => cafeApi.menu(),
    staleTime: 30_000,
  });

  useEffect(() => {
    trackCafeBrowse();
  }, []);

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.warning} />
        </View>
      </Screen>
    );
  }

  if (isError || !data) {
    return (
      <Screen>
        <View style={styles.errorWrap}>
          <Text variant="body" color={colors.destructive_300} align="center">
            Couldn&apos;t load the cafe menu.
          </Text>
          <Button label="Try again" onPress={() => refetch()} variant="secondary" />
        </View>
      </Screen>
    );
  }

  if (!data.isOpen) {
    return <CafeClosedView />;
  }

  return <CafeOpenView items={data.items} />;
}

// ─────────── CLOSED view ───────────

function CafeClosedView() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.closedScroll}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Coffee size={32} color={AMBER_300} />
          </View>
          <Text variant="title" weight="700" color={colors.foreground} align="center">
            The Cafe is taking a breather
          </Text>
          <Text
            variant="body"
            color={colors.zinc300}
            align="center"
            style={styles.heroBody}
          >
            We&apos;re not accepting online orders right now. Pop back in a
            bit — fresh batches are on the way.
          </Text>
          <View style={styles.statusPill}>
            <Clock size={12} color={AMBER_200} />
            <Text variant="tiny" weight="500" color={AMBER_200}>
              Currently closed
            </Text>
          </View>
        </View>
        <Text
          variant="tiny"
          color={colors.zinc600}
          align="center"
          style={styles.fallbackHint}
        >
          Already at the venue? Walk up to the cafe counter — staff can take
          your order in person.
        </Text>
      </ScrollView>
    </Screen>
  );
}

// ─────────── OPEN view ───────────

const CATEGORY_LABELS: Record<string, string> = {
  SNACKS: "Snacks",
  BEVERAGES: "Beverages",
  MEALS: "Meals",
  DESSERTS: "Desserts",
  COMBOS: "Combos",
};
const CATEGORY_ORDER = ["BEVERAGES", "SNACKS", "MEALS", "DESSERTS", "COMBOS"];

function CafeOpenView({ items }: { items: CafeItem[] }) {
  const navigation = useNavigation<Nav>();
  const cart = useCafeCart();

  const grouped = useMemo(() => {
    const out: Record<string, CafeItem[]> = {};
    for (const item of items) {
      if (!item.isAvailable) continue;
      if (!out[item.category]) out[item.category] = [];
      out[item.category].push(item);
    }
    return out;
  }, [items]);

  const categories = CATEGORY_ORDER.filter((c) => grouped[c]?.length > 0);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.menuScroll}>
        <View style={styles.menuHeader}>
          <Text variant="heading" weight="700" color={colors.foreground}>
            Momentum Cafe ☕
          </Text>
          <Text variant="small" color={colors.zinc400}>
            Order now, pick up at the counter.
          </Text>
        </View>

        {categories.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text variant="small" color={colors.zinc400} align="center">
              No items on the menu yet. Check back soon.
            </Text>
          </View>
        ) : (
          categories.map((cat) => (
            <View key={cat} style={styles.section}>
              <Text
                variant="small"
                weight="600"
                color={AMBER_300}
                style={styles.sectionHeading}
              >
                {CATEGORY_LABELS[cat] ?? cat}
              </Text>
              {grouped[cat].map((item) => {
                const qty = cart.getQuantity(item.id);
                const outOfStock =
                  item.quantity !== null &&
                  item.quantity !== undefined &&
                  item.quantity === 0;
                const stockReached =
                  item.quantity !== null &&
                  item.quantity !== undefined &&
                  qty >= item.quantity;
                return (
                  <ItemRow
                    key={item.id}
                    item={item}
                    quantity={qty}
                    outOfStock={outOfStock}
                    stockReached={stockReached}
                    onAdd={() => {
                      trackCafeItemAdded(item.name, item.price);
                      cart.addItem({
                        cafeItemId: item.id,
                        name: item.name,
                        price: item.price,
                        isVeg: item.isVeg,
                        imageUrl: item.image ?? null,
                        trackedStock: item.quantity ?? null,
                      });
                    }}
                    onIncrement={() => {
                      trackCafeItemAdded(item.name, item.price);
                      cart.increment(item.id);
                    }}
                    onDecrement={() => {
                      trackCafeItemRemoved(item.name);
                      cart.decrement(item.id);
                    }}
                  />
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      {cart.itemCount > 0 ? (
        <View style={styles.cartFooter}>
          <View style={{ flex: 1 }}>
            <Text variant="tiny" color={colors.zinc500}>
              {cart.itemCount} item{cart.itemCount !== 1 ? "s" : ""} in cart
            </Text>
            <Text variant="bodyStrong" weight="700" color={colors.foreground}>
              {formatRupees(cart.subtotal)}
            </Text>
          </View>
          <Button
            label="View Cart"
            onPress={() => navigation.navigate("CafeCart")}
            size="md"
          />
        </View>
      ) : null}
    </Screen>
  );
}

function ItemRow({
  item,
  quantity,
  outOfStock,
  stockReached,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  item: CafeItem;
  quantity: number;
  outOfStock: boolean;
  stockReached: boolean;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  return (
    <View style={[styles.itemRow, outOfStock ? styles.itemRowDimmed : null]}>
      {item.image ? (
        <Image source={{ uri: item.image }} style={styles.itemImage} />
      ) : (
        <View style={styles.itemImagePlaceholder} />
      )}
      <View style={styles.itemBody}>
        <View style={styles.itemNameRow}>
          <View
            style={[
              styles.vegBadge,
              {
                borderColor: item.isVeg
                  ? "rgba(16, 185, 129, 0.5)"
                  : "rgba(239, 68, 68, 0.5)",
              },
            ]}
          >
            <View
              style={[
                styles.vegDot,
                {
                  backgroundColor: item.isVeg
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
            style={styles.itemName}
            numberOfLines={1}
          >
            {item.name}
          </Text>
        </View>
        {item.description ? (
          <Text
            variant="tiny"
            color={colors.zinc500}
            numberOfLines={2}
            style={styles.itemDescription}
          >
            {item.description}
          </Text>
        ) : null}
        <Text variant="small" weight="700" color={colors.emerald400}>
          {formatRupees(item.price)}
        </Text>
      </View>

      <View style={styles.qtyColumn}>
        {outOfStock ? (
          <Text variant="tiny" color={colors.destructive_300} weight="600">
            Sold out
          </Text>
        ) : quantity === 0 ? (
          <Pressable
            onPress={onAdd}
            style={({ pressed }) => [
              styles.addBtn,
              pressed && { opacity: 0.85 },
            ]}
          >
            <ShoppingCart size={14} color={colors.background} />
            <Text variant="tiny" weight="700" color={colors.background}>
              Add
            </Text>
          </Pressable>
        ) : (
          <View style={styles.qtyRow}>
            <Pressable
              onPress={onDecrement}
              style={({ pressed }) => [
                styles.qtyBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Minus size={14} color={colors.foreground} />
            </Pressable>
            <Text variant="small" weight="700" color={colors.foreground}>
              {quantity}
            </Text>
            <Pressable
              onPress={onIncrement}
              disabled={stockReached}
              style={({ pressed }) => [
                styles.qtyBtn,
                pressed && { opacity: 0.7 },
                stockReached && { opacity: 0.4 },
              ]}
            >
              <Plus size={14} color={colors.foreground} />
            </Pressable>
          </View>
        )}
        {stockReached && !outOfStock ? (
          <Text
            variant="tiny"
            color={colors.warning}
            style={styles.stockHint}
          >
            Max stock
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// Tailwind amber tokens — keep parity with the web closed page.
const AMBER_300 = "#fcd34d";
const AMBER_200 = "#fde68a";

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["3"],
    padding: spacing["6"],
  },

  // CLOSED view
  closedScroll: { padding: spacing["4"], gap: spacing["4"] },
  heroCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.30)",
    backgroundColor: "rgba(245, 158, 11, 0.07)",
    padding: spacing["8"],
    alignItems: "center",
    gap: spacing["3"],
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.30)",
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing["2"],
  },
  heroBody: { paddingHorizontal: spacing["2"] },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.30)",
    backgroundColor: "rgba(10, 10, 10, 0.6)",
    paddingHorizontal: spacing["3"],
    paddingVertical: 4,
    marginTop: spacing["2"],
  },
  fallbackHint: { paddingHorizontal: spacing["4"] },

  // OPEN view
  menuScroll: {
    padding: spacing["4"],
    paddingBottom: spacing["10"],
    gap: spacing["4"],
  },
  menuHeader: { gap: spacing["1"], paddingBottom: spacing["2"] },
  section: { gap: spacing["2"] },
  sectionHeading: {
    paddingTop: spacing["2"],
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.card,
    padding: spacing["3"],
  },
  itemRowDimmed: { opacity: 0.5 },
  itemImage: { width: 56, height: 56, borderRadius: radius.md },
  itemImagePlaceholder: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.zinc900,
  },
  itemBody: { flex: 1, gap: 2 },
  itemNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  itemName: { flex: 1 },
  itemDescription: { lineHeight: 16 },
  vegBadge: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  vegDot: { width: 6, height: 6, borderRadius: 3 },
  emptyCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["6"],
  },

  // qty controls
  qtyColumn: { alignItems: "flex-end", gap: 4 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    backgroundColor: colors.emerald400,
  },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2.5"],
  },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc900,
    alignItems: "center",
    justifyContent: "center",
  },
  stockHint: { textAlign: "right" },

  // Cart footer
  cartFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["3"],
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
