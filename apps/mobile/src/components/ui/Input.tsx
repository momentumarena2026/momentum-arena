import { forwardRef, useState } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { colors, radius, spacing } from "../../theme";
import { Text } from "./Text";

export interface InputProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  leadingAddon?: React.ReactNode;
  trailingAddon?: React.ReactNode;
  containerStyle?: ViewStyle;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    hint,
    error,
    leadingAddon,
    trailingAddon,
    containerStyle,
    onFocus,
    onBlur,
    style,
    ...rest
  },
  ref
) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? (
        <Text variant="small" color={colors.mutedForeground} style={styles.label}>
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          focused && styles.fieldFocused,
          !!error && styles.fieldError,
        ]}
      >
        {leadingAddon ? <View style={styles.addonLeading}>{leadingAddon}</View> : null}
        <TextInput
          ref={ref}
          style={[styles.input, style]}
          placeholderTextColor={colors.subtleForeground}
          selectionColor={colors.primary}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {trailingAddon ? <View style={styles.addonTrailing}>{trailingAddon}</View> : null}
      </View>

      {error ? (
        <Text variant="small" color={colors.destructive} style={styles.message}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="small" color={colors.subtleForeground} style={styles.message}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    gap: spacing["1.5"],
  },
  label: {
    paddingHorizontal: spacing["1"],
    fontWeight: "500",
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: spacing["4"],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.inputBackground,
  },
  fieldFocused: {
    borderColor: colors.primary,
  },
  fieldError: {
    borderColor: colors.destructive,
  },
  input: {
    flex: 1,
    color: colors.foreground,
    fontSize: 16,
    fontWeight: "500",
    paddingVertical: 0,
  },
  addonLeading: {
    marginRight: spacing["2"],
  },
  addonTrailing: {
    marginLeft: spacing["2"],
  },
  message: {
    paddingHorizontal: spacing["1"],
  },
});
