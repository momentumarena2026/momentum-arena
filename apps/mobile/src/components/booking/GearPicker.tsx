import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Check, ChevronUp, ShoppingBag } from "lucide-react-native";
import { Text } from "../ui/Text";
import { colors, radius, spacing } from "../../theme";
import type { EquipmentOption } from "../../lib/booking";

/**
 * Mobile twin of components/booking/gear-picker.tsx — same behaviour:
 *  - Collapsed teaser by default
 *  - Auto-expands the first time the user picks a slot (smart UX)
 *  - Header shows selected items + price delta when collapsed
 *
 * Lives inside the sticky footer on BookSlotsScreen + BookBowling-
 * SlotsScreen, sitting right above the slot summary row.
 */
interface Props {
  options: EquipmentOption[];
  selectedIds: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Number of selected slots — multiplies per-slot rental rates so
   *  a 3-slot booking with a ₹100/slot rental shows ₹300 here. */
  slotCount: number;
  /** When the parent flips this to true, the picker opens once. After
   *  that the user is in charge — toggling back doesn't re-open. */
  shouldExpand: boolean;
}

export function GearPicker({
  options,
  selectedIds,
  onChange,
  slotCount,
  shouldExpand,
}: Props) {
  // Auto-expand the first time the parent flips shouldExpand to
  // true, then let the user override. Mirror of the web GearPicker
  // pattern — see components/booking/gear-picker.tsx for the
  // detailed comment.
  const [expanded, setExpanded] = useState(shouldExpand);
  const [prevShouldExpand, setPrevShouldExpand] = useState(shouldExpand);
  const [userInteracted, setUserInteracted] = useState(false);
  if (prevShouldExpand !== shouldExpand) {
    setPrevShouldExpand(shouldExpand);
    if (!userInteracted && shouldExpand && !expanded) {
      setExpanded(true);
    }
  }
  function toggleExpanded() {
    setUserInteracted(true);
    setExpanded((v) => !v);
  }

  if (options.length === 0) return null;

  const safeSlotCount = Math.max(1, slotCount);
  const selected = options.filter((o) => selectedIds.has(o.id));
  const totalPaise = selected.reduce(
    (sum, o) => sum + o.pricePaise * safeSlotCount,
    0,
  );
  const totalRupees = Math.round(totalPaise / 100);
  const cheapestRupees = Math.round(
    options.reduce(
      (min, o) => (o.pricePaise < min ? o.pricePaise : min),
      options[0].pricePaise,
    ) / 100,
  );
  const hasSelection = selected.length > 0;

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <View style={styles.card}>
      <Pressable
        onPress={toggleExpanded}
        style={({ pressed }) => [
          styles.header,
          pressed && { opacity: 0.85 },
        ]}
      >
        <ShoppingBag
          size={14}
          color={hasSelection ? colors.emerald400 : colors.zinc500}
        />
        {hasSelection ? (
          <>
            <Text style={styles.headerCount}>
              {selected.length} rental{selected.length > 1 ? "s" : ""}
            </Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {selected.map((s) => s.name).join(", ")}
            </Text>
            <Text style={styles.headerPrice}>+₹{totalRupees}</Text>
          </>
        ) : (
          <>
            <Text style={styles.headerTitle}>Rent gear</Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {options.map((o) => o.name).join(", ")}
              {cheapestRupees > 0 ? ` · from ₹${cheapestRupees}` : ""}
            </Text>
          </>
        )}
        {/* Closed → arrow points up; open → flipped to point down.
            Mirror of the web gear-picker affordance. */}
        <ChevronUp
          size={14}
          color={colors.zinc500}
          style={[styles.chev, expanded && styles.chevOpen]}
        />
      </Pressable>

      {expanded && (
        <View style={styles.list}>
          {/* Cap visible rows at 4 — past that the list scrolls inside
              the same envelope so the sticky CTA below stays put.
              nestedScrollEnabled lets the inner scroll capture drags
              even when the picker sits inside a parent ScrollView
              (Android). */}
          <ScrollView
            style={options.length > 4 ? styles.scrollCap : undefined}
            nestedScrollEnabled
            showsVerticalScrollIndicator={options.length > 4}
            contentContainerStyle={styles.scrollContent}
          >
            {options.map((opt) => {
              const on = selectedIds.has(opt.id);
              const perSlot = Math.round(opt.pricePaise / 100);
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => toggle(opt.id)}
                  style={({ pressed }) => [
                    styles.row,
                    on && styles.rowOn,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={[styles.box, on && styles.boxOn]}>
                    {on ? (
                      <Check size={12} color="#ffffff" strokeWidth={3} />
                    ) : null}
                  </View>
                  <Text style={styles.rowName}>{opt.name}</Text>
                  <Text style={styles.rowPrice}>+₹{perSlot}/slot</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {safeSlotCount > 1 && hasSelection && (
            <Text style={styles.subtle}>
              {selected.length} item{selected.length > 1 ? "s" : ""} ×{" "}
              {safeSlotCount} slot{safeSlotCount > 1 ? "s" : ""} = ₹{totalRupees}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.zinc800,
    backgroundColor: "rgba(24, 24, 27, 0.60)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["3"],
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  headerCount: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  headerSub: {
    flex: 1,
    fontSize: 12,
    color: colors.zinc500,
  },
  headerPrice: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.emerald400,
  },
  chev: {
    marginLeft: spacing["1"],
  },
  chevOpen: {
    transform: [{ rotate: "180deg" }],
  },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.zinc800,
  },
  scrollCap: {
    // ~4 rows of paddingVertical:8 + text~17 + gap:4 → ≈ 165px.
    // 5th row peeks at the bottom so the scroll cue is obvious.
    maxHeight: 175,
  },
  scrollContent: {
    paddingHorizontal: spacing["2"],
    paddingVertical: spacing["2"],
    gap: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: radius.md,
    paddingHorizontal: spacing["2"],
    paddingVertical: spacing["2"],
  },
  rowOn: {
    backgroundColor: colors.emerald500_10,
  },
  rowName: {
    flex: 1,
    fontSize: 13,
    color: colors.foreground,
  },
  rowPrice: {
    fontSize: 12,
    color: colors.zinc400,
    fontWeight: "500",
  },
  box: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.zinc600,
    backgroundColor: "#0a0a0b",
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: {
    borderColor: colors.emerald400,
    backgroundColor: colors.emerald500,
  },
  subtle: {
    fontSize: 11,
    color: colors.zinc500,
    paddingHorizontal: spacing["3"],
    paddingTop: 4,
    paddingBottom: spacing["2"],
  },
});
