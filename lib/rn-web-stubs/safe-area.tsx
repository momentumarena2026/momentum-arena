/**
 * Safe-area insets, which do not exist in a preview frame.
 *
 * `react-native-safe-area-context` reaches native code for the real thing —
 * its `NativeSafeAreaView` deep-imports React Native's own
 * `codegenNativeComponent`, a path no bare-specifier alias can intercept,
 * and that source is Flow rather than TypeScript so the web bundler cannot
 * even parse it.
 *
 * The honest answer is not to try. A notch and a home indicator are
 * properties of a physical phone; the preview draws a rectangle on a
 * monitor, where every inset is genuinely zero. So `SafeAreaView` is a
 * plain `View` here and the insets are zeros — not an approximation of the
 * real thing, but the correct value for the thing being rendered.
 *
 * The preview frame supplies the phone-shaped bezel itself, so nothing is
 * lost visually.
 */
"use client";

import { View } from "react-native";
import type { ReactNode } from "react";

const ZERO = { top: 0, left: 0, right: 0, bottom: 0 };

export function SafeAreaProvider({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function SafeAreaView({
  children,
  style,
  // `edges` selects which sides get padding on a real device. With every
  // inset at zero it changes nothing, so it is accepted and ignored rather
  // than passed to a View that would warn about an unknown prop.
  edges: _edges,
  ...rest
}: {
  children?: ReactNode;
  style?: unknown;
  edges?: unknown;
  [k: string]: unknown;
}) {
  return (
    <View style={style} {...rest}>
      {children}
    </View>
  );
}

export function useSafeAreaInsets() {
  return ZERO;
}

export function useSafeAreaFrame() {
  return { x: 0, y: 0, width: 390, height: 780 };
}

export const initialWindowMetrics = { frame: { x: 0, y: 0, width: 390, height: 780 }, insets: ZERO };
export type Edges = ReadonlyArray<"top" | "right" | "bottom" | "left">;
