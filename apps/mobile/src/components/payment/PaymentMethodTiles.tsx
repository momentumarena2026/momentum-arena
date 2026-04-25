import { StyleSheet, View, Pressable } from "react-native";
import {
  CreditCard,
  QrCode,
  Smartphone,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import { Text } from "../ui/Text";
import { colors, radius, spacing } from "../../theme";

export type PaymentMethodType = "online" | "upi_qr" | "cash";

interface Props {
  selected: PaymentMethodType;
  onSelect: (m: PaymentMethodType) => void;
  gateway: "PHONEPE" | "RAZORPAY";
  onlineEnabled: boolean;
  upiQrEnabled: boolean;
  advanceEnabled: boolean;
}

type Tone = "blue" | "purple" | "green" | "yellow";

const TONE: Record<
  Tone,
  { border: string; bg: string; icon: string; tint: string }
> = {
  blue: {
    border: "#60a5fa", // blue-400
    bg: "rgba(59, 130, 246, 0.10)", // blue-500/10
    icon: "#60a5fa",
    tint: "#60a5fa",
  },
  purple: {
    border: "#c084fc", // purple-400
    bg: "rgba(168, 85, 247, 0.10)",
    icon: "#c084fc",
    tint: "#c084fc",
  },
  green: {
    border: "#34d399", // emerald-400
    bg: "rgba(16, 185, 129, 0.10)",
    icon: "#34d399",
    tint: "#34d399",
  },
  yellow: {
    border: "#facc15", // yellow-400
    bg: "rgba(234, 179, 8, 0.10)",
    icon: "#facc15",
    tint: "#facc15",
  },
};

/**
 * Mirrors `components/payment/payment-selector.tsx` on web.
 * Three tiles, admin-gated via the *Enabled props, per-tone colors for the
 * selected state, and a radio-style indicator on the right.
 */
export function PaymentMethodTiles({
  selected,
  onSelect,
  gateway,
  onlineEnabled,
  upiQrEnabled,
  advanceEnabled,
}: Props) {
  const all: {
    id: PaymentMethodType;
    enabled: boolean;
    name: string;
    description: string;
    Icon: LucideIcon;
    tone: Tone;
  }[] = [
    {
      id: "online",
      enabled: onlineEnabled,
      name: "Pay Online",
      description:
        gateway === "PHONEPE"
          ? "UPI, Cards, Netbanking via PhonePe"
          : "Cards, UPI, Netbanking via Razorpay",
      Icon: gateway === "PHONEPE" ? Smartphone : CreditCard,
      tone: gateway === "PHONEPE" ? "purple" : "blue",
    },
    {
      id: "upi_qr",
      enabled: upiQrEnabled,
      name: "UPI QR Code",
      description: "Scan & pay using any UPI app",
      Icon: QrCode,
      tone: "green",
    },
    {
      id: "cash",
      enabled: advanceEnabled,
      name: "Pay 50% Now, 50% at Venue",
      description: "Reserve with a 50% advance online, pay the rest on arrival",
      Icon: Wallet,
      tone: "yellow",
    },
  ];

  const visible = all.filter((m) => m.enabled);

  return (
    <View style={styles.list}>
      {visible.map((m) => {
        const isSelected = selected === m.id;
        const tone = TONE[m.tone];
        return (
          <Pressable
            key={m.id}
            onPress={() => onSelect(m.id)}
            style={({ pressed }) => [
              styles.tile,
              isSelected
                ? { borderColor: tone.border, backgroundColor: tone.bg, borderWidth: 2 }
                : styles.tileIdle,
              pressed && { opacity: 0.9 },
            ]}
          >
            <View
              style={[
                styles.iconWrap,
                {
                  backgroundColor: isSelected ? tone.bg : colors.zinc800,
                },
              ]}
            >
              <m.Icon
                size={20}
                color={isSelected ? tone.icon : colors.zinc400}
              />
            </View>
            <View style={styles.body}>
              <Text variant="body" weight="500" color={colors.foreground}>
                {m.name}
              </Text>
              <Text variant="tiny" color={colors.zinc400}>
                {m.description}
              </Text>
            </View>
            <View
              style={[
                styles.radio,
                { borderColor: isSelected ? tone.border : colors.zinc600 },
              ]}
            >
              {isSelected ? (
                <View style={[styles.radioDot, { backgroundColor: "#fff" }]} />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing["3"],
  },
  tile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing["3"],
    borderRadius: radius.lg,
    padding: spacing["4"],
    borderWidth: 1,
  },
  tileIdle: {
    borderColor: colors.zinc800,
    backgroundColor: colors.zinc900,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
    gap: 2,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
});
