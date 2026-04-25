import { Platform } from "react-native";
import { colors } from "./colors";

/**
 * Web uses `Geist` + system stack. On mobile we lean on the platform default
 * (San Francisco on iOS, Roboto on Android) which already looks clean on
 * dark backgrounds and saves us the pain of shipping a custom font file.
 */
export const fonts = {
  sans: Platform.select({
    ios: "System",
    android: "sans-serif",
    default: "System",
  })!,
  mono: Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  })!,
};

type Variant = {
  fontSize: number;
  lineHeight: number;
  fontWeight:
    | "400"
    | "500"
    | "600"
    | "700"
    | "800";
  letterSpacing?: number;
  color?: string;
};

export const text = {
  display: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "700",
    letterSpacing: -0.5,
    color: colors.foreground,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: colors.foreground,
  },
  heading: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
    color: colors.foreground,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "400",
    color: colors.foreground,
  },
  bodyStrong: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    color: colors.foreground,
  },
  small: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
  tiny: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    color: colors.subtleForeground,
    letterSpacing: 0.4,
  },
} satisfies Record<string, Variant>;

export type TextVariant = keyof typeof text;
