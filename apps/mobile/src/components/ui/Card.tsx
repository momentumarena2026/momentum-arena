import { StyleSheet, View, type ViewProps, type ViewStyle } from "react-native";
import { colors, radius, spacing } from "../../theme";

interface CardProps extends ViewProps {
  /** Highlight with the emerald border (e.g. primary CTA card). */
  accent?: boolean;
  /** Remove the default inner padding. */
  flush?: boolean;
  style?: ViewStyle;
}

export function Card({ accent, flush, style, children, ...rest }: CardProps) {
  return (
    <View
      style={[
        styles.base,
        accent ? styles.accent : styles.plain,
        !flush && styles.padded,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  plain: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  accent: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  padded: {
    padding: spacing["5"],
  },
});
