import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  Tag,
  Ticket,
  X,
} from "lucide-react-native";
import { Text } from "../ui/Text";
import { Input } from "../ui/Input";
import { colors, radius, spacing } from "../../theme";
import { bookingApi, type PublicCoupon } from "../../lib/booking";
import { formatRupees } from "../../lib/format";

interface Props {
  bookingAmount: number;
  sport?: string;
  /** Called when the user commits a code. Returns `{success, error}` — the
   *  input stays mounted so it can show the error inline. */
  onApply: (code: string) => Promise<{ success: boolean; error?: string }>;
  /** Parent-driven applied-state view — when set, the input collapses to a
   *  green pill. Mirrors web's disabled + disabledMessage pattern. */
  disabled?: boolean;
  disabledMessage?: string;
}

/**
 * Mirror of web's `components/booking/discount-input.tsx`. Same three
 * states:
 *   1. disabled → emerald pill ("FLAT100 — ₹100 off applied")
 *   2. empty input → text field + amber dashed "View available coupons"
 *   3. drawer open → full-height modal listing public coupons
 */
export function DiscountInput({
  bookingAmount,
  sport,
  onApply,
  disabled,
  disabledMessage,
}: Props) {
  const [code, setCode] = useState("");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Lazy-load coupons: only fetch when the drawer opens the first time.
  const couponsQuery = useQuery({
    queryKey: ["available-coupons", "SPORTS"],
    queryFn: () => bookingApi.availableCoupons("SPORTS"),
    enabled: drawerOpen,
    staleTime: 60_000,
  });
  const coupons = couponsQuery.data?.coupons ?? [];

  async function runApply(value: string) {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return;
    setApplying(true);
    setError(null);
    try {
      const result = await onApply(trimmed);
      if (!result.success) {
        setError(result.error ?? "Invalid code");
      } else {
        setCode("");
        setDrawerOpen(false);
      }
    } finally {
      setApplying(false);
    }
  }

  if (disabled) {
    return (
      <View style={styles.appliedPill}>
        <Check size={16} color={colors.emerald400} />
        <Text variant="small" color={colors.emerald400}>
          {disabledMessage ?? "Discount applied"}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {/* Input row — Ticket icon + text field + Apply button */}
      <View style={styles.row}>
        <View style={styles.inputWrap}>
          <Input
            value={code}
            onChangeText={(t) => {
              setCode(t.toUpperCase());
              setError(null);
            }}
            placeholder="Enter coupon code"
            autoCapitalize="characters"
            autoCorrect={false}
            leadingAddon={<Ticket size={16} color={colors.zinc500} />}
            onSubmitEditing={() => runApply(code)}
            returnKeyType="done"
          />
        </View>
        <Pressable
          onPress={() => runApply(code)}
          disabled={applying || !code.trim()}
          style={({ pressed }) => [
            styles.applyBtn,
            (applying || !code.trim()) && styles.applyBtnDisabled,
            pressed && !applying && code.trim() && { opacity: 0.85 },
          ]}
        >
          {applying ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text variant="small" weight="600" color="#fff">
              Apply
            </Text>
          )}
        </Pressable>
      </View>

      {/* View available coupons CTA — dashed amber border like web */}
      <Pressable
        onPress={() => setDrawerOpen(true)}
        style={({ pressed }) => [
          styles.viewCoupons,
          pressed && { opacity: 0.75 },
        ]}
      >
        <View style={styles.viewCouponsLeft}>
          <Tag size={16} color={colors.warning} />
          <Text variant="small" weight="500" color={colors.warning}>
            View available coupons
          </Text>
        </View>
        <ChevronRight size={16} color={colors.warning} />
      </Pressable>

      {error ? (
        <View style={styles.errorRow}>
          <X size={12} color={colors.destructive} />
          <Text variant="tiny" color={colors.destructive}>
            {error}
          </Text>
        </View>
      ) : null}

      <CouponDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        coupons={coupons}
        loading={couponsQuery.isLoading}
        bookingAmount={bookingAmount}
        onApply={(couponCode) => runApply(couponCode)}
        applying={applying}
      />
      {/* sport unused in list (web doesn't filter client-side either —
       *  validation is server-side); prop kept for future per-sport UI. */}
      {sport ? null : null}
    </View>
  );
}

interface DrawerProps {
  visible: boolean;
  onClose: () => void;
  coupons: PublicCoupon[];
  loading: boolean;
  bookingAmount: number;
  onApply: (code: string) => Promise<void>;
  applying: boolean;
}

function CouponDrawer({
  visible,
  onClose,
  coupons,
  loading,
  bookingAmount,
  onApply,
  applying,
}: DrawerProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.drawer}>
          {/* Header */}
          <View style={styles.drawerHeader}>
            <View style={styles.drawerHeaderText}>
              <Text variant="heading" weight="700">
                Available Coupons
              </Text>
              <Text variant="tiny" color={colors.zinc500}>
                {coupons.length} offer{coupons.length === 1 ? "" : "s"}{" "}
                available
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => [
                styles.closeBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <X size={18} color={colors.zinc400} />
            </Pressable>
          </View>

          {/* Body */}
          <View style={styles.drawerBody}>
            {loading ? (
              <View style={styles.drawerEmpty}>
                <ActivityIndicator color={colors.warning} />
              </View>
            ) : coupons.length === 0 ? (
              <View style={styles.drawerEmpty}>
                <Tag size={32} color={colors.zinc600} />
                <Text variant="small" color={colors.zinc400}>
                  No coupons available right now
                </Text>
              </View>
            ) : (
              coupons.map((c) => (
                <CouponRow
                  key={c.id}
                  coupon={c}
                  bookingAmount={bookingAmount}
                  onApply={onApply}
                  applying={applying}
                />
              ))
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function formatDiscount(coupon: PublicCoupon): string {
  if (coupon.type === "PERCENTAGE") {
    // Web stores percent * 100 (e.g. 10% = 1000).
    const pct = coupon.value / 100;
    const maxStr = coupon.maxDiscount
      ? ` up to ${formatRupees(coupon.maxDiscount)}`
      : "";
    return `${pct}% OFF${maxStr}`;
  }
  return `${formatRupees(coupon.value)} OFF`;
}

function CouponRow({
  coupon,
  bookingAmount,
  onApply,
  applying,
}: {
  coupon: PublicCoupon;
  bookingAmount: number;
  onApply: (code: string) => Promise<void>;
  applying: boolean;
}) {
  const meetsMin = !coupon.minAmount || bookingAmount >= coupon.minAmount;

  return (
    <View
      style={[
        styles.couponCard,
        meetsMin ? styles.couponCardActive : styles.couponCardInactive,
      ]}
    >
      <View style={styles.couponCardMain}>
        {/* Discount badge */}
        <View style={styles.couponBadgeRow}>
          <View style={styles.discountBadge}>
            <Text variant="tiny" weight="700" color={colors.warning}>
              {formatDiscount(coupon)}
            </Text>
          </View>
          <Text variant="tiny" color={colors.zinc500} style={styles.scopePill}>
            {coupon.scope}
          </Text>
        </View>

        {/* Code */}
        <View style={styles.codeBox}>
          <Text variant="small" weight="700" style={styles.codeText}>
            {coupon.code}
          </Text>
        </View>

        {coupon.description ? (
          <Text
            variant="tiny"
            color={colors.zinc400}
            style={styles.couponDesc}
          >
            {coupon.description}
          </Text>
        ) : null}

        {coupon.minAmount && !meetsMin ? (
          <Text variant="tiny" color={colors.destructive} style={styles.minNote}>
            Min. order {formatRupees(coupon.minAmount)}
          </Text>
        ) : null}
      </View>

      <Pressable
        onPress={() => onApply(coupon.code)}
        disabled={!meetsMin || applying}
        style={({ pressed }) => [
          styles.couponApplyBtn,
          !meetsMin && styles.couponApplyBtnDisabled,
          pressed && meetsMin && !applying && { opacity: 0.85 },
        ]}
      >
        <Text
          variant="small"
          weight="700"
          color={meetsMin ? "#000" : colors.zinc500}
        >
          Apply
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing["2"],
  },
  row: {
    flexDirection: "row",
    gap: spacing["2"],
    alignItems: "flex-start",
  },
  inputWrap: {
    flex: 1,
  },
  applyBtn: {
    height: 46,
    paddingHorizontal: spacing["4"],
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.zinc700,
  },
  applyBtnDisabled: {
    opacity: 0.5,
  },
  viewCoupons: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing["3"],
    paddingVertical: spacing["2.5"],
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(217, 119, 6, 0.4)", // amber-600/40
    backgroundColor: "rgba(245, 158, 11, 0.05)", // amber-500/5
  },
  viewCouponsLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing["1"],
  },
  appliedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
    padding: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.emerald500_20,
    backgroundColor: colors.emerald500_05,
  },
  // ── Drawer ───────────────────────────────────────────────────────────────
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.70)",
    justifyContent: "flex-end",
  },
  drawer: {
    backgroundColor: colors.zinc900,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.zinc800,
    maxHeight: "85%",
    overflow: "hidden",
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing["5"],
    paddingVertical: spacing["4"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.zinc800,
  },
  drawerHeaderText: {
    gap: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.zinc800,
    alignItems: "center",
    justifyContent: "center",
  },
  drawerBody: {
    padding: spacing["4"],
    gap: spacing["3"],
  },
  drawerEmpty: {
    paddingVertical: spacing["12"],
    alignItems: "center",
    gap: spacing["3"],
  },
  // ── Coupon rows ──────────────────────────────────────────────────────────
  couponCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing["4"],
  },
  couponCardActive: {
    borderColor: colors.zinc700,
    backgroundColor: colors.zinc800_50,
  },
  couponCardInactive: {
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
    opacity: 0.5,
  },
  couponCardMain: {
    flex: 1,
    minWidth: 0,
    gap: spacing["1"],
  },
  couponBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["2"],
  },
  discountBadge: {
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.20)",
    backgroundColor: "rgba(245, 158, 11, 0.10)",
  },
  scopePill: {
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  codeBox: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing["2"],
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.zinc600,
    backgroundColor: "rgba(63, 63, 70, 0.5)",
    marginTop: spacing["1"],
  },
  codeText: {
    fontFamily: "Courier",
    color: colors.foreground,
  },
  couponDesc: {
    marginTop: spacing["1"],
  },
  minNote: {
    marginTop: spacing["1"],
  },
  couponApplyBtn: {
    paddingHorizontal: spacing["4"],
    paddingVertical: spacing["2.5"],
    borderRadius: radius.md,
    backgroundColor: colors.warning, // amber-500
  },
  couponApplyBtnDisabled: {
    backgroundColor: colors.zinc700,
  },
});
