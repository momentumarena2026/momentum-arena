import { StyleSheet } from "react-native";
import LinearGradient from "react-native-linear-gradient";

/**
 * Absolutely-positioned gradient that fills a rounded-2xl sport card. Mirrors
 * web's `bg-gradient-to-br from-{color}-500/20 to-{color}-600/5` on the
 * sport card (see `components/booking/sport-card.tsx`).
 *
 * Tailwind's `bg-gradient-to-br` runs from top-left → bottom-right, so we
 * set `start={{x:0,y:0}}` → `end={{x:1,y:1}}` on LinearGradient. This uses
 * platform-native gradient APIs (CAGradientLayer on iOS, GradientDrawable
 * on Android) so the texture reads the same as the web's CSS gradient.
 *
 * React Native has no CSS gradient primitive, so we rely on
 * `react-native-linear-gradient`. The parent card must set `overflow:
 * "hidden"` and a matching `borderRadius` so the gradient clips cleanly.
 */
export interface SportCardGradientProps {
  /** `from-{color}-500/20` — e.g. `"rgba(16, 185, 129, 0.20)"` */
  fromColor: string;
  /** `to-{color}-600/5`   — e.g. `"rgba(5, 150, 105, 0.05)"`   */
  toColor: string;
}

export function SportCardGradient({
  fromColor,
  toColor,
}: SportCardGradientProps) {
  return (
    <LinearGradient
      colors={[fromColor, toColor]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}
