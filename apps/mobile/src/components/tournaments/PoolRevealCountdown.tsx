import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Text } from "../ui/Text";
import { colors, radius } from "../../theme";

/**
 * Countdown to the draw.
 *
 * The pre-reveal state used to be a flat sentence with a date in it,
 * which reads as "come back later" rather than "something is about to
 * happen". The draw is the moment the tournament becomes real for a
 * captain, so the wait should feel like a countdown, not a notice.
 *
 * A sweeping ring drains over the final minute and the seconds tick, so
 * the card is visibly alive even when the reveal is days away.
 *
 * react-native-svg and reanimated are both already native dependencies —
 * nothing new is added, so this ships over OTA.
 */

const SIZE = 132;
const STROKE = 8;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

function pad(n: number) {
  return String(Math.max(0, n)).padStart(2, "0");
}

function useCountdown(target: Date | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [target]);

  return useMemo(() => {
    if (!target) return null;
    const ms = target.getTime() - now;
    const done = ms <= 0;
    const s = Math.max(0, Math.floor(ms / 1000));
    return {
      done,
      days: Math.floor(s / 86400),
      hours: Math.floor((s % 86400) / 3600),
      minutes: Math.floor((s % 3600) / 60),
      seconds: s % 60,
    };
  }, [target, now]);
}

export function PoolRevealCountdown({ revealAt }: { revealAt: string | null }) {
  const target = useMemo(() => (revealAt ? new Date(revealAt) : null), [revealAt]);
  const left = useCountdown(target);

  // Gentle breathing on the whole dial, so the card reads as live even
  // when the number itself only changes once a second.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.04, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [pulse]);
  const dialStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  if (!target) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>✨ Pool reveal coming up</Text>
        <Text style={styles.body}>The draw will be revealed soon.</Text>
      </View>
    );
  }

  // The ring drains once a minute — a second hand, not a progress bar to
  // the reveal, which on a multi-day countdown would never visibly move.
  const secFraction = left ? left.seconds / 60 : 0;

  if (left?.done) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>🥁 Drawing the pools…</Text>
        <Text style={styles.body}>
          The draw is happening right now — this screen will fill in on its own.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>✨ Pool reveal countdown</Text>

      <Animated.View style={[styles.dialWrap, dialStyle]}>
        <Svg width={SIZE} height={SIZE}>
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke="rgba(167,139,250,0.18)"
            strokeWidth={STROKE}
            fill="none"
          />
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke="#a78bfa"
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${CIRC} ${CIRC}`}
            strokeDashoffset={CIRC * (1 - secFraction)}
            // Start the sweep at 12 o'clock rather than 3.
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <View style={styles.dialCentre}>
          <Text style={styles.bigNum}>{left ? pad(left.seconds) : "--"}</Text>
          <Text style={styles.bigLabel}>sec</Text>
        </View>
      </Animated.View>

      <View style={styles.unitsRow}>
        {[
          { v: left?.days ?? 0, l: "days" },
          { v: left?.hours ?? 0, l: "hrs" },
          { v: left?.minutes ?? 0, l: "min" },
        ].map((u) => (
          <View key={u.l} style={styles.unit}>
            <Text style={styles.unitNum}>{pad(u.v)}</Text>
            <Text style={styles.unitLabel}>{u.l}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.body}>
        The draw goes live{" "}
        {target.toLocaleString("en-IN", {
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        })}
        {" "}— keep this screen open and watch the pools fill in.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.25)",
    borderRadius: radius.xl,
    backgroundColor: "rgba(167,139,250,0.06)",
    padding: 18,
    alignItems: "center",
    gap: 12,
  },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "700" },
  body: { color: colors.zinc400, fontSize: 12, textAlign: "center", lineHeight: 18 },
  dialWrap: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  dialCentre: { position: "absolute", alignItems: "center" },
  bigNum: { color: "#c4b5fd", fontSize: 34, fontWeight: "800" },
  bigLabel: { color: colors.zinc500, fontSize: 11, marginTop: -2 },
  unitsRow: { flexDirection: "row", gap: 18 },
  unit: { alignItems: "center", minWidth: 46 },
  unitNum: { color: colors.foreground, fontSize: 20, fontWeight: "700" },
  unitLabel: { color: colors.zinc500, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 },
});
