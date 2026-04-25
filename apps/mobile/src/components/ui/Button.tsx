import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type ViewStyle,
} from "react-native";
import { colors, radius, spacing } from "../../theme";
import { Text } from "./Text";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  variant = "primary",
  size = "md",
  loading = false,
  leadingIcon,
  trailingIcon,
  fullWidth = false,
  disabled,
  onPress,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      disabled={isDisabled}
      onPress={(e: GestureResponderEvent) => onPress?.(e)}
      style={({ pressed }) => [
        styles.base,
        sizeStyles[size],
        variantStyles[variant].container,
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && variantStyles[variant].pressed,
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles[variant].labelColor} size="small" />
      ) : (
        <View style={styles.row}>
          {leadingIcon ? <View style={styles.iconLeading}>{leadingIcon}</View> : null}
          <Text
            variant={size === "sm" ? "small" : "bodyStrong"}
            color={variantStyles[variant].labelColor}
            weight="600"
          >
            {label}
          </Text>
          {trailingIcon ? <View style={styles.iconTrailing}>{trailingIcon}</View> : null}
        </View>
      )}
    </Pressable>
  );
}

const variantStyles: Record<
  Variant,
  { container: ViewStyle; pressed: ViewStyle; labelColor: string }
> = {
  primary: {
    container: {
      backgroundColor: colors.primary,
      borderWidth: 0,
    },
    pressed: { backgroundColor: colors.primaryHover },
    labelColor: "#032016",
  },
  secondary: {
    container: {
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
    },
    pressed: { backgroundColor: colors.muted },
    labelColor: colors.foreground,
  },
  ghost: {
    container: {
      backgroundColor: "transparent",
      borderWidth: 0,
    },
    pressed: { backgroundColor: colors.muted },
    labelColor: colors.foreground,
  },
  destructive: {
    container: {
      backgroundColor: colors.destructive,
      borderWidth: 0,
    },
    pressed: { backgroundColor: "#b91c1c" },
    labelColor: "#fff",
  },
};

const sizeStyles: Record<Size, ViewStyle> = {
  sm: {
    height: 36,
    paddingHorizontal: spacing["3"],
    borderRadius: radius.md,
  },
  md: {
    height: 46,
    paddingHorizontal: spacing["5"],
    borderRadius: radius.md,
  },
  lg: {
    height: 52,
    paddingHorizontal: spacing["6"],
    borderRadius: radius.lg,
  },
};

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  fullWidth: {
    alignSelf: "stretch",
  },
  disabled: {
    opacity: 0.5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconLeading: {
    marginRight: spacing["2"],
  },
  iconTrailing: {
    marginLeft: spacing["2"],
  },
});
