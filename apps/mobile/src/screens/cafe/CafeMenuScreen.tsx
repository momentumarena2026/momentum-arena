import { useMemo } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Clock, Coffee } from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { colors, radius, spacing } from "../../theme";
import { cafeApi } from "../../lib/cafe";
import type { CafeItem } from "../../lib/types";
import { formatRupees } from "../../lib/format";

/**
 * Cafe tab. Single query fetches {isOpen, items} so we pick the
 * right render in one shot:
 *   - isOpen = false → "Cafe is closed" page (mirrors web's
 *     CafeClosedPage component visually + emotionally — warm,
 *     not apologetic).
 *   - isOpen = true  → read-only menu listing grouped by
 *     category, with prices and veg / non-veg dots. Native
 *     add-to-cart + checkout flow is intentionally not ported
 *     yet — customers in the app see the menu and tap to view,
 *     ordering happens at the counter for now (mirrors the
 *     interim state on web where the customer ordering UI is
 *     still being built out).
 */
export function CafeMenuScreen() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["cafe", "menu"],
    queryFn: () => cafeApi.menu(),
    // Cafe open/closed flips are admin events — no need to refetch
    // aggressively. 30s staleness is plenty.
    staleTime: 30_000,
  });

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

// ─────────────────────────────────────────────────────────────────────
// CLOSED view — RN port of components/cafe/cafe-closed-page.tsx.
// Keeps the same copy + amber-cream palette so the two surfaces
// read identically when a venue closes the cafe.
// ─────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────
// OPEN view — read-only menu listing. Cart/checkout flow is the
// follow-up; for now the screen surfaces the menu (so customers
// see what's available) and tells them to order at the counter.
// ─────────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  SNACKS: "Snacks",
  BEVERAGES: "Beverages",
  MEALS: "Meals",
  DESSERTS: "Desserts",
  COMBOS: "Combos",
};
const CATEGORY_ORDER = ["BEVERAGES", "SNACKS", "MEALS", "DESSERTS", "COMBOS"];

function CafeOpenView({ items }: { items: CafeItem[] }) {
  const grouped = useMemo(() => {
    const out: Record<string, CafeItem[]> = {};
    for (const item of items) {
      if (!item.isAvailable) continue; // hide unavailable from menu listing
      if (!out[item.category]) out[item.category] = [];
      out[item.category].push(item);
    }
    return out;
  }, [items]);

  const categories = CATEGORY_ORDER.filter((c) => grouped[c]?.length > 0);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.menuScroll}>
        <View style={styles.menuHeader}>
          <Text variant="heading" weight="700" color={colors.foreground}>
            Momentum Cafe
          </Text>
          <Text variant="small" color={colors.zinc400}>
            Browse the menu. Place orders at the counter for now.
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
              {grouped[cat].map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function ItemRow({ item }: { item: CafeItem }) {
  return (
    <View style={styles.itemRow}>
      {item.image ? (
        <Image source={{ uri: item.image }} style={styles.itemImage} />
      ) : (
        <View style={styles.itemImagePlaceholder} />
      )}
      <View style={styles.itemBody}>
        <View style={styles.itemNameRow}>
          {/* Tiny veg/non-veg square — same convention as the web
              cafe menu page. Green = veg, red = non-veg. */}
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
      </View>
      <Text variant="small" weight="700" color={colors.emerald400}>
        {formatRupees(item.price)}
      </Text>
    </View>
  );
}

// Tailwind amber tokens — keep parity with the web closed page.
const AMBER_300 = "#fcd34d";
const AMBER_200 = "#fde68a";

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["3"],
    padding: spacing["6"],
  },

  // CLOSED view
  closedScroll: {
    padding: spacing["4"],
    gap: spacing["4"],
  },
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
  heroBody: {
    paddingHorizontal: spacing["2"],
  },
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
  fallbackHint: {
    paddingHorizontal: spacing["4"],
  },

  // OPEN view
  menuScroll: {
    padding: spacing["4"],
    gap: spacing["4"],
  },
  menuHeader: {
    gap: spacing["1"],
    paddingBottom: spacing["2"],
  },
  section: {
    gap: spacing["2"],
  },
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
  itemImage: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
  },
  itemImagePlaceholder: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.zinc900,
  },
  itemBody: {
    flex: 1,
    gap: 2,
  },
  itemNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  itemName: {
    flex: 1,
  },
  itemDescription: {
    lineHeight: 16,
  },
  vegBadge: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  vegDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  emptyCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    padding: spacing["6"],
  },
});

