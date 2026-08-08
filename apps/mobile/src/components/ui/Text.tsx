import { forwardRef } from "react";
import {
  Text as RNText,
  StyleSheet,
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
  // A style that raises fontSize without also raising lineHeight keeps the
  // variant's line box. body is 15/22, so `style={{ fontSize: 24 }}` drew a
  // 24px glyph into a 22px box and sliced the tops off the digits — that is
  // how the cricket scoreboard lost the top of "39/0", and it would recur
  // every time someone bumped a size in a local StyleSheet.
  //
  // Grow the box to fit, never shrink it: an override *smaller* than the
  // variant keeps the roomier line height it was laid out with, so this
  // can't quietly retighten spacing on the screens that were already fine.
  // 1.25 is the theme's own ratio for large text (title is 24/30).
  // Callers that set both fontSize and lineHeight are left exactly as written.
  const override = StyleSheet.flatten(style) as TextStyle | undefined;
  const base = text[variant] as TextStyle;
  const size = override?.fontSize;
  const cramped =
    typeof size === "number" &&
    override?.lineHeight == null &&
    typeof base.lineHeight === "number" &&
    size * 1.25 > base.lineHeight;

  const mergedStyle: StyleProp<TextStyle> = [
    cramped ? { ...base, lineHeight: Math.ceil(size * 1.25) } : base,
    color ? { color } : null,
    weight ? { fontWeight: weight } : null,
    align ? { textAlign: align } : null,
    style,
  ];
  return <RNText ref={ref} style={mergedStyle} {...rest} />;
});
