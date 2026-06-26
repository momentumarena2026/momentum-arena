import { StyleSheet, View, Pressable } from "react-native";
import { CreditCard, QrCode, Wallet, Check } from "lucide-react-native";
import { Text } from "../ui/Text";
import { colors, radius, spacing } from "../../theme";
import { formatRupees } from "../../lib/format";

/** Top-level choice: pay the full amount now, or a 50% advance. */
export type AmountMode = "full" | "advance";
/** Method under each amount mode. `upi` = direct UPI (no fee). */
export type PayMethod = "upi" | "gateway";

interface Props {
  amountMode: AmountMode;
  onAmountModeChange: (m: AmountMode) => void;
  method: PayMethod;
  onMethodChange: (m: PayMethod) => void;
  gateway: "PHONEPE" | "RAZORPAY";
  fullAmount: number;
  advanceAmount: number;
  remainingAmount: number;
  onlineEnabled: boolean;
  upiQrEnabled: boolean;
  advanceEnabled: boolean;
}

/**
 * Mirrors web's `components/payment/payment-selector.tsx`: a two-level
 * chooser — amount (Full / 50% advance) then method (UPI default · gateway).
 * UPI is pre-selected to steer customers off the fee-bearing gateway.
 */
export function PaymentMethodTiles({
  amountMode,
  onAmountModeChange,
  method,
  onMethodChange,
  gateway,
  fullAmount,
  advanceAmount,
  remainingAmount,
  onlineEnabled,
  upiQrEnabled,
  advanceEnabled,
}: Props) {
  const showMethodToggle = upiQrEnabled && onlineEnabled;

  const cards: { id: AmountMode; enabled: boolean; title: string; desc: string }[] = [
    {
      id: "full",
      enabled: onlineEnabled || upiQrEnabled,
      title: "Pay Full",
      desc: `Pay ${formatRupees(fullAmount)} now`,
    },
    {
      id: "advance",
      enabled: advanceEnabled,
      title: "Pay 50% Now, rest at Venue",
      desc: `${formatRupees(advanceAmount)} now · ${formatRupees(remainingAmount)} at venue`,
    },
  ];

  return (
    <View style={styles.list}>
      {cards
        .filter((c) => c.enabled)
        .map((card) => {
          const isSelected = amountMode === card.id;
          return (
            <View
              key={card.id}
              style={[styles.card, isSelected ? styles.cardSelected : styles.cardIdle]}
            >
              <Pressable
                onPress={() => onAmountModeChange(card.id)}
                style={({ pressed }) => [styles.cardHead, pressed && { opacity: 0.9 }]}
              >
                <View
                  style={[
                    styles.iconWrap,
                    { backgroundColor: isSelected ? colors.emerald500_10 : colors.zinc800 },
                  ]}
                >
                  <Wallet size={20} color={isSelected ? colors.emerald400 : colors.zinc400} />
                </View>
                <View style={styles.body}>
                  <Text variant="body" weight="500" color={colors.foreground}>
                    {card.title}
                  </Text>
                  <Text variant="tiny" color={colors.zinc400}>
                    {card.desc}
                  </Text>
                </View>
                <View
                  style={[
                    styles.radio,
                    { borderColor: isSelected ? colors.emerald400 : colors.zinc600 },
                    isSelected && { backgroundColor: colors.emerald400 },
                  ]}
                >
                  {isSelected ? <View style={styles.radioDot} /> : null}
                </View>
              </Pressable>

              {isSelected && showMethodToggle ? (
                <View style={styles.toggleWrap}>
                  <MethodToggle method={method} onMethodChange={onMethodChange} gateway={gateway} />
                </View>
              ) : null}
            </View>
          );
        })}
    </View>
  );
}

function MethodToggle({
  method,
  onMethodChange,
  gateway,
}: {
  method: PayMethod;
  onMethodChange: (m: PayMethod) => void;
  gateway: "PHONEPE" | "RAZORPAY";
}) {
  const options: { id: PayMethod; label: string; sub: string }[] = [
    { id: "upi", label: "UPI", sub: "Recommended · no extra charge" },
    {
      id: "gateway",
      label: gateway === "PHONEPE" ? "PhonePe" : "Card / Netbanking",
      sub: "Cards, UPI, Netbanking",
    },
  ];

  return (
    <View style={styles.toggleRow}>
      {options.map((o) => {
        const active = method === o.id;
        const Icon = o.id === "upi" ? QrCode : CreditCard;
        return (
          <Pressable
            key={o.id}
            onPress={() => onMethodChange(o.id)}
            style={({ pressed }) => [
              styles.chip,
              active ? styles.chipActive : styles.chipIdle,
              pressed && { opacity: 0.9 },
            ]}
          >
            <View style={styles.chipHead}>
              <Icon size={16} color={active ? colors.emerald400 : colors.zinc400} />
              <Text
                variant="small"
                weight="600"
                color={active ? colors.foreground : colors.zinc300}
              >
                {o.label}
              </Text>
              {active ? <Check size={16} color={colors.emerald400} style={styles.chipCheck} /> : null}
            </View>
            <Text variant="tiny" color={active ? "#6ee7b7" : colors.zinc500}>
              {o.sub}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing["3"] },
  card: { borderRadius: radius.lg, borderWidth: 1 },
  cardSelected: { borderColor: colors.emerald400, backgroundColor: colors.emerald500_05 },
  cardIdle: { borderColor: colors.zinc800, backgroundColor: colors.zinc900 },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    padding: spacing["4"],
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: 2 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: "#fff" },
  toggleWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.zinc800,
    padding: spacing["3"],
  },
  toggleRow: { flexDirection: "row", gap: spacing["2"] },
  chip: {
    flex: 1,
    gap: 2,
    paddingVertical: spacing["3"],
    paddingHorizontal: spacing["3"],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  chipActive: { borderColor: colors.emerald400, backgroundColor: colors.emerald500_10 },
  chipIdle: { borderColor: colors.zinc700, backgroundColor: colors.zinc900 },
  chipHead: { flexDirection: "row", alignItems: "center", gap: spacing["2"] },
  chipCheck: { marginLeft: "auto" },
});
