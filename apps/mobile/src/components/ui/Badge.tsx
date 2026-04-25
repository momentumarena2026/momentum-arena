import { StyleSheet, View, type ViewStyle } from "react-native";
import { colors, radius, spacing } from "../../theme";
import { Text } from "./Text";

type Tone = "neutral" | "success" | "warning" | "destructive" | "primary";

interface BadgeProps {
  label: string;
  tone?: Tone;
  style?: ViewStyle;
}

const TONES: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral: {
    bg: colors.muted,
    fg: colors.foreground,
    border: colors.borderStrong,
  },
  primary: {
    bg: colors.primarySoft,
    fg: colors.primary,
    border: colors.primary,
  },
  success: {
    bg: colors.primarySoft,
    fg: colors.primary,
    border: colors.primary,
  },
  warning: {
    bg: colors.warningSoft,
    fg: colors.warning,
    border: colors.warning,
  },
  destructive: {
    bg: colors.destructiveSoft,
    fg: colors.destructive,
    border: colors.destructive,
  },
};

export function Badge({ label, tone = "neutral", style }: BadgeProps) {
  const t = TONES[tone];
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: t.bg, borderColor: t.border },
        style,
      ]}
    >
      <Text variant="tiny" color={t.fg} weight="700">
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing["2"],
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
