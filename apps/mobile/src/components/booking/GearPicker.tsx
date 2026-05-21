import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Check, ChevronDown, ChevronUp, ShoppingBag } from "lucide-react-native";
import { Text } from "../ui/Text";
import { colors, radius, spacing } from "../../theme";
import type { EquipmentOption } from "../../lib/booking";

/**
 * Mobile twin of components/booking/gear-picker.tsx — same behaviour:
 *  - Always starts collapsed. Customer taps the header to expand.
 *  - On the false→true edge of `shouldExpand` (i.e. the moment a
 *    slot is picked), the picker plays a one-shot horizontal shake
 *    to draw attention to it — but does NOT auto-open.
 *  - Header shows selected items + price delta when collapsed.
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
  /** When the parent flips this from false to true (= customer just
   *  picked a slot), we fire a single shake animation. We do NOT
   *  open the panel. */
  shouldExpand: boolean;
}

export function GearPicker({
  options,
  selectedIds,
  onChange,
  slotCount,
  shouldExpand,
}: Props) {
  // Picker starts (and stays) collapsed until the customer taps.
  // The "smart" cue is now a shake on slot pick, not an auto-open.
  const [expanded, setExpanded] = useState(false);

  // Shake animation. Driven by a single Animated.Value oscillating
  // between -6 → 6 → -4 → 4 → -2 → 2 → 0 over ~550ms — same envelope
  // shape as the web @keyframes gear-shake.
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Fire the shake on the false→true edge of shouldExpand. We also
  // shake on FIRST render when shouldExpand is already true — this
  // covers the screens that gate the picker render on `slots > 0`
  // (e.g. BookSlotsScreen), where the component literally remounts
  // every time the user re-picks slots from empty.
  useEffect(() => {
    if (!shouldExpand) return;
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: -6, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -4, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 4, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -2, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 2, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldExpand]);

  function toggleExpanded() {
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
    <Animated.View
      style={[styles.card, { transform: [{ translateX: shakeAnim }] }]}
    >
      <Pressable
        onPress={toggleExpanded}
        style={({ pressed }) => [
          styles.header,
          pressed && { opacity: 0.85 },
        ]}
      >
        <ShoppingBag
          size={16}
          color={hasSelection ? colors.emerald400 : colors.zinc400}
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
        {/* Closed → up-arrow; open → down-arrow. Swapping the icon
            outright (instead of rotating ChevronUp 180°) sidesteps a
            lucide-react-native rendering quirk where the rotated
            instance briefly became invisible on some Android builds.
            Wrapped in a fixed 20×20 View so a long `headerSub` can
            never squeeze it out of the flex row. */}
        <View style={styles.chevWrap}>
          {expanded ? (
            <ChevronDown size={18} color={colors.zinc300} />
          ) : (
            <ChevronUp size={18} color={colors.zinc300} />
          )}
        </View>
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
    </Animated.View>
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
  chevWrap: {
    width: 20,
    height: 20,
    marginLeft: spacing["1"],
    alignItems: "center",
    justifyContent: "center",
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
