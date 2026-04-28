import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  EyeOff,
  Search,
} from "lucide-react-native";
import { Screen } from "../../components/ui/Screen";
import { Text } from "../../components/ui/Text";
import { Skeleton } from "../../components/ui/Skeleton";
import { colors, radius, spacing } from "../../theme";
import {
  adminCafeApi,
  type CafeItem,
  type CafeItemCategory,
} from "../../lib/admin-cafe";
import { AdminApiError } from "../../lib/admin-api";
import { categoryLabel, formatRupees } from "../../lib/format";

const CATEGORY_FILTERS: { value: CafeItemCategory | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "SNACKS", label: "Snacks" },
  { value: "BEVERAGES", label: "Beverages" },
  { value: "MEALS", label: "Meals" },
  { value: "DESSERTS", label: "Desserts" },
  { value: "COMBOS", label: "Combos" },
];

/**
 * Mirrors the web /admin/cafe page on mobile, scoped to the
 * "availability toggle" flow that floor staff actually need on a
 * phone. Create/edit/reorder are intentionally not ported — those
 * are rare enough that the web admin remains the canonical surface
 * for menu maintenance.
 *
 * Optimistic toggle: we flip the local `isAvailable` flag immediately
 * and roll back if the server rejects, so a tap → eye-icon flip is
 * instantaneous on slow networks.
 */
export function AdminCafeMenuScreen() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CafeItemCategory | "">("");

  const items = useQuery({
    queryKey: ["admin-cafe-items", category || "ALL"],
    queryFn: () =>
      adminCafeApi.items({
        category: category === "" ? undefined : category,
        showUnavailable: true,
      }),
    refetchOnWindowFocus: false,
  });

  const toggle = useMutation({
    mutationFn: (id: string) => adminCafeApi.toggleAvailability(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["admin-cafe-items", category || "ALL"] });
      const prev = qc.getQueryData<{ items: CafeItem[]; grouped: Record<string, CafeItem[]> }>([
        "admin-cafe-items",
        category || "ALL",
      ]);
      if (prev) {
        qc.setQueryData(["admin-cafe-items", category || "ALL"], {
          ...prev,
          items: prev.items.map((it) =>
            it.id === id ? { ...it, isAvailable: !it.isAvailable } : it,
          ),
        });
      }
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(["admin-cafe-items", category || "ALL"], ctx.prev);
      }
      Alert.alert(
        "Couldn't toggle",
        err instanceof AdminApiError ? err.message : "Try again.",
      );
    },
    onSettled: () =>
      void qc.invalidateQueries({
        queryKey: ["admin-cafe-items", category || "ALL"],
      }),
  });

  const filtered = useMemo(() => {
    const all = items.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.description ?? "").toLowerCase().includes(q),
    );
  }, [items.data, search]);

  const refreshing =
    (items.isFetching && !items.isLoading) || items.isRefetching;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void items.refetch()}
            tintColor={colors.yellow400}
          />
        }
      >
        {/* Search */}
        <View style={styles.searchRow}>
          <Search size={14} color={colors.zinc500} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search menu items"
            placeholderTextColor={colors.zinc600}
            style={styles.searchInput}
          />
        </View>

        {/* Category chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {CATEGORY_FILTERS.map((c) => {
            const active = category === c.value;
            return (
              <Pressable
                key={c.value || "ALL"}
                onPress={() => setCategory(c.value)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text
                  variant="tiny"
                  color={active ? colors.yellow400 : colors.zinc300}
                  weight="600"
                >
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {items.isLoading ? (
          <ListSkeleton />
        ) : items.isError ? (
          <Pressable
            onPress={() => void items.refetch()}
            style={styles.errorBlock}
          >
            <Text variant="body" color={colors.destructive}>
              Couldn't load menu. Tap to retry.
            </Text>
            <Text variant="tiny" color={colors.zinc500}>
              {items.error instanceof Error
                ? items.error.message
                : "Unknown error"}
            </Text>
          </Pressable>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text variant="bodyStrong" color={colors.zinc300}>
              No items
            </Text>
            <Text variant="tiny" color={colors.zinc500} align="center">
              Try a different search or category.
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing["2"] }}>
            {filtered.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                onToggle={() => toggle.mutate(it.id)}
                isToggling={toggle.isPending && toggle.variables === it.id}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function ItemRow({
  item,
  onToggle,
  isToggling,
}: {
  item: CafeItem;
  onToggle: () => void;
  isToggling: boolean;
}) {
  const dim = !item.isAvailable;
  return (
    <View
      style={[
        styles.row,
        dim && {
          opacity: 0.6,
          borderStyle: "dashed",
        },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {item.isVeg ? "🥬" : "🍗"} {item.name}
          </Text>
        </View>
        {item.description ? (
          <Text variant="tiny" color={colors.zinc500} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <View style={styles.rowMeta}>
          <Text variant="tiny" color={colors.yellow400} weight="600">
            {formatRupees(item.price)}
          </Text>
          <Text variant="tiny" color={colors.zinc600}>
            ·
          </Text>
          <Text variant="tiny" color={colors.zinc500}>
            {categoryLabel(item.category)}
          </Text>
        </View>
      </View>
      <Pressable
        onPress={onToggle}
        disabled={isToggling}
        hitSlop={8}
        style={({ pressed }) => [
          styles.toggleBtn,
          item.isAvailable ? styles.toggleOn : styles.toggleOff,
          isToggling && { opacity: 0.5 },
          pressed && { opacity: 0.7 },
        ]}
      >
        {item.isAvailable ? (
          <Eye size={14} color={colors.emerald400} />
        ) : (
          <EyeOff size={14} color={colors.zinc400} />
        )}
        <Text
          variant="tiny"
          color={item.isAvailable ? colors.emerald400 : colors.zinc400}
          weight="600"
        >
          {item.isAvailable ? "Live" : "Hidden"}
        </Text>
      </Pressable>
    </View>
  );
}

function ListSkeleton() {
  return (
    <View style={{ gap: spacing["2"] }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.row}>
          <View style={{ flex: 1, gap: 4 }}>
            <Skeleton width="50%" height={14} />
            <Skeleton width="80%" height={11} />
            <Skeleton width="30%" height={11} />
          </View>
          <Skeleton width={64} height={28} rounded="full" />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing["5"],
    paddingTop: spacing["3"],
    paddingBottom: spacing["8"],
    gap: spacing["3"],
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    borderWidth: 1,
    borderColor: colors.zinc800,
    borderRadius: 8,
    paddingHorizontal: spacing["3"],
    backgroundColor: colors.zinc900,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing["2.5"],
    color: colors.foreground,
    fontSize: 14,
  },
  chipRow: {
    flexDirection: "row",
    gap: spacing["2"],
    paddingVertical: spacing["1"],
  },
  chip: {
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  chipActive: {
    borderColor: "rgba(250, 204, 21, 0.40)",
    backgroundColor: "rgba(250, 204, 21, 0.10)",
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
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["1.5"],
  },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing["2.5"],
    paddingVertical: spacing["1.5"],
    borderRadius: 999,
    borderWidth: 1,
  },
  toggleOn: {
    borderColor: "rgba(34, 197, 94, 0.30)",
    backgroundColor: "rgba(34, 197, 94, 0.10)",
  },
  toggleOff: {
    borderColor: colors.zinc800,
    backgroundColor: colors.background,
  },
  empty: {
    alignItems: "center",
    gap: spacing["1"],
    padding: spacing["6"],
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  errorBlock: {
    padding: spacing["4"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.30)",
    backgroundColor: "rgba(239, 68, 68, 0.10)",
    gap: spacing["1"],
  },
});
