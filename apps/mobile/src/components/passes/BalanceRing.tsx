import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Text } from "../ui/Text";
import { colors } from "../../theme";

const USED_COLOR = "#52525b"; // zinc-600

const fmtH = (m: number) => `${m.toFixed(1).replace(/\.0$/, "")}h`;

/**
 * Static pass balance ring — remaining share in the sport accent, used
 * share in muted zinc, hours-left in the centre. Shared by the My
 * Passes tickets and the pass detail header. (Web animates the sweep;
 * static parity here.) `total`/`remaining` are HOURS, not minutes.
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
        {/* Used share (muted) */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={USED_COLOR}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c * (1 - remainFrac)} ${c}`}
          strokeLinecap="round"
          transform={`rotate(${-90 + remainFrac * 360} ${size / 2} ${size / 2})`}
        />
        {/* Remaining share (accent) */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={ringColor}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c * remainFrac} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={[styles.ringHours, { color: dim ? colors.zinc400 : ringColor }]}>
          {fmtH(remaining)}
        </Text>
        <Text style={styles.ringSub}>of {fmtH(total)}</Text>
      </View>
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
