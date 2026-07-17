import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Text } from "../ui/Text";
import { colors } from "../../theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const fmtH = (h: number) => `${h.toFixed(1).replace(/\.0$/, "")}`;

/**
 * Storefront hours dial — RN mirror of the web PassClock's listing
 * mode: the accent ring sweeps a FULL circle from 12 o'clock (2200ms,
 * unhurried ease-out, same timing as web) with "Xh TOTAL" in the
 * centre. Owned passes use BalanceRing (split used/remaining) instead.
 */
export function PassClock({
  totalHours,
  accent,
  size = 80,
  stroke = 8,
}: {
  totalHours: number;
  accent: string;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  const [sweep] = useState(() => new Animated.Value(0));
  const [centerOpacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    sweep.setValue(0);
    centerOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(sweep, {
        toValue: 1,
        duration: 2200,
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
  }, [totalHours, sweep, centerOpacity]);

  const dashOffset = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [c, 0],
  });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={stroke}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={accent}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Animated.View style={[styles.center, { opacity: centerOpacity }]}>
        {/* Explicit lineHeights: the shared Text base variant carries
            lineHeight 22, which CLIPS glyph tops once fontSize scales
            past it (the "5h" read as a beheaded digit). */}
        <View style={styles.hoursRow}>
          <Text
            style={[
              styles.hours,
              { fontSize: size * 0.24, lineHeight: size * 0.3 },
            ]}
          >
            {fmtH(totalHours)}
          </Text>
          <Text
            style={[
              styles.hoursUnit,
              { fontSize: size * 0.13, lineHeight: size * 0.3 },
            ]}
          >
            h
          </Text>
        </View>
        <Text
          style={[
            styles.sub,
            {
              fontSize: Math.max(7, size * 0.085),
              lineHeight: Math.max(9, size * 0.11),
            },
          ]}
        >
          TOTAL
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  hoursRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  hours: {
    fontWeight: "700",
    color: "#fff",
  },
  hoursUnit: {
    fontWeight: "700",
    color: "#fff",
  },
  sub: {
    marginTop: 1,
    letterSpacing: 2,
    color: colors.zinc500,
  },
});
