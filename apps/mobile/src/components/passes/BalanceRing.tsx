import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Text } from "../ui/Text";
import { colors } from "../../theme";

const USED_COLOR = "#52525b"; // zinc-600

const fmtH = (m: number) => `${m.toFixed(1).replace(/\.0$/, "")}h`;

// Mirrors the web PassClock timing: 2200ms sweep, arcs staggered 440ms.
const SWEEP_MS = 2200;
const STAGGER_MS = 440;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Animated pass balance ring — the remaining share sweeps in clockwise
 * in the sport accent (like a clock hand filling the dial), then the
 * used share follows in muted zinc; hours-left fade in at the centre.
 * Shared by the My Passes tickets and the pass detail header.
 * `total`/`remaining` are HOURS, not minutes.
 *
 * The sweep animates strokeDashoffset on the SVG arcs — JS-driven
 * (useNativeDriver: false), since SVG props aren't native-animatable.
 */
export function BalanceRing({
  total,
  remaining,
  accent,
  dim,
  size = 112,
}: {
  total: number;
  remaining: number;
  accent: string;
  dim: boolean;
  size?: number;
}) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const remainFrac = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const ringColor = dim ? USED_COLOR : accent;

  // useState initializers (never re-set) — stable across renders, and
  // unlike useRef(...).current they're safe to read during render for
  // the interpolations below (react-hooks/refs).
  const [remainAnim] = useState(() => new Animated.Value(0));
  const [usedAnim] = useState(() => new Animated.Value(0));
  const [centerOpacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    remainAnim.setValue(0);
    usedAnim.setValue(0);
    centerOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(remainAnim, {
        toValue: 1,
        duration: SWEEP_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(usedAnim, {
        toValue: 1,
        duration: SWEEP_MS,
        delay: STAGGER_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(centerOpacity, {
        toValue: 1,
        duration: 600,
        delay: 300,
        useNativeDriver: true,
      }),
    ]).start();
    // Replays whenever the balance changes (e.g. pull-to-refresh after
    // a redemption) — the sweep re-draws to the new split.
  }, [remainFrac, remainAnim, usedAnim, centerOpacity]);

  // Arc visible length = c - dashoffset; each arc sweeps from 0 to its
  // final share of the circumference.
  const remainOffset = remainAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [c, c * (1 - remainFrac)],
  });
  const usedOffset = usedAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [c, c * remainFrac],
  });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* Track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
          fill="none"
        />
        {/* Remaining share (accent) — sweeps from 12 o'clock */}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={ringColor}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={remainOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {/* Used share (muted) — follows on from where remaining ends */}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={USED_COLOR}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={usedOffset}
          strokeLinecap="round"
          transform={`rotate(${-90 + remainFrac * 360} ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Animated.View style={[styles.ringCenter, { opacity: centerOpacity }]}>
        <Text style={[styles.ringHours, { color: dim ? colors.zinc400 : ringColor }]}>
          {fmtH(remaining)}
        </Text>
        <Text style={styles.ringSub}>of {fmtH(total)}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  ringCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  ringHours: {
    fontSize: 20,
    fontWeight: "700",
  },
  ringSub: {
    marginTop: 1,
    fontSize: 11,
    color: colors.zinc500,
  },
});
