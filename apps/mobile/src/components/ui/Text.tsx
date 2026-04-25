import { forwardRef } from "react";
import {
  Text as RNText,
  type TextProps as RNTextProps,
  type TextStyle,
  type StyleProp,
} from "react-native";
import { text, type TextVariant } from "../../theme";

interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: string;
  weight?: TextStyle["fontWeight"];
  align?: TextStyle["textAlign"];
}

export const Text = forwardRef<RNText, TextProps>(function Text(
  { variant = "body", color, weight, align, style, ...rest },
  ref
) {
  const mergedStyle: StyleProp<TextStyle> = [
    text[variant],
    color ? { color } : null,
    weight ? { fontWeight: weight } : null,
    align ? { textAlign: align } : null,
    style,
  ];
  return <RNText ref={ref} style={mergedStyle} {...rest} />;
});
