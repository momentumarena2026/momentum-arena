import { StyleSheet, View, Pressable } from "react-native";
import { CreditCard, QrCode, Smartphone } from "lucide-react-native";
import { Text } from "../ui/Text";
import { colors, radius, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";

export type AdvancePaymentMethod = "online" | "upi_qr";

interface Props {
  totalAmount: number;
  advanceAmount: number;
  remainingAmount: number;
  selected: AdvancePaymentMethod;
  onSelect: (m: AdvancePaymentMethod) => void;
  gateway: "PHONEPE" | "RAZORPAY";
}

/**
 * Mirrors `components/payment/advance-payment-selector.tsx` on web.
 * Yellow 50% Advance card + a 2-option picker (online | upi_qr) under it.
 */
export function AdvancePaymentPicker({
  totalAmount,
  advanceAmount,
  remainingAmount,
  selected,
  onSelect,
  gateway,
}: Props) {
  const OnlineIcon = gateway === "PHONEPE" ? Smartphone : CreditCard;
  const onlinePurple = gateway === "PHONEPE";
  const onlineSelectedBorder = onlinePurple ? "#c084fc" : "#60a5fa";
  const onlineSelectedBg = onlinePurple
    ? "rgba(168, 85, 247, 0.10)"
    : "rgba(59, 130, 246, 0.10)";
  const onlineSelectedTint = onlineSelectedBorder;

  return (
    <View style={styles.wrap}>
      <View style={styles.info}>
        <Text variant="small" weight="500" color="#facc15">
          50% Advance Required
        </Text>
        <View style={styles.infoRow}>
          <Text variant="small" color={colors.zinc400}>
            Total
          </Text>
          <Text variant="small" color={colors.zinc400}>
            {formatRupees(totalAmount)}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text variant="small" weight="500" color="#fde047">
            Advance (50%)
          </Text>
          <Text variant="small" weight="500" color="#fde047">
            {formatRupees(advanceAmount)}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text variant="small" color={colors.zinc500}>
            Due at Venue
          </Text>
          <Text variant="small" color={colors.zinc500}>
            {formatRupees(remainingAmount)}
          </Text>
        </View>
      </View>

      <Text variant="tiny" color={colors.zinc500} style={styles.label}>
        Pay advance via:
      </Text>

      <View style={styles.row}>
        <Pressable
          onPress={() => onSelect("online")}
          style={({ pressed }) => [
            styles.chip,
            selected === "online"
              ? {
                  borderColor: onlineSelectedBorder,
                  backgroundColor: onlineSelectedBg,
                  borderWidth: 2,
                }
              : styles.chipIdle,
            pressed && { opacity: 0.9 },
          ]}
        >
          <OnlineIcon
            size={16}
            color={selected === "online" ? onlineSelectedTint : colors.zinc400}
          />
          <Text
            variant="small"
            color={selected === "online" ? colors.foreground : colors.zinc400}
          >
            Pay Online
          </Text>
        </Pressable>

        <Pressable
          onPress={() => onSelect("upi_qr")}
          style={({ pressed }) => [
            styles.chip,
            selected === "upi_qr"
              ? {
                  borderColor: colors.emerald400,
                  backgroundColor: colors.emerald500_10,
                  borderWidth: 2,
                }
              : styles.chipIdle,
            pressed && { opacity: 0.9 },
          ]}
        >
          <QrCode
            size={16}
            color={selected === "upi_qr" ? colors.emerald400 : colors.zinc400}
          />
          <Text
            variant="small"
            color={selected === "upi_qr" ? colors.foreground : colors.zinc400}
          >
            UPI QR
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing["3"],
  },
  info: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(234, 179, 8, 0.20)", // yellow-500/20
    backgroundColor: "rgba(234, 179, 8, 0.05)", // yellow-500/5
    padding: spacing["4"],
    gap: spacing["1"],
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  label: {
    marginTop: spacing["1"],
  },
  row: {
    flexDirection: "row",
    gap: spacing["2"],
  },
  chip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing["2"],
    paddingVertical: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  chipIdle: {
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
});
