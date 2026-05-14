import { StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from "react-native-svg";

/**
 * Native mirror of `components/booking/bowling-machine-diagram.tsx`.
 * Shows a 10×90 emerald-tinted strip anchored to the left of a 90×90
 * cricket field, with a tiny ball-flight arrow + "10×90 ft" label.
 */

const SIZE_MAP = {
  sm: 100,
  md: 140,
} as const;

interface Props {
  size?: keyof typeof SIZE_MAP;
}

export function BowlingMachineDiagram({ size = "md" }: Props) {
  const dim = SIZE_MAP[size];

  return (
    <View style={[styles.wrap, { width: dim, height: dim }]}>
      <Svg width={dim} height={dim} viewBox="0 0 100 100">
        <Rect
          x={2}
          y={2}
          width={96}
          height={96}
          rx={4}
          fill="#0a0a0a"
          stroke="#27272a"
          strokeWidth={1}
        />

        <Line
          x1={50}
          y1={4}
          x2={50}
          y2={96}
          stroke="#27272a"
          strokeWidth={0.6}
          strokeDasharray="2 3"
        />

        <Rect
          x={5}
          y={5}
          width={12}
          height={90}
          rx={2}
          fill="#10b981"
          fillOpacity={0.22}
          stroke="#10b981"
          strokeWidth={1}
        />

        <Path
          d="M 11 80 Q 11 50 11 22"
          stroke="#34d399"
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeDasharray="2 2"
          fill="none"
        />
        <Circle cx={11} cy={20} r={1.6} fill="#34d399" />

        <SvgText
          x={11}
          y={3.5}
          fontFamily="Arial, sans-serif"
          fontSize={3}
          fill="#34d399"
          textAnchor="middle"
          alignmentBaseline="hanging"
        >
          10×90 ft
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "center",
  },
});
